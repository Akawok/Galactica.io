import mongoose, { Schema, Document } from "mongoose";

export type ItemType = "ship" | "bullet" | "cosmetic";
export type BulletRole = "primary" | "secondary";

export interface IItem extends Document {
  name: string;
  type: ItemType;
  bulletRole?: BulletRole;
  price: number;
  priceGalactics: number;
  description: string;
  sprite: string;
}

const ItemSchema = new Schema<IItem>({
  name: { type: String, required: true },
  type: { type: String, enum: ["ship", "bullet", "cosmetic"], required: true },
  bulletRole: { type: String, enum: ["primary", "secondary"], default: null },
  price: { type: Number, required: true },
  priceGalactics: { type: Number, default: 0 },
  description: { type: String, default: "" },
  sprite: { type: String, required: true },
});

export const Item = mongoose.model<IItem>("Item", ItemSchema);
