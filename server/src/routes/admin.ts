import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import mongoose from "mongoose";
import { User, serializeUser, type UserRole } from "../models/User.js";
import { ChatMessage } from "../models/ChatMessage.js";
import { Game } from "../models/Game.js";
import { Token } from "../models/Token.js";
import { hasRole } from "../services/access.service.js";
import {
  disconnectUserSockets,
  getIO,
  socketCountForUser,
} from "../sockets/registry.js";
import {
  closeRoomsOfUser,
  findOnlinePlayer,
  listOnlinePlayers,
} from "../sockets/lobby.js";
import { AuditLog, recordAudit, type AuditAction } from "../models/AuditLog.js";
import {
  ValidationError,
  canonicalUsername,
  normalizeUsername,
} from "../services/identity.service.js";
import { issueToken } from "../services/token.service.js";
import { sendPasswordReset } from "../services/mailer.service.js";
import {
  emptyAttributes,
  sanitizeAttributes,
  spentPoints,
  totalPoints,
} from "../shared/attributes.js";
import { MAX_LEVEL, xpForLevel } from "../shared/xp.js";

// A moderator action must close the player's match neutrally, never as a desertion
function forceLogout(userId: string, reason: string) {
  const io = getIO();
  if (io) closeRoomsOfUser(io, userId, "Un joueur a été retiré par la modération");
  disconnectUserSockets(userId, reason);
}

const objectIdParam = {
  type: "object",
  required: ["userId"],
  additionalProperties: false,
  properties: { userId: { type: "string", pattern: "^[a-fA-F0-9]{24}$" } },
};

// Far enough to never expire, still a real date so isBanned() keeps working
const PERMANENT_BAN = new Date("9999-12-31T00:00:00Z");

const LIST_FIELDS =
  "username email role level xp points galactics stats createdAt bannedUntil banReason mutedUntil emailVerified";

type UserFilter = "all" | "online" | "banned" | "muted" | "staff" | "unverified";
type UserSort = "recent" | "points" | "level" | "games" | "name";

const SORTS: Record<UserSort, Record<string, 1 | -1>> = {
  recent: { createdAt: -1 },
  points: { points: -1 },
  level: { level: -1, xp: -1 },
  games: { "stats.totalGames": -1 },
  name: { usernameCanonical: 1 },
};

function toUserView(user: any, withEmail: boolean) {
  const id = String(user._id);
  return {
    id,
    username: user.username,
    email: withEmail ? user.email : undefined,
    role: (user.role ?? "user") as UserRole,
    level: user.level ?? 1,
    xp: user.xp ?? 0,
    points: user.points ?? 0,
    galactics: user.galactics ?? 0,
    stats: user.stats ?? {},
    createdAt: user.createdAt ?? null,
    bannedUntil: user.bannedUntil ?? null,
    banReason: user.banReason ?? null,
    mutedUntil: user.mutedUntil ?? null,
    emailVerified: !!user.emailVerified,
    online: socketCountForUser(id) > 0,
  };
}

function actorOf(req: FastifyRequest) {
  return {
    actorId: req.account!.id,
    actorUsername: req.account!.username,
    ip: req.ip,
  };
}

async function audit(
  req: FastifyRequest,
  action: AuditAction,
  target: { _id: unknown; username: string } | null,
  details?: Record<string, unknown>,
) {
  await recordAudit({
    action,
    ...actorOf(req),
    targetId: target ? String(target._id) : undefined,
    targetUsername: target?.username,
    details,
  });
}

