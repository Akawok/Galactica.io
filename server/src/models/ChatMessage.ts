import mongoose, { Schema, Document } from "mongoose";

export interface IChatMessage extends Document {
  username: string;
  message: string;
  timestamp: Date;
  level?: number;
  // Server generated announcement (grade promotion), not typed by a player
  system?: boolean;
  // Message posted by an admin to every player
  announcement?: boolean;
}

const ChatMessageSchema = new Schema<IChatMessage>({
  username: { type: String, required: true },
  message: { type: String, required: true, maxlength: 200 },
  timestamp: { type: Date, default: Date.now, index: { expires: "24h" } },
  level: { type: Number },
  system: { type: Boolean },
  announcement: { type: Boolean },
});

export const ChatMessage = mongoose.model<IChatMessage>(
  "ChatMessage",
  ChatMessageSchema,
);
