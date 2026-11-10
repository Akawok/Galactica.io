import mongoose from "mongoose";
import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadEnv() {
  try {
    const envPath = resolve(__dirname, "../../.env");
    const lines = readFileSync(envPath, "utf-8").split("\n");
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;

      const separator = trimmed.indexOf("=");
      if (separator <= 0) continue;

      const key = trimmed.slice(0, separator).trim();
      if (key in process.env) continue;

      process.env[key] = trimmed
        .slice(separator + 1)
        .trim()
        .replace(/^(['"])(.*)\1$/, "$2");
    }
  } catch {}
}

loadEnv();

const MIN_SECRET_LENGTH = 32;
const FORBIDDEN_SECRETS = new Set([
  "change_me",
  "changeme",
  "secret",
  "jwtsecret",
  "dev",
  "test",
  "password",
]);

function resolveJwtSecret(): string {
  const secret = process.env.JWT_SECRET?.trim();

  if (!secret) {
    console.error(
      "❌ JWT_SECRET est obligatoire. Génère-le avec : openssl rand -hex 32",
    );
    process.exit(1);
  }
  if (secret.length < MIN_SECRET_LENGTH) {
    console.error(
      `❌ JWT_SECRET trop court (${secret.length} caractères, minimum ${MIN_SECRET_LENGTH}). Génère-le avec : openssl rand -hex 32`,
    );
    process.exit(1);
  }
  if (FORBIDDEN_SECRETS.has(secret.toLowerCase())) {
    console.error("❌ JWT_SECRET est une valeur par défaut connue, refusée.");
    process.exit(1);
  }
  return secret;
}

export const isProduction = process.env.NODE_ENV === "production";

export const config = {
  mongoUri: process.env.MONGO_URI ?? "mongodb://localhost:27017/galactica",
  jwtSecret: resolveJwtSecret(),
  port: Number(process.env.PORT ?? 3000),
  clientUrl: process.env.CLIENT_URL ?? "http://localhost:5173",
  tokenTTL: process.env.TOKEN_TTL ?? "12h",
  // Item images live on disk, one folder per item: <assetsDir>/spaceships/<sprite>/f1.png
  assetsDir: resolve(process.env.ASSETS_DIR ?? resolve(__dirname, "../assets")),
  captureMails:
    process.env.NODE_ENV !== "production" &&
    process.env.CAPTURE_MAILS === "true",
};

export async function connectDB() {
  try {
    await mongoose.connect(config.mongoUri);
    console.log("✅ MongoDB connecté");
  } catch (err) {
    console.error("❌ Erreur connexion MongoDB :", err);
    process.exit(1);
  }
}
