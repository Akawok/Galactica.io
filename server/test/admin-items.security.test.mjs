import { test, describe, before } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { API, call, registerUser, serverIsUp, STRONG_PASSWORD } from "./helpers.mjs";

// 1x1 transparent PNGs, two different payloads to tell frames apart
const PNG_A =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";
const PNG_B =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

const WEBP = Buffer.concat([
  Buffer.from("RIFF"),
  Buffer.from([0x1a, 0, 0, 0]),
  Buffer.from("WEBPVP8L"),
  Buffer.alloc(18),
]).toString("base64");

function grantRole(username, role) {
  execFileSync("node", ["dist/scripts/grant-role.js", username, role], {
    cwd: new URL("..", import.meta.url).pathname,
    stdio: "pipe",
  });
}

async function adminSession() {
  const user = await registerUser("itm");
  grantRole(user.username, "admin");
  const res = await call("/auth/login", {
    method: "POST",
    body: JSON.stringify({ email: user.email, password: STRONG_PASSWORD }),
  });
  assert.equal(res.status, 200);
  return { jar: res.cookies, csrf: res.body.csrfToken };
}

function uniqueSprite() {
  return `test-${Math.random().toString(36).slice(2, 10)}`;
}

before(async () => {
  assert.ok(await serverIsUp(), "Le serveur doit tourner avant les tests");
});

describe("accès à l'admin des items", () => {
  test("un joueur ne peut ni lister ni créer d'item", async () => {
    const user = await registerUser("pl");
    const list = await call("/admin/items", { jar: user.jar });
    assert.equal(list.status, 403);

    const create = await call("/admin/items", {
      method: "POST",
      jar: user.jar,
      csrf: user.csrf,
      body: JSON.stringify({
        name: "Pirate",
        price: 0,
        type: "ship",
        sprite: uniqueSprite(),
        images: [PNG_A],
      }),
    });
    assert.equal(create.status, 403);
  });
});

describe("images servies par le serveur", () => {
  test("chaque image du catalogue est servie dans son format", async () => {
    const shop = await call("/shop/items");
    const dirs = { ship: "spaceships", bullet: "bullets" };
    for (const item of shop.body.items.filter((i) => i.frames > 0)) {
      const url = `/assets/${dirs[item.type]}/${item.sprite}/f1.${item.imageExt}`;
      const res = await fetch(`${API}${url}`);
      assert.equal(res.status, 200, url);
      assert.equal(res.headers.get("content-type"), `image/${item.imageExt}`, url);
    }
  });

  test("les chemins hors du dossier d'images sont refusés", async () => {
    for (const path of [
      "/assets/spaceships/..%2F..%2Fsrc/f1.png",
      "/assets/..%2Fsrc/spaceship-01/f1.png",
      "/assets/spaceships/spaceship-01/..%2F..%2F..%2Fpackage.json",
      "/assets/spaceships/spaceship-01/f9.png",
      "/assets/secrets/spaceship-01/f1.png",
    ]) {
      const res = await fetch(`${API}${path}`);
      assert.equal(res.status, 404, path);
    }
  });
});

