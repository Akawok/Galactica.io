import type { FastifyInstance } from "fastify";
import mongoose from "mongoose";
import { User, serializeUser } from "../models/User.js";
import { ChatMessage } from "../models/ChatMessage.js";
import { hasRole } from "../services/access.service.js";
import { disconnectUserSockets } from "../sockets/registry.js";
import { AuditLog, recordAudit } from "../models/AuditLog.js";

const objectIdParam = {
  type: "object",
  required: ["userId"],
  additionalProperties: false,
  properties: { userId: { type: "string", minLength: 24, maxLength: 24 } },
};

export async function adminRoutes(app: FastifyInstance) {
  const moderator = {
    onRequest: [app.authenticate],
    preHandler: [app.requireRole("moderator")],
  };
  const admin = {
    onRequest: [app.authenticate],
    preHandler: [app.requireRole("admin")],
  };

  app.get<{ Querystring: { q?: string; limit?: number } }>(
    "/admin/users",
    {
      ...moderator,
      schema: {
        querystring: {
          type: "object",
          additionalProperties: false,
          properties: {
            q: { type: "string", maxLength: 40 },
            limit: { type: "integer", minimum: 1, maximum: 100 },
          },
        },
      },
    },
    async (req, reply) => {
      const { q, limit = 25 } = req.query;
      const filter = q
        ? { usernameCanonical: { $regex: `^${escapeRegex(q.toLowerCase())}` } }
        : {};
      const users = await User.find(filter)
        .select("username role bannedUntil banReason mutedUntil stats points")
        .limit(limit)
        .lean();
      return reply.send({ users });
    },
  );

  app.post<{
    Params: { userId: string };
    Body: { durationMinutes: number; reason?: string };
  }>(
    "/admin/users/:userId/ban",
    {
      ...moderator,
      schema: {
        params: objectIdParam,
        body: {
          type: "object",
          required: ["durationMinutes"],
          additionalProperties: false,
          properties: {
            durationMinutes: { type: "integer", minimum: 1, maximum: 525_600 },
            reason: { type: "string", maxLength: 200 },
          },
        },
      },
    },
    async (req, reply) => {
      const target = await findModeratableTarget(req, reply);
      if (!target) return;

      const bannedUntil = new Date(
        Date.now() + req.body.durationMinutes * 60_000,
      );
      await User.updateOne(
        { _id: target._id },
        {
          $set: { bannedUntil, banReason: req.body.reason ?? null },
          $inc: { tokenVersion: 1 },
        },
      );
      disconnectUserSockets(String(target._id), "Compte suspendu");

      await recordAudit({
        action: "ban",
        actorId: req.account!.id,
        actorUsername: req.account!.username,
        targetId: String(target._id),
        targetUsername: target.username,
        details: { bannedUntil, reason: req.body.reason ?? null },
        ip: req.ip,
      });
      return reply.send({ userId: String(target._id), bannedUntil });
    },
  );

  app.post<{ Params: { userId: string } }>(
    "/admin/users/:userId/unban",
    { ...moderator, schema: { params: objectIdParam } },
    async (req, reply) => {
      const target = await findModeratableTarget(req, reply);
      if (!target) return;

      await User.updateOne(
        { _id: target._id },
        { $set: { bannedUntil: null, banReason: null } },
      );
      await recordAudit({
        action: "unban",
        actorId: req.account!.id,
        actorUsername: req.account!.username,
        targetId: String(target._id),
        targetUsername: target.username,
        ip: req.ip,
      });
      return reply.send({ userId: String(target._id), bannedUntil: null });
    },
  );

  app.post<{
    Params: { userId: string };
    Body: { durationMinutes: number };
  }>(
    "/admin/users/:userId/mute",
    {
      ...moderator,
      schema: {
        params: objectIdParam,
        body: {
          type: "object",
          required: ["durationMinutes"],
          additionalProperties: false,
          properties: {
            durationMinutes: { type: "integer", minimum: 0, maximum: 10_080 },
          },
        },
      },
    },
    async (req, reply) => {
      const target = await findModeratableTarget(req, reply);
      if (!target) return;

      const mutedUntil =
        req.body.durationMinutes === 0
          ? null
          : new Date(Date.now() + req.body.durationMinutes * 60_000);
      await User.updateOne({ _id: target._id }, { $set: { mutedUntil } });
      await recordAudit({
        action: "mute",
        actorId: req.account!.id,
        actorUsername: req.account!.username,
        targetId: String(target._id),
        targetUsername: target.username,
        details: { mutedUntil },
        ip: req.ip,
      });
      return reply.send({ userId: String(target._id), mutedUntil });
    },
  );

  app.post<{ Params: { userId: string }; Body: { role: string } }>(
    "/admin/users/:userId/role",
    {
      ...admin,
      schema: {
        params: objectIdParam,
        body: {
          type: "object",
          required: ["role"],
          additionalProperties: false,
          properties: {
            role: { type: "string", enum: ["user", "moderator", "admin"] },
          },
        },
      },
    },
    async (req, reply) => {
      const { userId } = req.params;
      if (userId === req.account?.id) {
        return reply
          .code(400)
          .send({ error: "Impossible de modifier son propre rôle" });
      }
      const updated = await User.findByIdAndUpdate(
        userId,
        { $set: { role: req.body.role }, $inc: { tokenVersion: 1 } },
        { new: true },
      );
      if (!updated)
        return reply.code(404).send({ error: "Utilisateur non trouvé" });

      disconnectUserSockets(userId, "Rôle modifié, reconnecte-toi");
      await recordAudit({
        action: "role-change",
        actorId: req.account!.id,
        actorUsername: req.account!.username,
        targetId: userId,
        targetUsername: updated.username,
        details: { role: req.body.role },
        ip: req.ip,
      });
      return reply.send({ user: serializeUser(updated) });
    },
  );

  app.get<{ Querystring: { limit?: number } }>(
    "/admin/audit",
    {
      ...admin,
      schema: {
        querystring: {
          type: "object",
          additionalProperties: false,
          properties: {
            limit: { type: "integer", minimum: 1, maximum: 200 },
          },
        },
      },
    },
    async (req, reply) => {
      const entries = await AuditLog.find()
        .sort({ createdAt: -1 })
        .limit(req.query.limit ?? 50)
        .lean();
      return reply.send({ entries });
    },
  );

  app.post<{ Body: { username?: string } }>(
    "/admin/chat/purge",
    {
      ...moderator,
      schema: {
        body: {
          type: "object",
          additionalProperties: false,
          properties: { username: { type: "string", maxLength: 20 } },
        },
      },
    },
    async (req, reply) => {
      const filter = req.body?.username
        ? { username: req.body.username }
        : {};
      const { deletedCount } = await ChatMessage.deleteMany(filter);
      await recordAudit({
        action: "chat-purge",
        actorId: req.account!.id,
        actorUsername: req.account!.username,
        targetUsername: req.body?.username,
        details: { deletedCount },
        ip: req.ip,
      });
      return reply.send({ deletedCount });
    },
  );
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function findModeratableTarget(req: any, reply: any) {
  const { userId } = req.params as { userId: string };
  if (!mongoose.Types.ObjectId.isValid(userId)) {
    reply.code(400).send({ error: "Identifiant invalide" });
    return null;
  }
  if (userId === req.account?.id) {
    reply.code(400).send({ error: "Action impossible sur son propre compte" });
    return null;
  }

  const target = await User.findById(userId).select("role username").lean();
  if (!target) {
    reply.code(404).send({ error: "Utilisateur non trouvé" });
    return null;
  }

  const actorRole = req.account.role;
  const targetRole = (target.role ?? "user") as "user" | "moderator" | "admin";
  if (hasRole(targetRole, actorRole) && actorRole !== "admin") {
    reply
      .code(403)
      .send({ error: "Impossible de modérer un compte de rang égal ou supérieur" });
    return null;
  }
  if (targetRole === "admin") {
    reply.code(403).send({ error: "Impossible de modérer un administrateur" });
    return null;
  }

  return target;
}
