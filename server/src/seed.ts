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
    description: "Vaisseau bleu.",
    sprite: "spaceship-01",
  },
  {
    name: "Crimson",
    type: "ship",
    price: 400,
    description: "Vaisseau rouge.",
    sprite: "spaceship-02",
  },
  {
    name: "Inferno",
    type: "ship",
    price: 400,
    description: "Vaisseau orange.",
    sprite: "spaceship-03",
  },
  {
    name: "Valkyrie",
    type: "ship",
    price: 700,
    priceGalactics: 2,
    description: "Vaisseau rose.",
    sprite: "spaceship-04",
  },
  {
    name: "Solar",
    type: "ship",
    price: 900,
    priceGalactics: 3,
    description: "Vaisseau doré.",
    sprite: "spaceship-05",
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
