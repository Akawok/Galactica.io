import { connectDB } from "./config.js";
import { Item } from "./models/Item.js";
import { User } from "./models/User.js";
import mongoose from "mongoose";

await connectDB();

// Équilibrage « net » : un vaisseau haut de gamme vaut ≈ +30 % de puissance
// effective face au vaisseau de base — avantage réel mais rattrapable au skill.
// Budget de stats croissant avec le prix, profils différenciés par archétype.
// La vitesse est plafonnée à +20 % (stat dominante pour l'esquive).
// Base : HP 100 / vitesse 3.0 / énergie 100 (= clamps GAME_CONFIG côté moteur).
const defaultItems = [
  {
    name: "Intercepteur",
    type: "ship",
    price: 0,
    description: "Vaisseau de base équilibré, fiable en toutes situations.",
    sprite: "spaceship-01",
    stats: { speed: 3, hp: 100, energy: 100 },
  },
  {
    name: "Crimson",
    type: "ship",
    price: 400,
    description: "Chasseur d'assaut : très vif, mais à la coque légère.",
    sprite: "spaceship-02",
    stats: { speed: 3.45, hp: 95, energy: 100 },
  },
  {
    name: "Inferno",
    type: "ship",
    price: 400,
    description: "Intercepteur lourd : encaisse fort, manœuvre lentement.",
    sprite: "spaceship-03",
    stats: { speed: 2.9, hp: 120, energy: 100 },
  },
  {
    name: "Valkyrie",
    type: "ship",
    price: 700,
    priceGalactics: 2,
    description: "Furtif et élégant : le roi du hit & run.",
    sprite: "spaceship-04",
    stats: { speed: 3.6, hp: 100, energy: 110 },
  },
  {
    name: "Solar",
    type: "ship",
    price: 900,
    priceGalactics: 3,
    description: "Forteresse solaire : une coque massive qui pardonne tout.",
    sprite: "spaceship-05",
    stats: { speed: 2.95, hp: 140, energy: 110 },
  },
  {
    name: "Prisma",
    type: "ship",
    price: 1200,
    priceGalactics: 4,
    description: "Le haut de gamme polyvalent : rapide, blindé, endurant.",
    sprite: "spaceship-06",
    stats: { speed: 3.35, hp: 120, energy: 115 },
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
  {
    name: "Torpille",
    type: "bullet",
    bulletRole: "secondary",
    price: 0,
    description: "Charge lourde à détonation différée. Coûte de l'énergie.",
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
