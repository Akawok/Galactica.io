import type { FastifyInstance } from "fastify";
import { User } from "../models/User.js";
import {
  ATTRIBUTE_KEYS,
  ATTRIBUTE_MAX,
  type Attributes,
  effectiveAttributes,
  emptyAttributes,
  respecCost,
  sanitizeAttributes,
  spentPoints,
  totalPoints,
} from "../shared/attributes.js";

const attributeProperties = Object.fromEntries(
  ATTRIBUTE_KEYS.map((k) => [
    k,
    { type: "integer", minimum: 0, maximum: ATTRIBUTE_MAX },
  ]),
);

function attributesFilter(a: Attributes) {
  return Object.fromEntries(
    ATTRIBUTE_KEYS.map((k) => [
      `attributes.${k}`,
      a[k] === 0 ? { $in: [0, null] } : a[k],
    ]),
  );
}

export async function attributesRoutes(app: FastifyInstance) {
  app.post<{ Body: { attributes: Attributes } }>(
    "/attributes",
    {
      onRequest: [app.authenticate],
      config: { rateLimit: { max: 30, timeWindow: "1 minute" } },
      schema: {
        body: {
          type: "object",
          required: ["attributes"],
          additionalProperties: false,
          properties: {
            attributes: {
              type: "object",
              required: ATTRIBUTE_KEYS,
              additionalProperties: false,
              properties: attributeProperties,
            },
          },
        },
      },
    },
    async (req, reply) => {
      const id = req.account!.id;
      const next = req.body.attributes;

      const user = await User.findById(id).select("attributes level").lean();
      if (!user)
        return reply.code(404).send({ error: "Utilisateur non trouvé" });

      const current = effectiveAttributes(user.attributes, user.level ?? 1);
      if (ATTRIBUTE_KEYS.some((k) => next[k] < current[k])) {
        return reply
          .code(400)
          .send({ error: "Pour retirer des points, passe par la remise à zéro" });
      }
      if (spentPoints(next) > totalPoints(user.level ?? 1)) {
        return reply.code(400).send({ error: "Pas assez de points" });
      }

      // The filter on the previous allocation makes concurrent requests fail instead of overwriting each other
      const updated = await User.findOneAndUpdate(
        { _id: id, ...attributesFilter(sanitizeAttributes(user.attributes)) },
        { $set: { attributes: next } },
        { new: true },
      ).select("attributes");
      if (!updated) {
        return reply
          .code(409)
          .send({ error: "Tes points ont changé entre-temps, réessaie" });
      }

      return reply.send({ attributes: next });
    },
  );

  app.post(
    "/attributes/reset",
    {
      onRequest: [app.authenticate],
      config: { rateLimit: { max: 10, timeWindow: "1 minute" } },
    },
    async (req, reply) => {
      const id = req.account!.id;

      const user = await User.findById(id)
        .select("attributes level respecCount galactics")
        .lean();
      if (!user)
        return reply.code(404).send({ error: "Utilisateur non trouvé" });

      const current = effectiveAttributes(user.attributes, user.level ?? 1);
      if (spentPoints(current) === 0) {
        return reply.code(400).send({ error: "Aucun point à remettre à zéro" });
      }

      const respecCount = user.respecCount ?? 0;
      const cost = respecCost(respecCount);
      const updated = await User.findOneAndUpdate(
        {
          _id: id,
          galactics: { $gte: cost },
          respecCount: respecCount === 0 ? { $in: [0, null] } : respecCount,
        },
        {
          $set: { attributes: emptyAttributes() },
          $inc: { galactics: -cost, respecCount: 1 },
        },
        { new: true },
      ).select("attributes galactics respecCount");

      if (!updated) {
        const fresh = await User.findById(id).select("galactics").lean();
        if ((fresh?.galactics ?? 0) < cost)
          return reply.code(400).send({ error: "Galactics insuffisants" });
        return reply.code(409).send({ error: "Réessaie dans un instant" });
      }

      return reply.send({
        attributes: emptyAttributes(),
        galactics: updated.galactics ?? 0,
        respecCost: respecCost(updated.respecCount ?? 0),
      });
    },
  );
}
