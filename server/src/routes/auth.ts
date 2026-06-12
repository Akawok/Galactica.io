import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { registerUser, loginUser } from "../services/auth.service.js";
import { User, serializeUser } from "../models/User.js";

// Rate-limit en mémoire contre le brute-force sur login/register : 10 tentatives/min par IP.
const AUTH_MAX_ATTEMPTS = 10;
const AUTH_WINDOW_MS = 60_000;
const authAttempts = new Map<string, { count: number; resetAt: number }>();

async function authRateLimit(req: FastifyRequest, reply: FastifyReply) {
  const now = Date.now();
  if (authAttempts.size > 10_000) {
    for (const [ip, entry] of authAttempts) {
      if (entry.resetAt <= now) authAttempts.delete(ip);
    }
  }
  const entry = authAttempts.get(req.ip);
  if (!entry || entry.resetAt <= now) {
    authAttempts.set(req.ip, { count: 1, resetAt: now + AUTH_WINDOW_MS });
    return;
  }
  entry.count++;
  if (entry.count > AUTH_MAX_ATTEMPTS) {
    return reply
      .code(429)
      .send({ error: "Trop de tentatives, réessaie dans une minute" });
  }
}

export async function authRoutes(app: FastifyInstance) {
  app.post<{
    Body: { username: string; email: string; password: string };
  }>(
    "/auth/register",
    {
      preHandler: authRateLimit,
      schema: {
        body: {
          type: "object",
          required: ["username", "email", "password"],
          properties: {
            username: { type: "string", minLength: 3, maxLength: 20 },
            email: { type: "string", format: "email" },
            password: { type: "string", minLength: 6 },
          },
        },
      },
    },
    async (req, reply) => {
      const { username, email, password } = req.body;
      try {
        const user = await registerUser(username, email, password);
        const token = app.jwt.sign(
          { id: user._id.toString(), username: user.username },
          { expiresIn: "7d" },
        );
        return reply.code(201).send({ token, user: serializeUser(user) });
      } catch (err: any) {
        return reply.code(400).send({ error: err.message });
      }
    },
  );

  app.post<{
    Body: { email: string; password: string };
  }>(
    "/auth/login",
    {
      preHandler: authRateLimit,
      schema: {
        body: {
          type: "object",
          required: ["email", "password"],
          properties: {
            email: { type: "string", format: "email" },
            password: { type: "string" },
          },
        },
      },
    },
    async (req, reply) => {
      const { email, password } = req.body;
      try {
        const user = await loginUser(email, password);
        const token = app.jwt.sign(
          { id: user._id.toString(), username: user.username },
          { expiresIn: "7d" },
        );
        return reply.send({ token, user: serializeUser(user) });
      } catch (err: any) {
        return reply.code(401).send({ error: err.message });
      }
    },
  );

  // Récupère le profil du joueur connecté
  app.get(
    "/auth/me",
    {
      onRequest: [app.authenticate],
    },
    async (req, reply) => {
      const { id } = req.user as { id: string; username: string };
      const user = await User.findById(id).select("-passwordHash");
      if (!user)
        return reply.code(404).send({ error: "Utilisateur non trouvé" });
      return reply.send({ user: serializeUser(user) });
    },
  );
}
