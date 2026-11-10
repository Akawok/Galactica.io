import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { io } from "socket.io-client";
import {
  API,
  call,
  cookieHeader,
  registerUser,
  serverIsUp,
  STRONG_PASSWORD,
} from "./helpers.mjs";

const sockets = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function grantRole(username, role) {
  execFileSync("node", ["dist/scripts/grant-role.js", username, role], {
    cwd: new URL("..", import.meta.url).pathname,
    stdio: "pipe",
  });
}

async function loginAs(user) {
  const res = await call("/auth/login", {
    method: "POST",
    body: JSON.stringify({ email: user.email, password: STRONG_PASSWORD }),
  });
  assert.equal(res.status, 200, `login échoué: ${JSON.stringify(res.body)}`);
  return { jar: res.cookies, csrf: res.body.csrfToken };
}

async function staff(role) {
  const user = await registerUser(role === "admin" ? "adm" : "mdr");
  grantRole(user.username, role);
  return { ...user, ...(await loginAs(user)) };
}

function as(session, path, body, method = "POST") {
  return call(path, {
    method,
    jar: session.jar,
    csrf: session.csrf,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
}

function connect(jar) {
  return new Promise((resolve, reject) => {
    const socket = io(API, {
      transports: ["websocket"],
      extraHeaders: { cookie: cookieHeader(jar) },
      reconnection: false,
    });
    sockets.push(socket);
    socket.on("connect", () => resolve(socket));
    socket.on("connect_error", reject);
  });
}

function waitFor(socket, event, ms = 2000) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), ms);
    socket.once(event, (payload) => {
      clearTimeout(timer);
      resolve(payload ?? {});
    });
  });
}

before(async () => {
  assert.ok(await serverIsUp(), "Le serveur doit tourner avant les tests");
});

after(() => {
  for (const s of sockets) s.close();
});

describe("accès aux nouvelles routes", () => {
  test("un joueur n'a accès à rien", async () => {
    const player = await registerUser("ply");
    for (const path of ["/admin/overview", "/admin/games/live", "/admin/chat", "/admin/games"]) {
      const res = await call(path, { jar: player.jar });
      assert.equal(res.status, 403, path);
    }
  });

  test("un modérateur voit le tableau de bord mais pas les actions d'admin", async () => {
    const mod = await staff("moderator");
    const victim = await registerUser("vic");

    assert.equal((await call("/admin/overview", { jar: mod.jar })).status, 200);
    assert.equal((await call(`/admin/users/${victim.id}`, { jar: mod.jar })).status, 200);

    const forbidden = [
      [`/admin/users/${victim.id}/resources`, { points: 5 }, "PATCH"],
      [`/admin/users/${victim.id}/delete`, { confirm: victim.username }],
      [`/admin/users/${victim.id}/send-reset`, {}],
      ["/admin/announce", { message: "coucou" }],
    ];
    for (const [path, body, method] of forbidden) {
      const res = await as(mod, path, body, method);
      assert.equal(res.status, 403, path);
    }
  });

  test("un modérateur ne voit pas les emails", async () => {
    const mod = await staff("moderator");
    const victim = await registerUser("vic");
    const res = await call(`/admin/users?q=${victim.username}`, { jar: mod.jar });
    assert.equal(res.status, 200);
    assert.equal(res.body.users[0].username, victim.username);
    assert.equal(res.body.users[0].email, undefined);
  });
});

