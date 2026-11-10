import type { FastifyInstance } from "fastify";
import {
  registerUser,
  loginUser,
  hashPassword,
  clearLoginFailures,
} from "../services/auth.service.js";
import { User, serializeUser, isBanned } from "../models/User.js";
import {
  PASSWORD_MAX,
  PASSWORD_MIN,
  USERNAME_MAX,
  USERNAME_MIN,
  ValidationError,
  validatePassword,
  emailKey,
} from "../services/identity.service.js";
import { config } from "../config.js";
import { clearSession, issueSession } from "../services/session.service.js";
import {
  consumeToken,
  issueToken,
  peekToken,
} from "../services/token.service.js";
import {
  sendEmailVerification,
  sendPasswordReset,
} from "../services/mailer.service.js";
import { disconnectUserSockets } from "../sockets/registry.js";

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
        const csrfToken = issueSession(reply, signUserToken(app, user));
        return reply
          .code(201)
          .send({ csrfToken, user: serializeUser(user) });
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
        const csrfToken = issueSession(reply, signUserToken(app, user));
        return reply.send({ csrfToken, user: serializeUser(user) });
      } catch (err) {
        if (err instanceof ValidationError) {
          return reply.code(401).send({ error: err.message });
        }
        req.log.error({ err }, "login failed");
        return reply.code(500).send({ error: "Erreur serveur" });
      }
    },
  );

  app.post("/auth/logout", async (_req, reply) => {
    clearSession(reply);
    return reply.send({ ok: true });
  });

  app.post<{ Body: { email: string } }>(
    "/auth/forgot-password",
    {
      config: { rateLimit: { max: 3, timeWindow: "15 minutes" } },
      schema: {
        body: {
          type: "object",
          required: ["email"],
          additionalProperties: false,
          properties: { email: { type: "string", maxLength: 254 } },
        },
      },
    },
    async (req, reply) => {
      const email = emailKey(req.body.email);
      const user = await User.findOne({ email }).select("_id email").lean();

      if (user) {
        const token = await issueToken(user._id, "password-reset");
        await sendPasswordReset(user.email, token);
      }

      return reply.send({
        ok: true,
        message:
          "Si un compte existe pour cette adresse, un lien vient d'être envoyé.",
      });
    },
  );

  app.post<{ Body: { token: string; password: string } }>(
    "/auth/reset-password",
    {
      config: { rateLimit: { max: 5, timeWindow: "15 minutes" } },
      schema: {
        body: {
          type: "object",
          required: ["token", "password"],
          additionalProperties: false,
          properties: {
            token: { type: "string", minLength: 20, maxLength: 200 },
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
      const candidateId = await peekToken(req.body.token, "password-reset");
      if (!candidateId) {
        return reply.code(400).send({ error: "Lien invalide ou expiré" });
      }

      const user = await User.findById(candidateId)
        .select("username email")
        .lean();
      if (!user) return reply.code(400).send({ error: "Lien invalide" });

      let password: string;
      try {
        password = validatePassword(req.body.password, user.username);
      } catch (err) {
        if (err instanceof ValidationError) {
          return reply.code(400).send({ error: err.message });
        }
        throw err;
      }

      const userId = await consumeToken(req.body.token, "password-reset");
      if (!userId) {
        return reply.code(400).send({ error: "Lien invalide ou expiré" });
      }

      await User.updateOne(
        { _id: userId },
        {
          $set: {
            passwordHash: await hashPassword(password),
          },
          $inc: { tokenVersion: 1 },
        },
      );
      disconnectUserSockets(String(userId), "Mot de passe modifié");
      clearLoginFailures(user.email);
      clearSession(reply);

      return reply.send({ ok: true });
    },
  );

  app.post(
    "/auth/send-verification",
    {
      onRequest: [app.authenticate],
      config: { rateLimit: { max: 3, timeWindow: "15 minutes" } },
    },
    async (req, reply) => {
      const user = await User.findById(req.account!.id)
        .select("email emailVerified")
        .lean();
      if (!user) return reply.code(404).send({ error: "Compte introuvable" });
      if (user.emailVerified) {
        return reply.send({ ok: true, alreadyVerified: true });
      }

      const token = await issueToken(req.account!.id, "email-verify");
      await sendEmailVerification(user.email, token);
      return reply.send({ ok: true });
    },
  );

  app.post<{ Body: { token: string } }>(
    "/auth/verify-email",
    {
      config: { rateLimit: { max: 10, timeWindow: "15 minutes" } },
      schema: {
        body: {
          type: "object",
          required: ["token"],
          additionalProperties: false,
          properties: {
            token: { type: "string", minLength: 20, maxLength: 200 },
          },
        },
      },
    },
    async (req, reply) => {
      const userId = await consumeToken(req.body.token, "email-verify");
      if (!userId) {
        return reply.code(400).send({ error: "Lien invalide ou expiré" });
      }
      await User.updateOne({ _id: userId }, { $set: { emailVerified: true } });
      return reply.send({ ok: true });
    },
  );

  app.get(
    "/auth/me",
    {
      onRequest: [app.authenticate],
    },
    async (req, reply) => {
      const id = req.account!.id;
      const user = await User.findById(id);
      if (!user)
        return reply.code(404).send({ error: "Utilisateur non trouvé" });
      if (isBanned(user))
        return reply.code(403).send({ error: "Compte suspendu" });
      return reply.send({ user: serializeUser(user) });
    },
  );
}
