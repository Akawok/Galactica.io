import mongoose from "mongoose";
import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Charge le .env manuellement (pas de dotenv pour rester léger)
function loadEnv() {
  try {
    const envPath = resolve(__dirname, "../../.env");
    const lines = readFileSync(envPath, "utf-8").split("\n");
    for (const line of lines) {
      const [key, ...vals] = line.split("=");
      if (key && vals.length) process.env[key.trim()] = vals.join("=").trim();
    }
  } catch {
    // En prod, les variables sont déjà injectées
  }
}

loadEnv();

export const config = {
  mongoUri: process.env.MONGO_URI ?? "mongodb://localhost:27017/galactica",
  jwtSecret: process.env.JWT_SECRET ?? "change_me",
  port: Number(process.env.PORT ?? 3000),
  clientUrl: process.env.CLIENT_URL ?? "http://localhost:5173",
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