describe("gestion des joueurs", () => {
  test("recherche, filtre bannis et ban définitif", async () => {
    const admin = await staff("admin");
    const victim = await registerUser("vic");

    const ban = await as(admin, `/admin/users/${victim.id}/ban`, {
      permanent: true,
      reason: "triche",
    });
    assert.equal(ban.status, 200);
    assert.ok(new Date(ban.body.bannedUntil).getUTCFullYear() >= 9999);

    const list = await call(`/admin/users?filter=banned&q=${victim.username}`, {
      jar: admin.jar,
    });
    assert.equal(list.status, 200);
    assert.equal(list.body.total, 1);
    assert.equal(list.body.users[0].email, victim.email);

    const noDuration = await as(admin, `/admin/users/${victim.id}/ban`, {});
    assert.equal(noDuration.status, 400);
  });

  test("renommer change le pseudo et coupe la session", async () => {
    const mod = await staff("moderator");
    const victim = await registerUser("vic");
    const other = await registerUser("oth");

    const taken = await as(mod, `/admin/users/${victim.id}/rename`, {
      username: other.username.toUpperCase(),
    });
    assert.equal(taken.status, 409);

    const bad = await as(mod, `/admin/users/${victim.id}/rename`, { username: "a b" });
    assert.equal(bad.status, 400);

    const newName = `ren${Date.now().toString(36)}`;
    const ok = await as(mod, `/admin/users/${victim.id}/rename`, { username: newName });
    assert.equal(ok.status, 200);
    assert.equal((await call("/auth/me", { jar: victim.jar })).status, 401);

    const relog = await loginAs(victim);
    const me = await call("/auth/me", { jar: relog.jar });
    assert.equal(me.body.user.username, newName);
  });

  test("déconnecter révoque la session", async () => {
    const mod = await staff("moderator");
    const victim = await registerUser("vic");
    const res = await as(mod, `/admin/users/${victim.id}/kick`);
    assert.equal(res.status, 200);
    assert.equal((await call("/auth/me", { jar: victim.jar })).status, 401);
  });

  test("baisser le niveau remet à zéro les points en trop", async () => {
    const admin = await staff("admin");
    const victim = await registerUser("vic");

    const up = await as(
      admin,
      `/admin/users/${victim.id}/resources`,
      { level: 20, points: 1234, galactics: 7 },
      "PATCH",
    );
    assert.equal(up.status, 200);
    assert.equal(up.body.attributesReset, false);

    const relog = await loginAs(victim);
    const spend = await call("/attributes", {
      method: "POST",
      jar: relog.jar,
      csrf: relog.csrf,
      body: JSON.stringify({
        attributes: {
          blindage: 5,
          deflecteur: 0,
          canons: 0,
          cadence: 0,
          ogive: 0,
          propulseurs: 0,
          reacteur: 0,
        },
      }),
    });
    assert.equal(spend.status, 200, JSON.stringify(spend.body));

    const down = await as(
      admin,
      `/admin/users/${victim.id}/resources`,
      { level: 11, xp: 99_999 },
      "PATCH",
    );
    assert.equal(down.status, 200);
    assert.equal(down.body.attributesReset, true);
    assert.ok(down.body.xp < 99_999, "l'XP est bornée au niveau");

    const detail = await call(`/admin/users/${victim.id}`, { jar: admin.jar });
    assert.equal(detail.body.user.points, 1234);
    assert.equal(detail.body.user.level, 11);
    assert.equal(detail.body.user.attributes.blindage, 0);
    assert.ok(detail.body.history.some((h) => h.action === "resources"));
  });

  test("la suppression exige le pseudo exact et refuse les admins", async () => {
    const admin = await staff("admin");
    const otherAdmin = await staff("admin");
    const victim = await registerUser("vic");

    const wrong = await as(admin, `/admin/users/${victim.id}/delete`, { confirm: "nope" });
    assert.equal(wrong.status, 400);

    const adminTarget = await as(admin, `/admin/users/${otherAdmin.id}/delete`, {
      confirm: otherAdmin.username,
    });
    assert.equal(adminTarget.status, 403);

    const ok = await as(admin, `/admin/users/${victim.id}/delete`, {
      confirm: victim.username,
    });
    assert.equal(ok.status, 200);
    assert.equal((await call(`/admin/users/${victim.id}`, { jar: admin.jar })).status, 404);
    assert.equal((await call("/auth/me", { jar: victim.jar })).status, 401);
  });

  test("valider l'email et envoyer un lien de mot de passe", async () => {
    const admin = await staff("admin");
    const victim = await registerUser("vic");

    assert.equal((await as(admin, `/admin/users/${victim.id}/verify-email`)).status, 200);
    const detail = await call(`/admin/users/${victim.id}`, { jar: admin.jar });
    assert.equal(detail.body.user.emailVerified, true);

    assert.equal((await as(admin, `/admin/users/${victim.id}/send-reset`)).status, 200);
  });
});

