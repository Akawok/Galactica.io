import type { Types } from "mongoose";
import { Item, type ItemType } from "../models/Item.js";
import { DEFAULT_LOADOUT, User } from "../models/User.js";
import { deleteItemImages } from "./item-assets.service.js";

export type LoadoutSlot = keyof typeof DEFAULT_LOADOUT;

export const SLOTS_BY_TYPE: Record<ItemType, LoadoutSlot[]> = {
  ship: ["activeShip"],
  bullet: ["activeBullet", "activeBulletSecondary"],
  cosmetic: [],
};

// Removes the item, its images, and every trace of it on players; returns how many owned it
export async function purgeItem(item: {
  _id: Types.ObjectId;
  type: ItemType;
  sprite: string;
}): Promise<number> {
  await Item.deleteOne({ _id: item._id });
  const owners = await User.updateMany(
    { inventory: item._id },
    { $pull: { inventory: item._id } },
  );
  for (const slot of SLOTS_BY_TYPE[item.type]) {
    await User.updateMany(
      { [slot]: item.sprite },
      { $set: { [slot]: DEFAULT_LOADOUT[slot] } },
    );
  }
  await deleteItemImages(item.type, item.sprite);
  return owners.modifiedCount;
}
