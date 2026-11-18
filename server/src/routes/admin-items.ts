import type { FastifyInstance, FastifyReply } from "fastify";
import { Item, type ItemType, type BulletRole } from "../models/Item.js";
import { DEFAULT_LOADOUT, User } from "../models/User.js";
import { recordAudit } from "../models/AuditLog.js";
import { BOT_BULLET, BOT_BULLET_SECONDARY } from "../services/bot.service.js";
import { unequipFromConnected } from "../sockets/lobby.js";
import { SLOTS_BY_TYPE, purgeItem } from "../services/item.service.js";
import {
  AssetError,
  MAX_FRAMES,
  MAX_IMAGE_BYTES,
  SPRITE_PATTERN,
  decodeImages,
  readImageInfo,
  replaceItemImages,
  withImages,
} from "../services/item-assets.service.js";

const UPLOAD_BODY_LIMIT = Math.ceil(MAX_FRAMES * MAX_IMAGE_BYTES * 1.4) + 64 * 1024;

const imagesSchema = {
  type: "array",
  minItems: 1,
  maxItems: MAX_FRAMES,
  items: {
    type: "string",
    maxLength: Math.ceil((MAX_IMAGE_BYTES * 4) / 3) + 4,
    pattern: "^[A-Za-z0-9+/]+={0,2}$",
  },
};

const editableFields = {
  name: { type: "string", minLength: 1, maxLength: 40 },
  description: { type: "string", maxLength: 200 },
  price: { type: "integer", minimum: 0, maximum: 1_000_000 },
  priceGalactics: { type: "integer", minimum: 0, maximum: 10_000 },
};

const itemIdParam = {
  type: "object",
  required: ["itemId"],
  additionalProperties: false,
  properties: { itemId: { type: "string", pattern: "^[a-fA-F0-9]{24}$" } },
};

interface CreateBody {
  name: string;
  description?: string;
  price: number;
  priceGalactics?: number;
  type: Extract<ItemType, "ship" | "bullet">;
  bulletRole?: BulletRole;
  sprite: string;
  images?: string[];
}

type UpdateBody = Partial<
  Pick<CreateBody, "name" | "description" | "price" | "priceGalactics">
>;

// Every player and the bot fall back on these, so they can never be deleted
const PROTECTED_SPRITES = new Set<string>([
  ...Object.values(DEFAULT_LOADOUT),
  BOT_BULLET,
  BOT_BULLET_SECONDARY,
]);

function isFree(item: { price: number; priceGalactics?: number | null }) {
  return item.price === 0 && (item.priceGalactics ?? 0) === 0;
}

// Free items are handed out at sign-up; existing players must get them too,
// otherwise they never show up in their hangar.
async function giveToEveryone(itemId: unknown) {
  await User.updateMany({}, { $addToSet: { inventory: itemId } });
}

function sendAssetError(reply: FastifyReply, err: unknown) {
  if (err instanceof AssetError) {
    return reply.code(400).send({ error: err.message });
  }
  throw err;
}

