import bcrypt from "bcrypt";
import { User, isBanned } from "../models/User.js";
import { Item } from "../models/Item.js";
import {
  ValidationError,
  canonicalUsername,
  normalizeEmail,
  normalizeUsername,
  validatePassword,
} from "./identity.service.js";

const SALT_ROUNDS = 12;

export function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, SALT_ROUNDS);
}
const DUMMY_HASH = "$2b$12$C6UzMDM.H6dfI/f/IKcEe.rTqQ0dqXlbBFsUVFm0z8ByRJyxNRVvS";

const LOCKOUT_THRESHOLD = 8;
const LOCKOUT_MS = 15 * 60_000;
const FAILURE_WINDOW_MS = 15 * 60_000;

interface FailureEntry {
  count: number;
  windowEnd: number;
  lockedUntil: number;
}

const failedLogins = new Map<string, FailureEntry>();

function assertNotLockedOut(key: string) {
  const entry = failedLogins.get(key);
  if (entry && entry.lockedUntil > Date.now()) {
    throw new ValidationError(
      "Compte temporairement verrouillé après trop de tentatives. Réessaie dans quelques minutes.",
    );
  }
}

function registerFailure(key: string) {
  const now = Date.now();
  const entry = failedLogins.get(key);

  if (!entry || entry.windowEnd <= now) {
    failedLogins.set(key, {
      count: 1,
      windowEnd: now + FAILURE_WINDOW_MS,
      lockedUntil: 0,
    });
    return;
  }

  entry.count++;
  if (entry.count >= LOCKOUT_THRESHOLD) {
    entry.lockedUntil = now + LOCKOUT_MS;
    entry.count = 0;
    entry.windowEnd = now + FAILURE_WINDOW_MS;
  }
}

export function clearLoginFailures(key: string) {
  failedLogins.delete(key.trim().toLowerCase());
}

function clearFailures(key: string) {
  failedLogins.delete(key);
}

export function pruneLoginAttempts() {
  const now = Date.now();
  for (const [key, entry] of failedLogins) {
    if (entry.lockedUntil <= now && entry.windowEnd <= now) {
      failedLogins.delete(key);
    }
  }
}

export async function registerUser(
  rawUsername: unknown,
  rawEmail: unknown,
  rawPassword: unknown,
) {
  const username = normalizeUsername(rawUsername);
  const email = normalizeEmail(rawEmail);
  const password = validatePassword(rawPassword, username);
  const usernameCanonical = canonicalUsername(username);

  const exists = await User.findOne({
    $or: [{ email }, { usernameCanonical }],
  })
    .select("email")
    .lean();
  if (exists) {
    if (exists.email === email) throw new ValidationError("Email déjà utilisé");
    throw new ValidationError("Nom d'utilisateur déjà pris");
  }

  const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
  // Older items have no priceGalactics field at all, which must count as free too
  const freeItems = await Item.find({
    price: 0,
    priceGalactics: { $in: [0, null] },
  })
    .select("_id")
    .lean();

  try {
    return await User.create({
      username,
      usernameCanonical,
      email,
      passwordHash,
      role: "user",
      inventory: freeItems.map((i) => i._id),
    });
  } catch (err: any) {
    if (err?.code === 11000) {
      throw new ValidationError("Email ou nom d'utilisateur déjà utilisé");
    }
    throw err;
  }
}

export async function loginUser(rawEmail: unknown, rawPassword: unknown) {
  const email =
    typeof rawEmail === "string" ? rawEmail.trim().toLowerCase() : "";
  const password = typeof rawPassword === "string" ? rawPassword : "";

  assertNotLockedOut(email);

  const user = await User.findOne({ email }).select("+passwordHash");

  const valid = await bcrypt.compare(
    password,
    user?.passwordHash ?? DUMMY_HASH,
  );

  if (!user || !valid) {
    registerFailure(email);
    throw new ValidationError("Email ou mot de passe incorrect");
  }

  if (isBanned(user)) {
    throw new ValidationError(
      user.banReason
        ? `Compte suspendu : ${user.banReason}`
        : "Compte suspendu",
    );
  }

  clearFailures(email);
  return user;
}
