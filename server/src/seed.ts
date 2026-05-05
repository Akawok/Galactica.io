import { connectDB } from "./config.js";
import { Item } from "./models/Item.js";
import { User } from "./models/User.js";
import mongoose from "mongoose";

await connectDB();

const defaultItems = [
  {
    name: "Intercepteur",
    type: "ship",
    price: 0,
    description: "Vaisseau de base rapide et agile.",
    sprite: "spaceship-01",
    stats: { speed: 3, hp: 100 },
  },
  {
    name: "Crimson",
    type: "ship",
    price: 200,
    description: "Chasseur d'assaut, rapide et destructeur.",
    sprite: "spaceship-02",
    stats: { speed: 4, hp: 90 },
  },
  {
    name: "Inferno",
    type: "ship",
    price: 200,
    description: "Intercepteur lourd, blindé et menaçant.",
    sprite: "spaceship-03",
    stats: { speed: 4, hp: 90 },
  },
  {
    name: "Valkyrie",
    type: "ship",
    price: 350,
    description: "Furtif et élégant, redoutable en combat rapproché.",
    sprite: "spaceship-04",
    stats: { speed: 5, hp: 80 },
  },
  {
    name: "Solar",
    type: "ship",
    price: 450,
    description: "Bombardier solaire, blindé et dévastateur.",
    sprite: "spaceship-05",
    stats: { speed: 3, hp: 130 },
  },
  {
    name: "Prisma",
    type: "ship",
    price: 500,
    description: "Vaisseau arc-en-ciel, aussi beau que dévastateur.",
    sprite: "spaceship-06",
    stats: { speed: 4, hp: 110 },
  },
  {
    name: "Laser basique",
    type: "bullet",
    bulletRole: "primary",
    price: 0,
    description: "Tir standard, rapide et précis.",
    sprite: "bullet1",
    stats: { damage: 10, cooldown: 200 },
  },
];

await Promise.all(
  defaultItems.map(async (item) => {
    await Item.findOneAndUpdate({ sprite: item.sprite }, item, {
      upsert: true,
      new: true,
    });
    console.log(`✅ Item upserted: ${item.name}`);
  }),
);

// Donne les items gratuits à tous les utilisateurs qui ne les ont pas encore
const freeItems = await Item.find({ price: 0 }).select("_id");
const freeIds = freeItems.map((i) => i._id);

const result = await User.updateMany(
  {},
  { $addToSet: { inventory: { $each: freeIds } } },
);
console.log(`✅ Items gratuits ajoutés à ${result.modifiedCount} utilisateurs`);

await mongoose.disconnect();
console.log("✅ Seed terminé");
