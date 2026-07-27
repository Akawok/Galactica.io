import mongoose from "mongoose";
import { User, isBanned } from "../models/User.js";
import type { UserRole } from "../models/User.js";

export interface TokenPayload {
  id: string;
  username: string;
  role: UserRole;
  tv: number;
}

export interface AuthorizedAccount {
  id: string;
  username: string;
  role: UserRole;
  mutedUntil?: Date | null;
}

export type AuthFailure =
  | "invalid"
  | "unknown-account"
  | "revoked"
  | "banned";

const ROLE_RANK: Record<UserRole, number> = {
  user: 0,
  moderator: 1,
  admin: 2,
};

export function hasRole(role: UserRole, required: UserRole): boolean {
  return (ROLE_RANK[role] ?? -1) >= ROLE_RANK[required];
}

export function parseTokenPayload(raw: unknown): TokenPayload | null {
  if (!raw || typeof raw !== "object") return null;
  const p = raw as Record<string, unknown>;
  if (typeof p.id !== "string" || !mongoose.Types.ObjectId.isValid(p.id))
    return null;
  if (typeof p.username !== "string") return null;
  const role = p.role;
  if (role !== "user" && role !== "moderator" && role !== "admin") return null;
  return {
    id: p.id,
    username: p.username,
    role,
    tv: typeof p.tv === "number" ? p.tv : 0,
  };
}

/**
 * Le rôle et l'état du compte sont relus en base à chaque requête : un JWT
 * reste valide 12 h, mais un ban ou une rétrogradation doit prendre effet
 * immédiatement, sans attendre l'expiration du token.
 */
export async function authorizeToken(
  raw: unknown,
): Promise<{ account: AuthorizedAccount } | { failure: AuthFailure }> {
  const payload = parseTokenPayload(raw);
  if (!payload) return { failure: "invalid" };

  const user = await User.findById(payload.id)
    .select("username role tokenVersion bannedUntil banReason mutedUntil")
    .lean();

  if (!user) return { failure: "unknown-account" };
  if ((user.tokenVersion ?? 0) !== payload.tv) return { failure: "revoked" };
  if (isBanned(user)) return { failure: "banned" };

  return {
    account: {
      id: String(user._id),
      username: user.username,
      role: (user.role ?? "user") as UserRole,
      mutedUntil: user.mutedUntil ?? null,
    },
  };
}

export const AUTH_FAILURE_MESSAGE: Record<AuthFailure, string> = {
  invalid: "Token invalide",
  "unknown-account": "Compte introuvable",
  revoked: "Session expirée, reconnecte-toi",
  banned: "Compte suspendu",
};
