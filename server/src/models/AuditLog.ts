import mongoose, { Schema, Document } from "mongoose";

export type AuditAction =
  | "ban"
  | "unban"
  | "mute"
  | "role-change"
  | "chat-purge"
  | "item-create"
  | "item-update"
  | "item-delete"
  | "kick"
  | "rename"
  | "resources"
  | "reset-attributes"
  | "verify-email"
  | "send-reset"
  | "delete-account"
  | "game-close"
  | "chat-delete"
  | "announce";

export interface IAuditLog extends Document {
  action: AuditAction;
  actorId: mongoose.Types.ObjectId;
  actorUsername: string;
  targetId?: mongoose.Types.ObjectId;
  targetUsername?: string;
  details?: Record<string, unknown>;
  ip?: string;
  createdAt: Date;
}

const AuditLogSchema = new Schema<IAuditLog>({
  action: {
    type: String,
    enum: [
      "ban",
      "unban",
      "mute",
      "role-change",
      "chat-purge",
      "item-create",
      "item-update",
      "item-delete",
      "kick",
      "rename",
      "resources",
      "reset-attributes",
      "verify-email",
      "send-reset",
      "delete-account",
      "game-close",
      "chat-delete",
      "announce",
    ],
    required: true,
  },
  actorId: { type: Schema.Types.ObjectId, ref: "User", required: true },
  actorUsername: { type: String, required: true },
  targetId: { type: Schema.Types.ObjectId, ref: "User" },
  targetUsername: String,
  details: Schema.Types.Mixed,
  ip: String,
  createdAt: { type: Date, default: Date.now, index: true },
});

AuditLogSchema.index({ targetId: 1, createdAt: -1 });

export const AuditLog = mongoose.model<IAuditLog>("AuditLog", AuditLogSchema);

export async function recordAudit(entry: {
  action: AuditAction;
  actorId: string;
  actorUsername: string;
  targetId?: string;
  targetUsername?: string;
  details?: Record<string, unknown>;
  ip?: string;
}): Promise<void> {
  try {
    await AuditLog.create(entry);
  } catch (err) {
    console.error("[audit] échec d'écriture:", err);
  }
}
