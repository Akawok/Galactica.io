import mongoose, { Schema, Document } from "mongoose";

export type TokenPurpose = "password-reset" | "email-verify";

export interface IToken extends Document {
  tokenHash: string;
  userId: mongoose.Types.ObjectId;
  purpose: TokenPurpose;
  expiresAt: Date;
  usedAt?: Date | null;
  createdAt: Date;
}

const TokenSchema = new Schema<IToken>({
  tokenHash: { type: String, required: true, unique: true, index: true },
  userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
  purpose: {
    type: String,
    enum: ["password-reset", "email-verify"],
    required: true,
  },
  expiresAt: { type: Date, required: true, index: { expires: 0 } },
  usedAt: { type: Date, default: null },
  createdAt: { type: Date, default: Date.now },
});

export const Token = mongoose.model<IToken>("Token", TokenSchema);
