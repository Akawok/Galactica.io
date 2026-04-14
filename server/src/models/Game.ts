import mongoose, { Schema, Document } from "mongoose";

export interface IGame extends Document {
  roomId: string;
  players: {
    userId: mongoose.Types.ObjectId;
    username: string;
    score: number;
  }[];
  winner?: mongoose.Types.ObjectId;
  rounds: { winner: mongoose.Types.ObjectId; duration: number }[];
  spectators: mongoose.Types.ObjectId[];
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
  rounds: [
    {
      winner: { type: Schema.Types.ObjectId, ref: "User" },
      duration: Number,
    },
  ],
  spectators: [{ type: Schema.Types.ObjectId, ref: "User" }],
  createdAt: { type: Date, default: Date.now },
  endedAt: Date,
});

export const Game = mongoose.model<IGame>("Game", GameSchema);
