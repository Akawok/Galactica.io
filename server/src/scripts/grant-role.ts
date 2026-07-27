import mongoose from "mongoose";
import { connectDB } from "../config.js";
import { User } from "../models/User.js";
import { canonicalUsername } from "../services/identity.service.js";

const [, , username, role = "admin"] = process.argv;

if (!username || !["user", "moderator", "admin"].includes(role)) {
  console.error(
    "Usage: node dist/scripts/grant-role.js <username> [user|moderator|admin]",
  );
  process.exit(1);
}

await connectDB();

const user = await User.findOneAndUpdate(
  { usernameCanonical: canonicalUsername(username) },
  { $set: { role }, $inc: { tokenVersion: 1 } },
  { new: true },
).select("username role");

if (!user) {
  console.error(`❌ Utilisateur introuvable : ${username}`);
  await mongoose.disconnect();
  process.exit(1);
}

console.log(`✅ ${user.username} est désormais ${user.role}`);
await mongoose.disconnect();
