import mongoose, { Schema, Document } from "mongoose";

export type ItemType = "ship" | "bullet" | "cosmetic";
export type BulletRole = "primary" | "secondary";

export interface IItem extends Document {
  name: string;
  type: ItemType;
  bulletRole?: BulletRole; // uniquement pour les bullets
  price: number;
  description: string;
  sprite: string;
  stats: {
    damage?: number;
    cooldown?: number;
    speed?: number;
    hp?: number;
    energy?: number;
  };
}

const ItemSchema = new Schema<IItem>({
  name: { type: String, required: true },
  type: { type: String, enum: ["ship", "bullet", "cosmetic"], required: true },
  bulletRole: { type: String, enum: ["primary", "secondary"], default: null },
  price: { type: Number, required: true },
  description: { type: String, default: "" },
  sprite: { type: String, required: true },
  stats: {
    damage: Number,
    cooldown: Number,
    speed: Number,
    hp: Number,
    energy: Number,
  },
});

export const Item = mongoose.model<IItem>("Item", ItemSchema);