describe("chat et parties", () => {
  test("un message supprimé disparaît chez tout le monde", async () => {
    const mod = await staff("moderator");
    const author = await registerUser("aut");
    const listener = await registerUser("lis");

    const authorSocket = await connect(author.jar);
    const listenerSocket = await connect(listener.jar);
    authorSocket.emit("user:join");
    listenerSocket.emit("user:join");
    await sleep(350);

    const received = waitFor(listenerSocket, "chat:message");
    authorSocket.emit("chat:message", { message: "message à supprimer" });
    const msg = await received;
    assert.ok(msg?.id, "le message porte un identifiant");

    const removed = waitFor(listenerSocket, "chat:removed");
    const res = await as(mod, `/admin/chat/${msg.id}/delete`);
    assert.equal(res.status, 200);
    assert.deepEqual((await removed)?.ids, [msg.id]);

    const again = await as(mod, `/admin/chat/${msg.id}/delete`);
    assert.equal(again.status, 404);
  });

  test("une annonce arrive dans le chat de tout le monde", async () => {
    const admin = await staff("admin");
    const listener = await registerUser("lis");
    const socket = await connect(listener.jar);
    socket.emit("user:join");
    await sleep(350);

    const received = waitFor(socket, "chat:message");
    const res = await as(admin, "/admin/announce", { message: "  Maintenance à 22 h  " });
    assert.equal(res.status, 200);
    const msg = await received;
    assert.equal(msg?.announcement, true);
    assert.equal(msg?.message, "Maintenance à 22 h");
  });

  test("arrêter une partie renvoie les joueurs au lobby sans récompense", async () => {
    const mod = await staff("moderator");
    const a = await registerUser("pla");
    const b = await registerUser("plb");
    const sa = await connect(a.jar);
    const sb = await connect(b.jar);
    sa.emit("user:join");
    sb.emit("user:join");
    await sleep(350);

    const created = waitFor(sa, "game:created");
    sa.emit("game:create");
    const { roomId } = await created;
    assert.ok(roomId);

    const started = waitFor(sb, "game:start");
    sb.emit("game:join", { roomId });
    assert.ok(await started, "la partie démarre");

    const live = await call("/admin/games/live", { jar: mod.jar });
    const room = live.body.rooms.find((r) => r.roomId === roomId);
    assert.equal(room?.players.length, 2);

    const closedA = waitFor(sa, "game:closed");
    const res = await as(mod, `/admin/games/${roomId}/close`, { reason: "test" });
    assert.equal(res.status, 200);
    assert.equal((await closedA)?.reason, "test");

    const after = await call("/admin/games/live", { jar: mod.jar });
    assert.ok(!after.body.rooms.some((r) => r.roomId === roomId));

    const meA = await call("/stats/me", { jar: a.jar });
    assert.equal(meA.body.user.stats.totalGames, 0, "aucune partie comptée");

    const again = await as(mod, `/admin/games/${roomId}/close`, {});
    assert.equal(again.status, 404);

    const createdAgain = waitFor(sa, "game:created");
    sa.emit("game:create");
    assert.ok(await createdAgain, "le joueur peut relancer une partie");
  });

  test("le journal se filtre par action", async () => {
    const admin = await staff("admin");
    const victim = await registerUser("vic");
    await as(admin, `/admin/users/${victim.id}/mute`, { durationMinutes: 10 });

    const res = await call(`/admin/audit?action=mute&username=${victim.username}`, {
      jar: admin.jar,
    });
    assert.equal(res.status, 200);
    assert.ok(res.body.total >= 1);
    assert.ok(res.body.entries.every((e) => e.action === "mute"));

    const bad = await call("/admin/audit?action=nimporte", { jar: admin.jar });
    assert.equal(bad.status, 400);
  });
});
