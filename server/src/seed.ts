import { connectDB } from "./config.js";
import { Item } from "./models/Item.js";
import { User } from "./models/User.js";
import mongoose from "mongoose";

await connectDB();

// Items de base (gratuits, disponibles par défaut)
const defaultItems = [
  // Vaisseaux
  {
    name: "Intercepteur",
    type: "ship",
    price: 0,
    description: "Vaisseau de base rapide et agile.",
    sprite: "ship1",
    stats: { speed: 3, hp: 100 },
  },
  {
    name: "Chasseur",
    type: "ship",
    price: 0,
    description: "Vaisseau de base équilibré.",
    sprite: "ship2",
    stats: { speed: 3, hp: 100 },
  },
  {
    name: "Croiseur",
    type: "ship",
    price: 200,
    description: "Plus résistant mais moins rapide.",
    sprite: "ship3",
    stats: { speed: 2, hp: 150 },
  },
  {
    name: "Destroyer",
    type: "ship",
    price: 300,
    description: "Vaisseau lourd, grande puissance de feu.",
    sprite: "ship4",
    stats: { speed: 2, hp: 120 },
  },
  {
    name: "Fantôme",
    type: "ship",
    price: 500,
    description: "Vaisseau furtif ultra-rapide.",
    sprite: "ship5",
    stats: { speed: 4, hp: 80 },
  },
  // Tirs principaux (clic gauche) — rapides, répétitifs
  {
    name: "Laser basique",
    type: "bullet",
    bulletRole: "primary",
    price: 0,
    description: "Tir principal standard, rapide et précis.",
    sprite: "bullet1",
    stats: { damage: 10, cooldown: 200 },
  },
  {
    name: "Plasma",
    type: "bullet",
    bulletRole: "primary",
    price: 0,
    description: "Tir principal en plasma, légèrement plus puissant.",
    sprite: "bullet2",
    stats: { damage: 12, cooldown: 220 },
  },
  // Tirs secondaires (clic droit) — puissants, lents, coût énergie
  {
    name: "Missile lourd",
    type: "bullet",
    bulletRole: "secondary",
    price: 0,
    description: "Tir secondaire de base, gros dégâts mais lent.",
    sprite: "bullet3",
    stats: { damage: 40, cooldown: 2000 },
  },
  {
    name: "Canon ionique",
    type: "bullet",
    bulletRole: "secondary",
    price: 400,
    description: "Tir secondaire dévastateur, dégâts massifs.",
    sprite: "bullet4",
    stats: { damage: 60, cooldown: 2500 },
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
