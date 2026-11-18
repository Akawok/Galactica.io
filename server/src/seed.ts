import { connectDB } from "./config.js";
import { Item } from "./models/Item.js";
import { User } from "./models/User.js";
import { purgeItem } from "./services/item.service.js";
import mongoose from "mongoose";

await connectDB();

// The shop catalog: running the seed aligns any database (dev or prod) on it
const defaultItems = [
  {
    name: "Big Bang",
    type: "ship",
    price: 0,
    priceGalactics: 0,
    description: "Le Grand Explorateur",
    sprite: "bigbang",
  },
  {
    name: "Spartan",
    type: "ship",
    price: 0,
    priceGalactics: 0,
    description: "Exécuteur Stellaire",
    sprite: "spaceship-01",
  },
  {
    name: "Ragnarok",
    type: "ship",
    price: 400,
    priceGalactics: 0,
    description: "La Fureur Céleste",
    sprite: "spaceship-02",
  },
  {
    name: "Manta",
    type: "ship",
    price: 400,
    priceGalactics: 0,
    description: "La Brumeuse",
    sprite: "spaceship-03",
  },
  {
    name: "Valkyrie",
    type: "ship",
    price: 700,
    priceGalactics: 2,
    description: "La Princesse Galactique",
    sprite: "spaceship-04",
  },
  {
    name: "Vulcan",
    type: "ship",
    price: 900,
    priceGalactics: 3,
    description: "Jugement des Étoiles",
    sprite: "spaceship-05",
  },
  {
    name: "Aurelios",
    type: "ship",
    price: 1000,
    priceGalactics: 3,
    description: "Gardien des Cieux",
    sprite: "aurelios",
  },
  {
    name: "Noctua",
    type: "ship",
    price: 1000,
    priceGalactics: 3,
    description: "Déesse de la nuit",
    sprite: "noctua",
  },
  {
    name: "Ignis",
    type: "ship",
    price: 1500,
    priceGalactics: 5,
    description: "Brasier Éternel",
    sprite: "ignis",
  },
  {
    name: "Vespera",
    type: "ship",
    price: 0,
    priceGalactics: 20,
    description: "Bzzzzzzz",
    sprite: "vespera",
  },
  {
    name: "Laser basique",
    type: "bullet",
    bulletRole: "primary",
    price: 0,
    description: "Tir de base.",
    sprite: "bullet1",
  },
  {
    name: "Torpille",
    type: "bullet",
    bulletRole: "secondary",
    price: 0,
    description: "Missile de base.",
    sprite: "bullet2",
  },
];

// Items taken out of the game: removed from inventories, loadouts and disk
const retiredSprites = ["spaceship-06"];

for (const item of await Item.find({ sprite: { $in: retiredSprites } }).lean()) {
  const owners = await purgeItem(item);
  console.log(`🗑️  Item retiré: ${item.name} (${owners} inventaire(s) nettoyé(s))`);
}

await Promise.all(
  defaultItems.map(async (item) => {
    await Item.findOneAndUpdate(
      { sprite: item.sprite },
      { $set: { priceGalactics: 0, ...item }, $unset: { stats: 1 } },
      { upsert: true, new: true, strict: false },
    );
    console.log(`✅ Item upserted: ${item.name}`);
  }),
);

const freeItems = await Item.find({
  price: 0,
  priceGalactics: { $in: [0, null] },
}).select("_id");
const freeIds = freeItems.map((i) => i._id);

const result = await User.updateMany(
  {},
  { $addToSet: { inventory: { $each: freeIds } } },
);
console.log(`✅ Items gratuits ajoutés à ${result.modifiedCount} utilisateurs`);

await mongoose.disconnect();
console.log("✅ Seed terminé");
