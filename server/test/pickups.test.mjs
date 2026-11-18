// Power-ups, tested on the compiled game rules (npm run build first): no server needed
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  GAME_CONFIG,
  PICKUPS,
  activeBuffs,
  applyInput,
  collectPickups,
  createPlayerState,
  isInvulnerable,
  spawnPickup,
  updateBuffs,
} from "../dist/services/game.service.js";
import { computeStats, emptyAttributes } from "../dist/shared/attributes.js";

const stats = computeStats(emptyAttributes());

function setup() {
  const a = createPlayerState("a", "ua", "A", 0, "s", "b1", "b2", stats);
  const b = createPlayerState("b", "ub", "B", 1, "s", "b1", "b2", stats);
  const room = { roomId: "r", roundStartTime: 0, pickups: [], nextPickupAt: 0, pickupSeq: 0 };
  return { room, a, b, players: [a, b] };
}

function drop(room, type, x, y) {
  room.pickups.push({ id: `${type}`, type, x, y });
}

const idle = { seq: 1, keys: [], mouseAngle: 0, leftClick: true, rightClick: false };

describe("bonus", () => {
  test("apparaissent dans l'arène, loin des vaisseaux, au rythme prévu", () => {
    const { room, players } = setup();
    for (let i = 0; i < 200; i++) {
      room.pickups = [];
      room.nextPickupAt = 0;
      const p = spawnPickup(room, players, 1000);
      assert.ok(p, "un bonus doit pouvoir apparaître");
      assert.ok(["shield", "heal", "rage", "turbo"].includes(p.type));
      assert.ok(p.x > 0 && p.x < GAME_CONFIG.MAP_WIDTH && p.y > 0 && p.y < GAME_CONFIG.MAP_HEIGHT);
      for (const pl of players) {
        assert.ok(Math.hypot(pl.x - p.x, pl.y - p.y) >= PICKUPS.MIN_PLAYER_DISTANCE);
      }
    }
    assert.equal(spawnPickup(room, players, 1001), null, "pas avant l'intervalle suivant");
    room.nextPickupAt = 0;
    room.pickups = [{}, {}];
    assert.equal(spawnPickup(room, players, 9_999_999), null, "pas plus que le maximum sur la carte");
  });

  test("seul le vaisseau qui touche le bonus le prend", () => {
    const { room, a, players } = setup();
    drop(room, "heal", a.x + 200, a.y);
    assert.deepEqual(collectPickups(room, players, 0), []);
    a.x += 200;
    a.hp = 10;
    assert.deepEqual(collectPickups(room, players, 0), [{ id: "heal", by: "a", type: "heal" }]);
    assert.equal(a.hp, 10 + PICKUPS.HEAL);
    assert.equal(room.pickups.length, 0);
  });

  test("soin plafonné aux PV max, vaisseau détruit ne ramasse rien", () => {
    const { room, a, b, players } = setup();
    drop(room, "heal", a.x, a.y);
    a.hp = a.maxHp - 5;
    collectPickups(room, players, 0);
    assert.equal(a.hp, a.maxHp);
    drop(room, "heal", b.x, b.y);
    b.hp = 0;
    assert.deepEqual(collectPickups(room, players, 0), []);
  });

  test("bouclier : invulnérable puis plus rien à la fin", () => {
    const { room, a, players } = setup();
    drop(room, "shield", a.x, a.y);
    collectPickups(room, players, 1000);
    assert.ok(isInvulnerable(a, 1000 + PICKUPS.SHIELD_MS - 1));
    assert.equal(activeBuffs(a, 1000), "shield");
    assert.ok(!isInvulnerable(a, 1000 + PICKUPS.SHIELD_MS));
    assert.equal(activeBuffs(a, 1000 + PICKUPS.SHIELD_MS), "");
  });

  test("rage : dégâts doublés pendant la durée seulement", () => {
    const { room, a, players } = setup();
    drop(room, "rage", a.x, a.y);
    collectPickups(room, players, 0);
    const [boosted] = applyInput(a, idle, 100);
    assert.equal(boosted.damage, a.primaryDamage * PICKUPS.RAGE_DAMAGE_MULT);
    a.lastNormalShotClock = -Infinity;
    const [normal] = applyInput(a, { ...idle, seq: 2 }, PICKUPS.RAGE_MS);
    assert.equal(normal.damage, a.primaryDamage);
  });

  test("turbo : vitesse augmentée puis rendue", () => {
    const { room, a, players } = setup();
    const base = a.speed;
    drop(room, "turbo", a.x, a.y);
    collectPickups(room, players, 0);
    updateBuffs(a, 10);
    assert.equal(a.speed, base * PICKUPS.TURBO_SPEED_MULT);
    updateBuffs(a, PICKUPS.TURBO_MS);
    assert.equal(a.speed, base);
  });
});
