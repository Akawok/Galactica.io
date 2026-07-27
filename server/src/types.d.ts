import "@fastify/jwt";
import type { AuthorizedAccount } from "./services/access.service.js";
import type { UserRole } from "./models/User.js";

declare module "fastify" {
  interface FastifyInstance {
    authenticate: (
      request: FastifyRequest,
      reply: FastifyReply,
    ) => Promise<unknown>;
    requireRole: (
      role: UserRole,
    ) => (request: FastifyRequest, reply: FastifyReply) => Promise<unknown>;
  }

  interface FastifyRequest {
    account?: AuthorizedAccount;
  }
}
