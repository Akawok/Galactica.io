import mongoose, { Schema, Document } from "mongoose";

export interface IUser extends Document {
  username: string;
  email: string;
  passwordHash: string;
  points: number;
  xp: number;
  level: number;
  inventory: mongoose.Types.ObjectId[];
  activeShip: string;
  activeBullet: string; // tir principal (clic gauche)
  activeBulletSecondary: string; // tir secondaire (clic droit)
  stats: {
    wins: number;
    losses: number;
    totalGames: number;
    currentStreak: number;
    bestStreak: number;
  };
  createdAt: Date;
}

const UserSchema = new Schema<IUser>({
  username: { type: String, required: true, unique: true, trim: true },
  email: {
    type: String,
    required: true,
    unique: true,
    lowercase: true,
    trim: true,
  },
  passwordHash: { type: String, required: true },
  points: { type: Number, default: 0 },
  xp: { type: Number, default: 0 },
  level: { type: Number, default: 1 },
  inventory: [{ type: Schema.Types.ObjectId, ref: "Item" }],
  activeShip: { type: String, default: "spaceship-01" },
  activeBullet: { type: String, default: "bullet1" },
  activeBulletSecondary: { type: String, default: "bullet1" },
  stats: {
    wins: { type: Number, default: 0 },
    losses: { type: Number, default: 0 },
    totalGames: { type: Number, default: 0 },
    currentStreak: { type: Number, default: 0 },
    bestStreak: { type: Number, default: 0 },
  },
  createdAt: { type: Date, default: Date.now },
});

export const User = mongoose.model<IUser>("User", UserSchema);

export function serializeUser(user: IUser) {
  return {
    id: user._id.toString(),
    username: user.username,
    points: user.points,
    xp: user.xp ?? 0,
    level: user.level ?? 1,
    activeShip: user.activeShip,
    activeBullet: user.activeBullet,
    activeBulletSecondary: user.activeBulletSecondary ?? "bullet1",
  };
}

export function serializeUserFull(user: IUser & { inventory?: unknown[] }) {
  return {
    ...serializeUser(user),
    stats: user.stats,
    inventory: user.inventory ?? [],
  };
}
