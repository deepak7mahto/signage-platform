import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { eq } from 'drizzle-orm';
import { SignJWT, jwtVerify } from 'jose';
import { LoginRequestSchema, type AuthUser } from '@signage/shared';
import { config } from '../config.js';
import { db } from '../db/index.js';
import { users } from '../db/schema.js';
import { verifyPassword } from '../lib/crypto.js';

export const AUTH_COOKIE_NAME = 'signage_session';

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
    .setExpirationTime('7d')
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
      role: (payload.role as AuthUser['role']) ?? 'admin',
    };
  } catch {
    return null;
  }
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
  app.post('/api/v1/auth/login', async (req, reply) => {
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

    const authUser: AuthUser = {
      id: user.id,
      orgId: user.orgId,
      email: user.email,
      name: user.name,
      role: user.role as AuthUser['role'],
    };

    const token = await signUserJwt(authUser);
    const isSecure = config.PUBLIC_BASE_URL.startsWith('https://');

    reply.setCookie(AUTH_COOKIE_NAME, token, {
      path: '/',
      httpOnly: true,
      sameSite: 'lax',
      secure: isSecure,
      maxAge: 60 * 60 * 24 * 7,
    });

    return { user: authUser, token };
  });

  app.post('/api/v1/auth/logout', async (_req, reply) => {
    reply.clearCookie(AUTH_COOKIE_NAME, { path: '/' });
    return { ok: true };
  });

  app.get('/api/v1/auth/me', { preHandler: requireAuth }, async (req) => {
    return { user: req.authUser };
  });
}
