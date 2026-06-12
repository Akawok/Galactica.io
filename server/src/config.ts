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
      const [key, ...vals] = line.split("=");
      if (key && vals.length) process.env[key.trim()] = vals.join("=").trim();
    }
  } catch {}
}

loadEnv();

export const config = {
  mongoUri: process.env.MONGO_URI ?? "mongodb://localhost:27017/galactica",
  jwtSecret: process.env.JWT_SECRET ?? "change_me",
  port: Number(process.env.PORT ?? 3000),
  clientUrl: process.env.CLIENT_URL ?? "http://localhost:5173",
};

if (!process.env.JWT_SECRET) {
  if (process.env.NODE_ENV === "production") {
    console.error("❌ JWT_SECRET est obligatoire en production");
    process.exit(1);
  }
  console.warn(
    "⚠️  JWT_SECRET non défini — secret par défaut utilisé (dev uniquement, NE PAS déployer ainsi)",
  );
}

export async function connectDB() {
  try {
    await mongoose.connect(config.mongoUri);
    console.log("✅ MongoDB connecté");
  } catch (err) {
    console.error("❌ Erreur connexion MongoDB :", err);
    process.exit(1);
  }
}