describe("création et modification d'items", () => {
  test("un vaisseau créé arrive dans la boutique avec ses images", async () => {
    const admin = await adminSession();
    const sprite = uniqueSprite();

    const created = await call("/admin/items", {
      method: "POST",
      jar: admin.jar,
      csrf: admin.csrf,
      body: JSON.stringify({
        name: "Faucon test",
        description: "Vaisseau de test.",
        price: 300,
        priceGalactics: 1,
        type: "ship",
        sprite,
        images: [PNG_A, PNG_B],
      }),
    });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    assert.equal(created.body.item.frames, 2);

    const shop = await call("/shop/items");
    const listed = shop.body.items.find((i) => i.sprite === sprite);
    assert.ok(listed, "l'item doit être en boutique");
    assert.equal(listed.frames, 2);

    const frame2 = await fetch(`${API}/assets/spaceships/${sprite}/f2.png`);
    assert.equal(frame2.status, 200);
    assert.equal(
      Buffer.from(await frame2.arrayBuffer()).toString("base64"),
      PNG_B,
    );

    const duplicate = await call("/admin/items", {
      method: "POST",
      jar: admin.jar,
      csrf: admin.csrf,
      body: JSON.stringify({
        name: "Doublon",
        price: 10,
        type: "ship",
        sprite,
        images: [PNG_A],
      }),
    });
    assert.equal(duplicate.status, 409);
  });

  test("un fichier qui n'est pas un PNG est refusé", async () => {
    const admin = await adminSession();
    const sprite = uniqueSprite();
    const res = await call("/admin/items", {
      method: "POST",
      jar: admin.jar,
      csrf: admin.csrf,
      body: JSON.stringify({
        name: "Pas une image",
        price: 10,
        type: "ship",
        sprite,
        images: [Buffer.from("<svg onload=alert(1)>").toString("base64")],
      }),
    });
    assert.equal(res.status, 400);
    const asset = await fetch(`${API}/assets/spaceships/${sprite}/f1.png`);
    assert.equal(asset.status, 404);
  });

  test("un vaisseau en WebP est servi en WebP", async () => {
    const admin = await adminSession();
    const sprite = uniqueSprite();
    const created = await call("/admin/items", {
      method: "POST",
      jar: admin.jar,
      csrf: admin.csrf,
      body: JSON.stringify({
        name: "Nébuleuse",
        price: 50,
        type: "ship",
        sprite,
        images: [WEBP, WEBP],
      }),
    });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    assert.equal(created.body.item.imageExt, "webp");
    assert.equal(created.body.item.frames, 2);

    const frame = await fetch(`${API}/assets/spaceships/${sprite}/f2.webp`);
    assert.equal(frame.status, 200);
    assert.equal(frame.headers.get("content-type"), "image/webp");

    const mixed = await call(`/admin/items/${created.body.item._id}/images`, {
      method: "POST",
      jar: admin.jar,
      csrf: admin.csrf,
      body: JSON.stringify({ images: [WEBP, PNG_A] }),
    });
    assert.equal(mixed.status, 400, "les formats mélangés sont refusés");

    const back = await call(`/admin/items/${created.body.item._id}/images`, {
      method: "POST",
      jar: admin.jar,
      csrf: admin.csrf,
      body: JSON.stringify({ images: [PNG_A] }),
    });
    assert.equal(back.status, 200);
    assert.equal(back.body.item.imageExt, "png");
    assert.equal(back.body.item.frames, 1);
    const stale = await fetch(`${API}/assets/spaceships/${sprite}/f1.webp`);
    assert.equal(stale.status, 404, "les anciennes images WebP sont retirées");
  });

  test("un tir doit préciser s'il est principal ou secondaire", async () => {
    const admin = await adminSession();
    const res = await call("/admin/items", {
      method: "POST",
      jar: admin.jar,
      csrf: admin.csrf,
      body: JSON.stringify({
        name: "Plasma",
        price: 10,
        type: "bullet",
        sprite: uniqueSprite(),
        images: [PNG_A],
      }),
    });
    assert.equal(res.status, 400);
  });

  test("un item gratuit est donné aux joueurs existants", async () => {
    const player = await registerUser("old");
    const admin = await adminSession();
    const sprite = uniqueSprite();

    const created = await call("/admin/items", {
      method: "POST",
      jar: admin.jar,
      csrf: admin.csrf,
      body: JSON.stringify({
        name: "Laser offert",
        price: 0,
        priceGalactics: 0,
        type: "bullet",
        bulletRole: "primary",
        sprite,
        images: [PNG_A],
      }),
    });
    assert.equal(created.status, 201, JSON.stringify(created.body));

    const stats = await call("/stats/me", { jar: player.jar });
    assert.equal(stats.status, 200);
    const owned = stats.body.user.inventory.find((i) => i.sprite === sprite);
    assert.ok(owned, "le joueur doit posséder l'item gratuit");
    assert.equal(owned.frames, 1);
  });

  test("le prix se modifie et les images se remplacent", async () => {
    const admin = await adminSession();
    const sprite = uniqueSprite();
    const created = await call("/admin/items", {
      method: "POST",
      jar: admin.jar,
      csrf: admin.csrf,
      body: JSON.stringify({
        name: "Comète",
        price: 100,
        type: "ship",
        sprite,
        images: [PNG_A, PNG_A, PNG_A, PNG_A],
      }),
    });
    const itemId = created.body.item._id;

    const patched = await call(`/admin/items/${itemId}`, {
      method: "PATCH",
      jar: admin.jar,
      csrf: admin.csrf,
      body: JSON.stringify({ price: 250, name: "Comète bleue" }),
    });
    assert.equal(patched.status, 200);
    assert.equal(patched.body.item.price, 250);
    assert.equal(patched.body.item.name, "Comète bleue");

    const forbidden = await call(`/admin/items/${itemId}`, {
      method: "PATCH",
      jar: admin.jar,
      csrf: admin.csrf,
      body: JSON.stringify({ sprite: "autre-dossier" }),
    });
    assert.equal(forbidden.status, 400, "le dossier ne doit pas changer");

    const replaced = await call(`/admin/items/${itemId}/images`, {
      method: "POST",
      jar: admin.jar,
      csrf: admin.csrf,
      body: JSON.stringify({ images: [PNG_B, PNG_A] }),
    });
    assert.equal(replaced.status, 200);
    assert.equal(replaced.body.item.frames, 2, "les anciennes f3/f4 disparaissent");

    const frame1 = await fetch(`${API}/assets/spaceships/${sprite}/f1.png`);
    assert.equal(Buffer.from(await frame1.arrayBuffer()).toString("base64"), PNG_B);
    const frame3 = await fetch(`${API}/assets/spaceships/${sprite}/f3.png`);
    assert.equal(frame3.status, 404);
  });
});

