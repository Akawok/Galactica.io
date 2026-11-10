import type { FastifyInstance } from "fastify";
import { readFile } from "fs/promises";
import { extname } from "path";
import {
  CONTENT_TYPE,
  assetPath,
  isServableAsset,
  type ImageExt,
} from "../services/item-assets.service.js";

export async function assetsRoutes(app: FastifyInstance) {
  app.get<{
    Params: { dir: string; sprite: string; file: string };
    Querystring: { v?: string };
  }>(
    "/assets/:dir/:sprite/:file",
    { config: { rateLimit: false } },
    async (req, reply) => {
      const { dir, sprite, file } = req.params;
      if (!isServableAsset(dir, sprite, file)) {
        return reply.code(404).send({ error: "Ressource introuvable" });
      }

      let data: Buffer;
      try {
        data = await readFile(assetPath(dir, sprite, file));
      } catch {
        return reply.code(404).send({ error: "Ressource introuvable" });
      }

      // Versioned URLs change whenever the file changes, so they can be cached forever
      const cache = req.query.v
        ? "public, max-age=31536000, immutable"
        : "no-cache";
      return reply
        .header("Content-Type", CONTENT_TYPE[extname(file).slice(1) as ImageExt])
        .header("Cache-Control", cache)
        .header("Cross-Origin-Resource-Policy", "cross-origin")
        .send(data);
    },
  );
}
