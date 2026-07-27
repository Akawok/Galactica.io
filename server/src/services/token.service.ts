import { createHash, randomBytes } from "crypto";
import type mongoose from "mongoose";
import { Token, type TokenPurpose } from "../models/Token.js";

const TTL_MS: Record<TokenPurpose, number> = {
  "password-reset": 30 * 60_000,
  "email-verify": 24 * 60 * 60_000,
};

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function issueToken(
  userId: mongoose.Types.ObjectId | string,
  purpose: TokenPurpose,
): Promise<string> {
  await Token.deleteMany({ userId, purpose, usedAt: null });

  const token = randomBytes(32).toString("base64url");
  await Token.create({
    tokenHash: hashToken(token),
    userId,
    purpose,
    expiresAt: new Date(Date.now() + TTL_MS[purpose]),
  });
  return token;
}

export async function peekToken(
  token: unknown,
  purpose: TokenPurpose,
): Promise<string | null> {
  if (typeof token !== "string" || token.length < 20) return null;

  const entry = await Token.findOne({
    tokenHash: hashToken(token),
    purpose,
    usedAt: null,
    expiresAt: { $gt: new Date() },
  }).lean();

  return entry ? String(entry.userId) : null;
}

export async function consumeToken(
  token: unknown,
  purpose: TokenPurpose,
): Promise<string | null> {
  if (typeof token !== "string" || token.length < 20) return null;

  const entry = await Token.findOneAndUpdate(
    {
      tokenHash: hashToken(token),
      purpose,
      usedAt: null,
      expiresAt: { $gt: new Date() },
    },
    { $set: { usedAt: new Date() } },
  ).lean();

  return entry ? String(entry.userId) : null;
}
