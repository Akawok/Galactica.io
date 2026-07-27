import type { FastifyInstance } from "fastify";
import { registerUser, loginUser } from "../services/auth.service.js";
import { User, serializeUser, isBanned } from "../models/User.js";
import {
  PASSWORD_MAX,
  PASSWORD_MIN,
  USERNAME_MAX,
  USERNAME_MIN,
  ValidationError,
} from "../services/identity.service.js";
import { config } from "../config.js";

export function signUserToken(app: FastifyInstance, user: {
  _id: unknown;
  username: string;
  role?: string;
  tokenVersion?: number;
}) {
  return app.jwt.sign(
    {
      id: String(user._id),
      username: user.username,
      role: user.role ?? "user",
      tv: user.tokenVersion ?? 0,
    },
    { expiresIn: config.tokenTTL },
  );
}

export async function authRoutes(app: FastifyInstance) {
  app.post<{
    Body: { username: string; email: string; password: string };
  }>(
    "/auth/register",
    {
      config: { rateLimit: { max: 5, timeWindow: "10 minutes" } },
      schema: {
        body: {
          type: "object",
          required: ["username", "email", "password"],
          additionalProperties: false,
          properties: {
            username: {
              type: "string",
              minLength: USERNAME_MIN,
              maxLength: USERNAME_MAX,
            },
            email: { type: "string", format: "email", maxLength: 254 },
            password: {
              type: "string",
              minLength: PASSWORD_MIN,
              maxLength: PASSWORD_MAX,
            },
          },
        },
      },
    },
    async (req, reply) => {
      const { username, email, password } = req.body;
      try {
        const user = await registerUser(username, email, password);
        return reply
          .code(201)
          .send({ token: signUserToken(app, user), user: serializeUser(user) });
      } catch (err) {
        if (err instanceof ValidationError) {
          return reply.code(400).send({ error: err.message });
        }
        req.log.error({ err }, "register failed");
        return reply.code(500).send({ error: "Erreur serveur" });
      }
    },
  );

  app.post<{
    Body: { email: string; password: string };
  }>(
    "/auth/login",
    {
      config: { rateLimit: { max: 10, timeWindow: "5 minutes" } },
      schema: {
        body: {
          type: "object",
          required: ["email", "password"],
          additionalProperties: false,
          properties: {
            email: { type: "string", maxLength: 254 },
            password: { type: "string", maxLength: PASSWORD_MAX },
          },
        },
      },
    },
    async (req, reply) => {
      const { email, password } = req.body;
      try {
        const user = await loginUser(email, password);
        return reply.send({
          token: signUserToken(app, user),
          user: serializeUser(user),
        });
      } catch (err) {
        if (err instanceof ValidationError) {
          return reply.code(401).send({ error: err.message });
        }
        req.log.error({ err }, "login failed");
        return reply.code(500).send({ error: "Erreur serveur" });
      }
    },
  );

  app.get(
    "/auth/me",
    {
      onRequest: [app.authenticate],
    },
    async (req, reply) => {
      const { id } = req.user as { id: string };
      const user = await User.findById(id);
      if (!user)
        return reply.code(404).send({ error: "Utilisateur non trouvé" });
      if (isBanned(user))
        return reply.code(403).send({ error: "Compte suspendu" });
      return reply.send({ user: serializeUser(user) });
    },
  );
}
