import mongoose, { Schema, Document } from "mongoose";
import {
  type Attributes,
  sanitizeAttributes,
  respecCost,
} from "../shared/attributes.js";

export type UserRole = "user" | "moderator" | "admin";

export const DEFAULT_LOADOUT = {
  activeShip: "spaceship-01",
  activeBullet: "bullet1",
  activeBulletSecondary: "bullet1",
} as const;

export interface IUser extends Document {
  username: string;
  usernameCanonical: string;
  email: string;
  passwordHash: string;
  role: UserRole;
  emailVerified: boolean;
  tokenVersion: number;
  usernameChangedAt?: Date | null;
  bannedUntil?: Date | null;
  banReason?: string | null;
  mutedUntil?: Date | null;
  points: number;
  galactics: number;
  xp: number;
  level: number;
  inventory: mongoose.Types.ObjectId[];
  activeShip: string;
  activeBullet: string;
  activeBulletSecondary: string;
  attributes: Attributes;
  respecCount: number;
  stats: {
    wins: number;
    losses: number;
    totalGames: number;
    currentStreak: number;
    bestStreak: number;
    desertions: number;
  };
  createdAt: Date;
}

const UserSchema = new Schema<IUser>({
  username: { type: String, required: true, unique: true, trim: true },
  usernameCanonical: {
    type: String,
    required: true,
    unique: true,
    index: true,
  },
  email: {
    type: String,
    required: true,
    unique: true,
    lowercase: true,
    trim: true,
  },
  passwordHash: { type: String, required: true, select: false },
  role: {
    type: String,
    enum: ["user", "moderator", "admin"],
    default: "user",
  },
  emailVerified: { type: Boolean, default: false },
  tokenVersion: { type: Number, default: 0 },
  usernameChangedAt: { type: Date, default: null },
  bannedUntil: { type: Date, default: null },
  banReason: { type: String, default: null },
  mutedUntil: { type: Date, default: null },
  points: { type: Number, default: 0 },
  galactics: { type: Number, default: 0 },
  xp: { type: Number, default: 0 },
  level: { type: Number, default: 1 },
  inventory: [{ type: Schema.Types.ObjectId, ref: "Item" }],
  activeShip: { type: String, default: DEFAULT_LOADOUT.activeShip },
  activeBullet: { type: String, default: DEFAULT_LOADOUT.activeBullet },
  activeBulletSecondary: { type: String, default: DEFAULT_LOADOUT.activeBulletSecondary },
  attributes: {
    blindage: { type: Number, default: 0 },
    deflecteur: { type: Number, default: 0 },
    canons: { type: Number, default: 0 },
    cadence: { type: Number, default: 0 },
    ogive: { type: Number, default: 0 },
    propulseurs: { type: Number, default: 0 },
    reacteur: { type: Number, default: 0 },
  },
  respecCount: { type: Number, default: 0 },
  stats: {
    wins: { type: Number, default: 0 },
    losses: { type: Number, default: 0 },
    totalGames: { type: Number, default: 0 },
    currentStreak: { type: Number, default: 0 },
    bestStreak: { type: Number, default: 0 },
    desertions: { type: Number, default: 0 },
  },
  createdAt: { type: Date, default: Date.now },
});

export const User = mongoose.model<IUser>("User", UserSchema);

export function serializeUser(user: IUser) {
  return {
    id: user._id.toString(),
    username: user.username,
    role: user.role ?? "user",
    points: user.points,
    galactics: user.galactics ?? 0,
    xp: user.xp ?? 0,
    level: user.level ?? 1,
    activeShip: user.activeShip,
    activeBullet: user.activeBullet,
    activeBulletSecondary: user.activeBulletSecondary ?? "bullet1",
    attributes: sanitizeAttributes(user.attributes),
    respecCost: respecCost(user.respecCount ?? 0),
  };
}

export function isBanned(user: Pick<IUser, "bannedUntil">): boolean {
  return !!user.bannedUntil && user.bannedUntil.getTime() > Date.now();
}

export function isMuted(user: Pick<IUser, "mutedUntil">): boolean {
  return !!user.mutedUntil && user.mutedUntil.getTime() > Date.now();
}

export function serializeUserFull(user: IUser & { inventory?: unknown[] }) {
  return {
    ...serializeUser(user),
    stats: user.stats,
    inventory: user.inventory ?? [],
  };
}