export async function adminItemsRoutes(app: FastifyInstance) {
  // The role is checked before the body is read, so only admins can send big uploads
  const adminOnly = {
    onRequest: [app.authenticate, app.requireRole("admin")],
  };

  app.get("/admin/items", adminOnly, async (_req, reply) => {
    const items = await Item.find().lean();
    return reply.send({ items: await withImages(items) });
  });

  app.post<{ Body: CreateBody }>(
    "/admin/items",
    {
      ...adminOnly,
      bodyLimit: UPLOAD_BODY_LIMIT,
      schema: {
        body: {
          type: "object",
          required: ["name", "price", "type", "sprite"],
          additionalProperties: false,
          properties: {
            ...editableFields,
            type: { type: "string", enum: ["ship", "bullet"] },
            bulletRole: { type: "string", enum: ["primary", "secondary"] },
            sprite: { type: "string", pattern: SPRITE_PATTERN },
            images: imagesSchema,
          },
        },
      },
    },
    async (req, reply) => {
      const { images, ...fields } = req.body;
      if (fields.type === "bullet" && !fields.bulletRole) {
        return reply
          .code(400)
          .send({ error: "Précise si c'est un tir principal ou secondaire" });
      }
      if (fields.type === "ship") delete fields.bulletRole;

      if (await Item.exists({ sprite: fields.sprite })) {
        return reply.code(409).send({ error: "Cet identifiant est déjà pris" });
      }

      if (images) {
        try {
          await replaceItemImages(fields.type, fields.sprite, decodeImages(images));
        } catch (err) {
          return sendAssetError(reply, err);
        }
      } else if ((await readImageInfo(fields.type, fields.sprite)).frames === 0) {
        return reply.code(400).send({ error: "Ajoute au moins une image" });
      }

      const item = await Item.create(fields);
      if (isFree(item)) await giveToEveryone(item._id);

      await recordAudit({
        action: "item-create",
        actorId: req.account!.id,
        actorUsername: req.account!.username,
        details: { itemId: String(item._id), sprite: item.sprite, name: item.name },
        ip: req.ip,
      });
      const [created] = await withImages([item.toObject()]);
      return reply.code(201).send({ item: created });
    },
  );

  app.patch<{ Params: { itemId: string }; Body: UpdateBody }>(
    "/admin/items/:itemId",
    {
      ...adminOnly,
      schema: {
        params: itemIdParam,
        body: {
          type: "object",
          additionalProperties: false,
          minProperties: 1,
          properties: editableFields,
        },
      },
    },
    async (req, reply) => {
      const item = await Item.findByIdAndUpdate(
        req.params.itemId,
        { $set: req.body },
        { new: true },
      ).lean();
      if (!item) return reply.code(404).send({ error: "Item non trouvé" });
      if (isFree(item)) await giveToEveryone(item._id);

      await recordAudit({
        action: "item-update",
        actorId: req.account!.id,
        actorUsername: req.account!.username,
        details: { itemId: String(item._id), sprite: item.sprite, changes: req.body },
        ip: req.ip,
      });
      const [updated] = await withImages([item]);
      return reply.send({ item: updated });
    },
  );

  app.post<{ Params: { itemId: string }; Body: { images: string[] } }>(
    "/admin/items/:itemId/images",
    {
      ...adminOnly,
      bodyLimit: UPLOAD_BODY_LIMIT,
      schema: {
        params: itemIdParam,
        body: {
          type: "object",
          required: ["images"],
          additionalProperties: false,
          properties: { images: imagesSchema },
        },
      },
    },
    async (req, reply) => {
      const item = await Item.findById(req.params.itemId).lean();
      if (!item) return reply.code(404).send({ error: "Item non trouvé" });

      try {
        await replaceItemImages(item.type, item.sprite, decodeImages(req.body.images));
      } catch (err) {
        return sendAssetError(reply, err);
      }

      await recordAudit({
        action: "item-update",
        actorId: req.account!.id,
        actorUsername: req.account!.username,
        details: {
          itemId: String(item._id),
          sprite: item.sprite,
          frames: req.body.images.length,
        },
        ip: req.ip,
      });
      const [updated] = await withImages([item]);
      return reply.send({ item: updated });
    },
  );

  app.post<{ Params: { itemId: string } }>(
    "/admin/items/:itemId/delete",
    { ...adminOnly, schema: { params: itemIdParam } },
    async (req, reply) => {
      const item = await Item.findById(req.params.itemId).lean();
      if (!item) return reply.code(404).send({ error: "Item non trouvé" });
      if (PROTECTED_SPRITES.has(item.sprite)) {
        return reply
          .code(409)
          .send({ error: "Item de base du jeu, il ne peut pas être supprimé" });
      }

      const owners = await purgeItem(item);
      for (const slot of SLOTS_BY_TYPE[item.type]) {
        unequipFromConnected(slot, item.sprite);
      }

      await recordAudit({
        action: "item-delete",
        actorId: req.account!.id,
        actorUsername: req.account!.username,
        details: {
          itemId: String(item._id),
          sprite: item.sprite,
          name: item.name,
          owners,
        },
        ip: req.ip,
      });
      return reply.send({ ok: true, owners });
    },
  );
}