describe("suppression d'items", () => {
  test("un vaisseau supprimé disparaît des inventaires, du hangar et du disque", async () => {
    const player = await registerUser("own");
    const admin = await adminSession();
    const sprite = uniqueSprite();

    const created = await call("/admin/items", {
      method: "POST",
      jar: admin.jar,
      csrf: admin.csrf,
      body: JSON.stringify({
        name: "Épave",
        price: 0,
        priceGalactics: 0,
        type: "ship",
        sprite,
        images: [PNG_A, PNG_B],
      }),
    });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    const itemId = created.body.item._id;

    const equipped = await call("/shop/equip", {
      method: "POST",
      jar: player.jar,
      csrf: player.csrf,
      body: JSON.stringify({ type: "ship", sprite }),
    });
    assert.equal(equipped.status, 200);
    assert.equal(equipped.body.activeShip, sprite);

    const refused = await call(`/admin/items/${itemId}/delete`, {
      method: "POST",
      jar: player.jar,
      csrf: player.csrf,
    });
    assert.equal(refused.status, 403, "un joueur ne peut pas supprimer d'item");

    const deleted = await call(`/admin/items/${itemId}/delete`, {
      method: "POST",
      jar: admin.jar,
      csrf: admin.csrf,
    });
    assert.equal(deleted.status, 200, JSON.stringify(deleted.body));
    assert.ok(deleted.body.owners >= 1);

    const stats = await call("/stats/me", { jar: player.jar });
    assert.equal(stats.status, 200);
    assert.ok(!stats.body.user.inventory.some((i) => i.sprite === sprite));
    assert.equal(stats.body.user.activeShip, "spaceship-01");

    const shop = await call("/shop/items");
    assert.ok(!shop.body.items.some((i) => i.sprite === sprite));

    const frame = await fetch(`${API}/assets/spaceships/${sprite}/f1.png`);
    assert.equal(frame.status, 404, "le dossier d'images doit être effacé");

    const again = await call(`/admin/items/${itemId}/delete`, {
      method: "POST",
      jar: admin.jar,
      csrf: admin.csrf,
    });
    assert.equal(again.status, 404);
  });

  test("les items de base ne peuvent pas être supprimés", async () => {
    const admin = await adminSession();
    const list = await call("/admin/items", { jar: admin.jar });
    for (const sprite of ["spaceship-01", "bullet1", "bullet2"]) {
      const item = list.body.items.find((i) => i.sprite === sprite);
      assert.ok(item, `${sprite} doit exister après le seed`);
      const res = await call(`/admin/items/${item._id}/delete`, {
        method: "POST",
        jar: admin.jar,
        csrf: admin.csrf,
      });
      assert.equal(res.status, 409, sprite);
    }
  });
});
