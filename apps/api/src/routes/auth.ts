import crypto from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { and, eq, isNull } from 'drizzle-orm';
import { SignJWT, jwtVerify } from 'jose';
import { LoginRequestSchema, type AuthUser, type UserRole } from '@signage/shared/contracts';
import { config } from '../config.js';
import { db } from '../db/index.js';
import { userSessions, users } from '../db/schema.js';
import { generateOpaqueToken, sha256Hex, verifyPassword } from '../lib/crypto.js';

export const AUTH_COOKIE_NAME = 'signage_session';
export const REFRESH_COOKIE_NAME = 'signage_refresh';
const ACCESS_TTL_SEC = 15 * 60;
const REFRESH_TTL_MS = 30 * 24 * 60 * 60 * 1000;

const jwtSecretBytes = new TextEncoder().encode(config.JWT_SECRET);

declare module 'fastify' {
  interface FastifyRequest {
    authUser?: AuthUser;
  }
}

async function signUserJwt(user: AuthUser): Promise<string> {
  return new SignJWT({
    orgId: user.orgId,
    email: user.email,
    name: user.name,
    role: user.role,
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(user.id)
    .setIssuedAt()
    .setExpirationTime(`${ACCESS_TTL_SEC}s`)
    .sign(jwtSecretBytes);
}

async function verifyUserJwt(token: string): Promise<AuthUser | null> {
  try {
    const { payload } = await jwtVerify(token, jwtSecretBytes);
    if (!payload.sub || typeof payload.orgId !== 'string' || typeof payload.email !== 'string') {
      return null;
    }
    return {
      id: payload.sub,
      orgId: payload.orgId,
      email: payload.email,
      name: typeof payload.name === 'string' ? payload.name : 'Admin',
      role: (payload.role as UserRole) ?? 'admin',
    };
  } catch {
    return null;
  }
}

function setAuthCookies(reply: FastifyReply, accessToken: string, refreshToken: string): void {
  const isSecure = config.PUBLIC_BASE_URL.startsWith('https://');
  reply.setCookie(AUTH_COOKIE_NAME, accessToken, {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: isSecure,
    maxAge: ACCESS_TTL_SEC,
  });
  reply.setCookie(REFRESH_COOKIE_NAME, refreshToken, {
    path: '/api/v1/auth',
    httpOnly: true,
    sameSite: 'lax',
    secure: isSecure,
    maxAge: Math.floor(REFRESH_TTL_MS / 1000),
  });
}

function toAuthUser(row: typeof users.$inferSelect): AuthUser {
  return {
    id: row.id,
    orgId: row.orgId,
    email: row.email,
    name: row.name,
    role: row.role as UserRole,
  };
}

export async function requireAuth(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  const cookieToken = req.cookies[AUTH_COOKIE_NAME];
  const authHeader = req.headers.authorization;
  const bearerToken =
    authHeader && authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : undefined;

  const token = cookieToken || bearerToken;
  if (!token) {
    await reply.code(401).send({ error: 'Unauthorized' });
    return;
  }

  const user = await verifyUserJwt(token);
  if (!user) {
    await reply.code(401).send({ error: 'Invalid or expired session' });
    return;
  }

  req.authUser = user;
}

export async function authRoutes(app: FastifyInstance): Promise<void> {
  app.post(
    '/api/v1/auth/login',
    { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const parsed = LoginRequestSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: 'Invalid credentials format', issues: parsed.error.issues });
      }

      const [user] = await db
        .select()
        .from(users)
        .where(eq(users.email, parsed.data.email.toLowerCase()))
        .limit(1);

      if (!user || !verifyPassword(parsed.data.password, user.passwordHash)) {
        return reply.code(401).send({ error: 'Invalid email or password' });
      }

      const authUser = toAuthUser(user);
      const token = await signUserJwt(authUser);
      const refreshToken = `ref_${generateOpaqueToken(32)}`;
      await db.insert(userSessions).values({
        id: crypto.randomUUID(),
        userId: user.id,
        refreshHash: sha256Hex(refreshToken),
        expiresAt: new Date(Date.now() + REFRESH_TTL_MS),
      });

      setAuthCookies(reply, token, refreshToken);
      return { user: authUser, token };
    },
  );

  app.post('/api/v1/auth/refresh', async (req, reply) => {
    const rawRefresh = req.cookies[REFRESH_COOKIE_NAME];
    if (!rawRefresh) {
      return reply.code(401).send({ error: 'Missing refresh token' });
    }

    const refreshHash = sha256Hex(rawRefresh);
    const [session] = await db
      .select()
      .from(userSessions)
      .where(eq(userSessions.refreshHash, refreshHash))
      .limit(1);

    if (!session) {
      return reply.code(401).send({ error: 'Invalid refresh token' });
    }

    // Reuse detection: if an already-rotated session token is replayed, revoke all active user sessions
    if (session.revokedAt !== null) {
      await db
        .update(userSessions)
        .set({ revokedAt: new Date() })
        .where(and(eq(userSessions.userId, session.userId), isNull(userSessions.revokedAt)));
      reply.clearCookie(AUTH_COOKIE_NAME, { path: '/' });
      reply.clearCookie(REFRESH_COOKIE_NAME, { path: '/api/v1/auth' });
      return reply.code(401).send({ error: 'Refresh token reuse detected; sessions revoked' });
    }

    if (session.expiresAt.getTime() < Date.now()) {
      reply.clearCookie(AUTH_COOKIE_NAME, { path: '/' });
      reply.clearCookie(REFRESH_COOKIE_NAME, { path: '/api/v1/auth' });
      return reply.code(401).send({ error: 'Refresh token expired' });
    }

    const [user] = await db.select().from(users).where(eq(users.id, session.userId)).limit(1);
    if (!user) {
      return reply.code(401).send({ error: 'User not found' });
    }

    const nextRefresh = `ref_${generateOpaqueToken(32)}`;
    const now = new Date();
    await db
      .update(userSessions)
      .set({ revokedAt: now })
      .where(eq(userSessions.id, session.id));

    await db.insert(userSessions).values({
      id: crypto.randomUUID(),
      userId: user.id,
      refreshHash: sha256Hex(nextRefresh),
      expiresAt: new Date(Date.now() + REFRESH_TTL_MS),
    });

    const authUser = toAuthUser(user);
    const token = await signUserJwt(authUser);
    setAuthCookies(reply, token, nextRefresh);
    return { user: authUser, token };
  });

  app.post('/api/v1/auth/logout', async (req, reply) => {
    const rawRefresh = req.cookies[REFRESH_COOKIE_NAME];
    if (rawRefresh) {
      await db
        .update(userSessions)
        .set({ revokedAt: new Date() })
        .where(and(eq(userSessions.refreshHash, sha256Hex(rawRefresh)), isNull(userSessions.revokedAt)));
    }
    reply.clearCookie(AUTH_COOKIE_NAME, { path: '/' });
    reply.clearCookie(REFRESH_COOKIE_NAME, { path: '/api/v1/auth' });
    return { ok: true };
  });

  app.get('/api/v1/auth/me', { preHandler: requireAuth }, async (req) => {
    return { user: req.authUser };
  });
}
