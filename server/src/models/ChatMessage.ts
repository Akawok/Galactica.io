import mongoose, { Schema, Document } from "mongoose";

export interface IChatMessage extends Document {
  username: string;
  message: string;
  timestamp: Date;
}

const ChatMessageSchema = new Schema<IChatMessage>({
  username: { type: String, required: true },
  message: { type: String, required: true, maxlength: 200 },
  timestamp: { type: Date, default: Date.now, index: { expires: "24h" } },
});

export const ChatMessage = mongoose.model<IChatMessage>(
  "ChatMessage",
  ChatMessageSchema,
);
