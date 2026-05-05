import bcrypt from "bcrypt";
import { User } from "../models/User.js";
import { Item } from "../models/Item.js";

const SALT_ROUNDS = 12;

export async function registerUser(
  username: string,
  email: string,
  password: string,
) {
  const exists = await User.findOne({ $or: [{ email }, { username }] });
  if (exists) {
    if (exists.email === email) throw new Error("Email déjà utilisé");
    throw new Error("Nom d'utilisateur déjà pris");
  }

  const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
  const freeItems = await Item.find({ price: 0 }).select("_id").lean();
  const user = await User.create({
    username,
    email,
    passwordHash,
    inventory: freeItems.map((i) => i._id),
  });
  return user;
}

export async function loginUser(email: string, password: string) {
  const user = await User.findOne({ email });
  if (!user) throw new Error("Email ou mot de passe incorrect");

  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) throw new Error("Email ou mot de passe incorrect");

  return user;
}
