import type { FastifyInstance } from "fastify";
import { registerUser, loginUser } from "../services/auth.service.js";
import { User, serializeUser } from "../models/User.js";

export async function authRoutes(app: FastifyInstance) {
  app.post<{
    Body: { username: string; email: string; password: string };
  }>(
    "/auth/register",
    {
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
