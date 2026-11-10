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
    description: "Le vaisseau de départ. Il fait le job.",
    sprite: "spaceship-01",
    stats: { speed: 3, hp: 100, energy: 100 },
  },
  {
    name: "Crimson",
    type: "ship",
    price: 400,
    description: "Va vite, mais casse vite.",
    sprite: "spaceship-02",
    stats: { speed: 3.45, hp: 95, energy: 100 },
  },
  {
    name: "Inferno",
    type: "ship",
    price: 400,
    description: "Lent, mais faut s'accrocher pour le descendre.",
    sprite: "spaceship-03",
    stats: { speed: 2.9, hp: 120, energy: 100 },
  },
  {
    name: "Valkyrie",
    type: "ship",
    price: 700,
    priceGalactics: 2,
    description: "Le plus rapide du hangar. Tu tapes et tu te barres.",
    sprite: "spaceship-04",
    stats: { speed: 3.6, hp: 100, energy: 110 },
  },
  {
    name: "Solar",
    type: "ship",
    price: 900,
    priceGalactics: 3,
    description: "Un tank. Pas pressé, mais increvable.",
    sprite: "spaceship-05",
    stats: { speed: 2.95, hp: 140, energy: 110 },
  },
  {
    name: "Prisma",
    type: "ship",
    price: 1200,
    priceGalactics: 4,
    description: "Bon partout. Ça se paie.",
    sprite: "spaceship-06",
    stats: { speed: 3.35, hp: 120, energy: 115 },
  },
  {
    name: "Laser basique",
    type: "bullet",
    bulletRole: "primary",
    price: 0,
    description: "Le tir de base. Ça part vite.",
    sprite: "bullet1",
    stats: { damage: 10, cooldown: 200 },
  },
  {
    name: "Torpille",
    type: "bullet",
    bulletRole: "secondary",
    price: 0,
    description: "Longue à recharger, mais ça fait mal. Bouffe de l'énergie.",
    sprite: "bullet2",
    stats: { damage: 40, cooldown: 2000, energy: 20 },
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

const freeItems = await Item.find({ price: 0 }).select("_id");
const freeIds = freeItems.map((i) => i._id);

const result = await User.updateMany(
  {},
  { $addToSet: { inventory: { $each: freeIds } } },
);
console.log(`✅ Items gratuits ajoutés à ${result.modifiedCount} utilisateurs`);

await mongoose.disconnect();
console.log("✅ Seed terminé");
