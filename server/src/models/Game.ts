import mongoose, { Schema, Document } from "mongoose";

export interface IGame extends Document {
  roomId: string;
  players: {
    userId: mongoose.Types.ObjectId;
    username: string;
    score: number;
  }[];
  winner?: mongoose.Types.ObjectId;
  createdAt: Date;
  endedAt?: Date;
}

const GameSchema = new Schema<IGame>({
  roomId: { type: String, required: true, unique: true },
  players: [
    {
      userId: { type: Schema.Types.ObjectId, ref: "User" },
      username: String,
      score: { type: Number, default: 0 },
    },
  ],
  winner: { type: Schema.Types.ObjectId, ref: "User" },
  createdAt: { type: Date, default: Date.now },
  endedAt: Date,
});

// Match history and the daily anti-farming count both look games up by player
GameSchema.index({ "players.userId": 1, endedAt: -1 });

export const Game = mongoose.model<IGame>("Game", GameSchema);