export async function adminRoutes(app: FastifyInstance) {
  const moderator = {
    onRequest: [app.authenticate],
    preHandler: [app.requireRole("moderator")],
  };
  const admin = {
    onRequest: [app.authenticate],
    preHandler: [app.requireRole("admin")],
  };

  app.get<{
    Querystring: {
      q?: string;
      filter?: UserFilter;
      sort?: UserSort;
      page?: number;
      limit?: number;
    };
  }>(
    "/admin/users",
    {
      ...moderator,
      schema: {
        querystring: {
          type: "object",
          additionalProperties: false,
          properties: {
            q: { type: "string", maxLength: 60 },
            filter: {
              type: "string",
              enum: ["all", "online", "banned", "muted", "staff", "unverified"],
            },
            sort: {
              type: "string",
              enum: ["recent", "points", "level", "games", "name"],
            },
            page: { type: "integer", minimum: 1, maximum: 10_000 },
            limit: { type: "integer", minimum: 1, maximum: 100 },
          },
        },
      },
    },
    async (req, reply) => {
      const { q, filter = "all", sort = "recent", page = 1, limit = 25 } =
        req.query;
      const isAdmin = req.account!.role === "admin";
      const conditions: Record<string, unknown>[] = [];

      const search = q?.trim();
      if (search) {
        const prefix = { $regex: `^${escapeRegex(search)}`, $options: "i" };
        const or: Record<string, unknown>[] = [{ username: prefix }];
        // Emails are personal data, only admins may look them up
        if (isAdmin) or.push({ email: prefix });
        if (/^[a-fA-F0-9]{24}$/.test(search)) or.push({ _id: search });
        conditions.push({ $or: or });
      }

      const now = new Date();
      if (filter === "online") {
        const ids = [...new Set(listOnlinePlayers().map((p) => p.userId))];
        conditions.push({ _id: { $in: ids } });
      } else if (filter === "banned") {
        conditions.push({ bannedUntil: { $gt: now } });
      } else if (filter === "muted") {
        conditions.push({ mutedUntil: { $gt: now } });
      } else if (filter === "staff") {
        conditions.push({ role: { $in: ["moderator", "admin"] } });
      } else if (filter === "unverified") {
        conditions.push({ emailVerified: { $ne: true } });
      }

      const query = conditions.length ? { $and: conditions } : {};
      const [users, total] = await Promise.all([
        User.find(query)
          .select(LIST_FIELDS)
          .sort(SORTS[sort])
          .skip((page - 1) * limit)
          .limit(limit)
          .lean(),
        User.countDocuments(query),
      ]);
      return reply.send({
        users: users.map((u) => toUserView(u, isAdmin)),
        total,
        page,
        limit,
      });
    },
  );

  app.get<{ Params: { userId: string } }>(
    "/admin/users/:userId",
    { ...moderator, schema: { params: objectIdParam } },
    async (req, reply) => {
      const { userId } = req.params;
      const user = await User.findById(userId)
        .select(
          `${LIST_FIELDS} attributes respecCount activeShip activeBullet activeBulletSecondary inventory`,
        )
        .populate("inventory", "name type bulletRole sprite")
        .lean();
      if (!user) return reply.code(404).send({ error: "Joueur non trouvé" });

      const [games, history] = await Promise.all([
        Game.find({ "players.userId": user._id })
          .select("roomId players winner createdAt endedAt")
          .sort({ endedAt: -1, createdAt: -1 })
          .limit(20)
          .lean(),
        AuditLog.find({ targetId: user._id })
          // Staff IPs are only for admins, like emails
          .select(req.account!.role === "admin" ? "" : "-ip")
          .sort({ createdAt: -1 })
          .limit(30)
          .lean(),
      ]);

      return reply.send({
        user: {
          ...toUserView(user, req.account!.role === "admin"),
          attributes: sanitizeAttributes(user.attributes),
          attributePoints: totalPoints(user.level ?? 1),
          respecCount: user.respecCount ?? 0,
          loadout: {
            ship: user.activeShip,
            bullet: user.activeBullet,
            bulletSecondary: user.activeBulletSecondary,
          },
          inventory: (user.inventory as any[]).map((i) => ({
            id: String(i._id),
            name: i.name,
            type: i.type,
            bulletRole: i.bulletRole ?? null,
          })),
        },
        live: findOnlinePlayer(userId),
        games: games.map((g) => serializeGame(g, userId)),
        history,
      });
    },
  );

  app.post<{
    Params: { userId: string };
    Body: { durationMinutes?: number; permanent?: boolean; reason?: string };
  }>(
    "/admin/users/:userId/ban",
    {
      ...moderator,
      schema: {
        params: objectIdParam,
        body: {
          type: "object",
          additionalProperties: false,
          properties: {
            durationMinutes: { type: "integer", minimum: 1, maximum: 525_600 },
            permanent: { type: "boolean" },
            reason: { type: "string", maxLength: 200 },
          },
        },
      },
    },
    async (req, reply) => {
      const { durationMinutes, permanent, reason } = req.body ?? {};
      if (!permanent && !durationMinutes) {
        return reply.code(400).send({ error: "Précise une durée" });
      }
      const target = await findModeratableTarget(req, reply);
      if (!target) return;

      const bannedUntil = permanent
        ? PERMANENT_BAN
        : new Date(Date.now() + durationMinutes! * 60_000);
      await User.updateOne(
        { _id: target._id },
        {
          $set: { bannedUntil, banReason: reason ?? null },
          $inc: { tokenVersion: 1 },
        },
      );
      forceLogout(String(target._id), "Compte suspendu");

      await audit(req, "ban", target, {
        bannedUntil,
        permanent: !!permanent,
        reason: reason ?? null,
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
      await audit(req, "unban", target);
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
      await audit(req, "mute", target, { mutedUntil });
      return reply.send({ userId: String(target._id), mutedUntil });
    },
  );

  app.post<{ Params: { userId: string } }>(
    "/admin/users/:userId/kick",
    { ...moderator, schema: { params: objectIdParam } },
    async (req, reply) => {
      const target = await findModeratableTarget(req, reply);
      if (!target) return;

      await User.updateOne({ _id: target._id }, { $inc: { tokenVersion: 1 } });
      forceLogout(String(target._id), "Tu as été déconnecté");
      await audit(req, "kick", target);
      return reply.send({ ok: true });
    },
  );

  app.post<{ Params: { userId: string }; Body: { username: string } }>(
    "/admin/users/:userId/rename",
    {
      ...moderator,
      schema: {
        params: objectIdParam,
        body: {
          type: "object",
          required: ["username"],
          additionalProperties: false,
          properties: { username: { type: "string", maxLength: 40 } },
        },
      },
    },
    async (req, reply) => {
      const target = await findModeratableTarget(req, reply);
      if (!target) return;

      let username: string;
      try {
        username = normalizeUsername(req.body.username);
      } catch (err) {
        if (err instanceof ValidationError)
          return reply.code(400).send({ error: err.message });
        throw err;
      }
      const usernameCanonical = canonicalUsername(username);
      const taken = await User.exists({
        usernameCanonical,
        _id: { $ne: target._id },
      });
      if (taken)
        return reply.code(409).send({ error: "Ce pseudo est déjà pris" });

      try {
        // The username is inside the session token, so the player must log in again
        await User.updateOne(
          { _id: target._id },
          { $set: { username, usernameCanonical }, $inc: { tokenVersion: 1 } },
        );
      } catch (err: any) {
        if (err?.code === 11000)
          return reply.code(409).send({ error: "Ce pseudo est déjà pris" });
        throw err;
      }
      forceLogout(String(target._id), "Ton pseudo a été modifié, reconnecte-toi");
      await audit(
        req,
        "rename",
        { _id: target._id, username },
        { from: target.username, to: username },
      );
      return reply.send({ userId: String(target._id), username });
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

      forceLogout(userId, "Rôle modifié, reconnecte-toi");
      await audit(req, "role-change", updated, { role: req.body.role });
      return reply.send({ user: serializeUser(updated) });
    },
  );

  app.patch<{
    Params: { userId: string };
    Body: { points?: number; galactics?: number; level?: number; xp?: number };
  }>(
    "/admin/users/:userId/resources",
    {
      ...admin,
      schema: {
        params: objectIdParam,
        body: {
          type: "object",
          additionalProperties: false,
          minProperties: 1,
          properties: {
            points: { type: "integer", minimum: 0, maximum: 100_000_000 },
            galactics: { type: "integer", minimum: 0, maximum: 1_000_000 },
            level: { type: "integer", minimum: 1, maximum: MAX_LEVEL },
            xp: { type: "integer", minimum: 0, maximum: 100_000 },
          },
        },
      },
    },
    async (req, reply) => {
      const user = await User.findById(req.params.userId)
        .select("username points galactics level xp attributes")
        .lean();
      if (!user) return reply.code(404).send({ error: "Joueur non trouvé" });

      const before = {
        points: user.points ?? 0,
        galactics: user.galactics ?? 0,
        level: user.level ?? 1,
        xp: user.xp ?? 0,
      };
      const level = req.body.level ?? before.level;
      const levelChanged = level !== before.level;
      let xp = req.body.xp ?? (levelChanged ? 0 : before.xp);
      xp =
        level >= MAX_LEVEL ? 0 : Math.min(xp, Math.max(0, xpForLevel(level) - 1));
      const after = {
        points: req.body.points ?? before.points,
        galactics: req.body.galactics ?? before.galactics,
        level,
        xp,
      };

      // A lower level can leave more points spent than the new level allows
      const attributesReset =
        spentPoints(sanitizeAttributes(user.attributes)) > totalPoints(level);
      const $set: Record<string, unknown> = { ...after };
      if (attributesReset) $set.attributes = emptyAttributes();

      await User.updateOne({ _id: user._id }, { $set });
      await audit(req, "resources", user, { before, after, attributesReset });
      return reply.send({ ...after, attributesReset });
    },
  );

  app.post<{ Params: { userId: string } }>(
    "/admin/users/:userId/reset-attributes",
    { ...admin, schema: { params: objectIdParam } },
    async (req, reply) => {
      const user = await User.findByIdAndUpdate(
        req.params.userId,
        { $set: { attributes: emptyAttributes() } },
        { new: true },
      )
        .select("username")
        .lean();
      if (!user) return reply.code(404).send({ error: "Joueur non trouvé" });
      await audit(req, "reset-attributes", user);
      return reply.send({ ok: true });
    },
  );

  app.post<{ Params: { userId: string } }>(
    "/admin/users/:userId/verify-email",
    { ...admin, schema: { params: objectIdParam } },
    async (req, reply) => {
      const user = await User.findByIdAndUpdate(
        req.params.userId,
        { $set: { emailVerified: true } },
        { new: true },
      )
        .select("username")
        .lean();
      if (!user) return reply.code(404).send({ error: "Joueur non trouvé" });
      await Token.deleteMany({ userId: user._id, purpose: "email-verify" });
      await audit(req, "verify-email", user);
      return reply.send({ ok: true });
    },
  );

  app.post<{ Params: { userId: string } }>(
    "/admin/users/:userId/send-reset",
    {
      ...admin,
      config: { rateLimit: { max: 10, timeWindow: "15 minutes" } },
      schema: { params: objectIdParam },
    },
    async (req, reply) => {
      const user = await User.findById(req.params.userId)
        .select("username email")
        .lean();
      if (!user) return reply.code(404).send({ error: "Joueur non trouvé" });
      const token = await issueToken(user._id, "password-reset");
      await sendPasswordReset(user.email, token);
      await audit(req, "send-reset", user);
      return reply.send({ ok: true });
    },
  );

  app.post<{ Params: { userId: string }; Body: { confirm: string } }>(
    "/admin/users/:userId/delete",
    {
      ...admin,
      schema: {
        params: objectIdParam,
        body: {
          type: "object",
          required: ["confirm"],
          additionalProperties: false,
          properties: { confirm: { type: "string", maxLength: 40 } },
        },
      },
    },
    async (req, reply) => {
      const { userId } = req.params;
      if (userId === req.account!.id) {
        return reply
          .code(400)
          .send({ error: "Impossible de supprimer son propre compte" });
      }
      const user = await User.findById(userId).select("username role").lean();
      if (!user) return reply.code(404).send({ error: "Joueur non trouvé" });
      if (user.role === "admin") {
        return reply
          .code(403)
          .send({ error: "Retire d'abord le rôle admin de ce compte" });
      }
      if (req.body.confirm !== user.username) {
        return reply
          .code(400)
          .send({ error: "Recopie exactement le pseudo pour confirmer" });
      }

      forceLogout(userId, "Compte supprimé");
      await Promise.all([
        User.deleteOne({ _id: user._id }),
        Token.deleteMany({ userId: user._id }),
        ChatMessage.deleteMany({ username: user.username, system: { $ne: true } }),
      ]);
      getIO()?.emit("chat:removed", { username: user.username });
      // Past games keep the name, so the opponents' history stays readable
      await audit(req, "delete-account", user);
      return reply.send({ ok: true });
    },
  );

  app.get<{
    Querystring: {
      limit?: number;
      page?: number;
      action?: AuditAction;
      username?: string;
    };
  }>(
    "/admin/audit",
    {
      ...admin,
      schema: {
        querystring: {
          type: "object",
          additionalProperties: false,
          properties: {
            limit: { type: "integer", minimum: 1, maximum: 200 },
            page: { type: "integer", minimum: 1, maximum: 10_000 },
            action: {
              type: "string",
              enum: AuditLog.schema.path("action").options.enum,
            },
            username: { type: "string", maxLength: 40 },
          },
        },
      },
    },
    async (req, reply) => {
      const { limit = 50, page = 1, action, username } = req.query;
      const query: Record<string, unknown> = {};
      if (action) query.action = action;
      if (username?.trim()) {
        const prefix = {
          $regex: `^${escapeRegex(username.trim())}`,
          $options: "i",
        };
        query.$or = [{ actorUsername: prefix }, { targetUsername: prefix }];
      }
      const [entries, total] = await Promise.all([
        AuditLog.find(query)
          .sort({ createdAt: -1 })
          .skip((page - 1) * limit)
          .limit(limit)
          .lean(),
        AuditLog.countDocuments(query),
      ]);
      return reply.send({ entries, total, page, limit });
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
      const username = req.body?.username;
      // Grade messages and announcements carry a username but are not that player's words
      const filter = username ? { username, system: { $ne: true } } : {};
      const { deletedCount } = await ChatMessage.deleteMany(filter);
      getIO()?.emit("chat:removed", username ? { username } : { all: true });
      await recordAudit({
        action: "chat-purge",
        ...actorOf(req),
        targetUsername: username,
        details: { deletedCount },
      });
      return reply.send({ deletedCount });
    },
  );
}

export function serializeGame(g: any, forUserId?: string) {
  const winnerId = g.winner ? String(g.winner) : null;
  const players = (g.players ?? []).map((p: any) => ({
    userId: p.userId ? String(p.userId) : null,
    username: p.username,
    score: p.score ?? 0,
  }));
  return {
    id: String(g._id),
    roomId: g.roomId,
    players,
    winner: players.find((p: any) => p.userId && p.userId === winnerId)
      ?.username ?? null,
    won: forUserId ? winnerId === forUserId : undefined,
    createdAt: g.createdAt ?? null,
    endedAt: g.endedAt ?? null,
  };
}

export function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function findModeratableTarget(req: any, reply: FastifyReply) {
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
  const targetRole = (target.role ?? "user") as UserRole;
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
