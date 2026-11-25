import type { FastifyReply, FastifyRequest } from 'fastify';
import type { UserRole } from '@signage/shared/contracts';

export function requireRole(...allowed: UserRole[]) {
  return async function enforceRole(req: FastifyRequest, reply: FastifyReply): Promise<void> {
    const user = req.authUser;
    if (!user || !allowed.includes(user.role)) {
      await reply.code(403).send({
        error: `Forbidden: requires role ${allowed.join(' or ')}`,
      });
    }
  };
}
