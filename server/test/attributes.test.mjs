import { test, describe, before } from "node:test";
import assert from "node:assert/strict";
import { call, registerUser, serverIsUp } from "./helpers.mjs";

const attrs = (o = {}) => ({
  blindage: 0,
  deflecteur: 0,
  canons: 0,
  cadence: 0,
  ogive: 0,
  propulseurs: 0,
  reacteur: 0,
  ...o,
});

before(async () => {
  assert.ok(await serverIsUp(), "Le serveur doit tourner avant les tests");
});

describe("caractéristiques du pilote", () => {
  test("un nouveau joueur part de zéro, remise à zéro gratuite", async () => {
    const user = await registerUser("attr");
    const me = await call("/stats/me", { jar: user.jar });
    assert.equal(me.status, 200);
    assert.deepEqual(me.body.user.attributes, attrs());
    assert.equal(me.body.user.respecCost, 0);
  });

  test("refuse sans session", async () => {
    const res = await call("/attributes", {
      method: "POST",
      body: JSON.stringify({ attributes: attrs() }),
    });
    assert.ok([401, 403].includes(res.status));
  });

  test("au niveau 1 il n'y a aucun point à placer", async () => {
    const user = await registerUser("attr");
    const res = await call("/attributes", {
      method: "POST",
      jar: user.jar,
      csrf: user.csrf,
      body: JSON.stringify({ attributes: attrs({ blindage: 1 }) }),
    });
    assert.equal(res.status, 400);
    assert.equal(res.body.error, "Pas assez de points");
  });

  test("refuse une valeur hors bornes ou non entière", async () => {
    const user = await registerUser("attr");
    for (const bad of [11, -1, 1.5]) {
      const res = await call("/attributes", {
        method: "POST",
        jar: user.jar,
        csrf: user.csrf,
        body: JSON.stringify({ attributes: attrs({ canons: bad }) }),
      });
      assert.equal(res.status, 400, `valeur ${bad}`);
    }
  });

  test("refuse une remise à zéro sans point placé", async () => {
    const user = await registerUser("attr");
    const res = await call("/attributes/reset", {
      method: "POST",
      jar: user.jar,
      csrf: user.csrf,
      body: JSON.stringify({}),
    });
    assert.equal(res.status, 400);
  });
});
