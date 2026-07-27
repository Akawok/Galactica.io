import { test, describe, before } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { call, registerUser, serverIsUp, STRONG_PASSWORD } from "./helpers.mjs";

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
  return { jar: res.cookies, csrf: res.body.csrfToken, body: res.body };
}

before(async () => {
  assert.ok(await serverIsUp(), "Le serveur doit tourner avant les tests");
});

describe("promotion et révocation", () => {
  test("la promotion applique le rôle et invalide l'ancienne session", async () => {
    const user = await registerUser("mod");
    const before = await call("/auth/me", { jar: user.jar });
    assert.equal(before.status, 200);

    grantRole(user.username, "admin");

    const stale = await call("/auth/me", { jar: user.jar });
    assert.equal(stale.status, 401, "l'ancienne session doit être révoquée");

    const fresh = await loginAs(user);
    assert.equal(fresh.body.user.role, "admin");
  });
});

describe("bannissement", () => {
  test("le ban révoque la session et bloque la reconnexion", async () => {
    const admin = await registerUser("adm");
    grantRole(admin.username, "admin");
    const session = await loginAs(admin);

    const victim = await registerUser("vic");
    assert.equal((await call("/auth/me", { jar: victim.jar })).status, 200);

    const ban = await call(`/admin/users/${victim.id}/ban`, {
      method: "POST",
      jar: session.jar,
      csrf: session.csrf,
      body: JSON.stringify({ durationMinutes: 60, reason: "triche" }),
    });
    assert.equal(ban.status, 200);

    const after = await call("/auth/me", { jar: victim.jar });
    assert.equal(after.status, 401, "le token du banni doit être révoqué");

    const relogin = await call("/auth/login", {
      method: "POST",
      body: JSON.stringify({
        email: victim.email,
        password: STRONG_PASSWORD,
      }),
    });
    assert.equal(relogin.status, 401);
  });

  test("le banni disparaît du classement", async () => {
    const admin = await registerUser("adm");
    grantRole(admin.username, "admin");
    const session = await loginAs(admin);

    const victim = await registerUser("vic");
    await call(`/admin/users/${victim.id}/ban`, {
      method: "POST",
      jar: session.jar,
      csrf: session.csrf,
      body: JSON.stringify({ durationMinutes: 60 }),
    });

    const board = await call("/leaderboard");
    assert.ok(!JSON.stringify(board.body).includes(victim.username));
  });

  test("le déban restaure l'accès", async () => {
    const admin = await registerUser("adm");
    grantRole(admin.username, "admin");
    const session = await loginAs(admin);

    const victim = await registerUser("vic");
    await call(`/admin/users/${victim.id}/ban`, {
      method: "POST",
      jar: session.jar,
      csrf: session.csrf,
      body: JSON.stringify({ durationMinutes: 60 }),
    });
    const unban = await call(`/admin/users/${victim.id}/unban`, {
      method: "POST",
      jar: session.jar,
      csrf: session.csrf,
    });
    assert.equal(unban.status, 200);

    const relogin = await call("/auth/login", {
      method: "POST",
      body: JSON.stringify({
        email: victim.email,
        password: STRONG_PASSWORD,
      }),
    });
    assert.equal(relogin.status, 200);
  });
});

describe("garde-fous de modération", () => {
  test("un admin ne peut pas se bannir lui-même", async () => {
    const admin = await registerUser("adm");
    grantRole(admin.username, "admin");
    const session = await loginAs(admin);

    const res = await call(`/admin/users/${admin.id}/ban`, {
      method: "POST",
      jar: session.jar,
      csrf: session.csrf,
      body: JSON.stringify({ durationMinutes: 10 }),
    });
    assert.equal(res.status, 400);
  });

  test("un admin ne peut pas modifier son propre rôle", async () => {
    const admin = await registerUser("adm");
    grantRole(admin.username, "admin");
    const session = await loginAs(admin);

    const res = await call(`/admin/users/${admin.id}/role`, {
      method: "POST",
      jar: session.jar,
      csrf: session.csrf,
      body: JSON.stringify({ role: "user" }),
    });
    assert.equal(res.status, 400);
  });

  test("un modérateur ne peut pas bannir un admin", async () => {
    const admin = await registerUser("adm");
    grantRole(admin.username, "admin");

    const mod = await registerUser("mdr");
    grantRole(mod.username, "moderator");
    const modSession = await loginAs(mod);

    const res = await call(`/admin/users/${admin.id}/ban`, {
      method: "POST",
      jar: modSession.jar,
      csrf: modSession.csrf,
      body: JSON.stringify({ durationMinutes: 10 }),
    });
    assert.equal(res.status, 403);
  });

  test("un modérateur ne peut pas changer un rôle", async () => {
    const mod = await registerUser("mdr");
    grantRole(mod.username, "moderator");
    const modSession = await loginAs(mod);
    const victim = await registerUser("vic");

    const res = await call(`/admin/users/${victim.id}/role`, {
      method: "POST",
      jar: modSession.jar,
      csrf: modSession.csrf,
      body: JSON.stringify({ role: "admin" }),
    });
    assert.equal(res.status, 403);
  });

  test("un modérateur peut bannir un joueur", async () => {
    const mod = await registerUser("mdr");
    grantRole(mod.username, "moderator");
    const modSession = await loginAs(mod);
    const victim = await registerUser("vic");

    const res = await call(`/admin/users/${victim.id}/ban`, {
      method: "POST",
      jar: modSession.jar,
      csrf: modSession.csrf,
      body: JSON.stringify({ durationMinutes: 10 }),
    });
    assert.equal(res.status, 200);
  });

  test("refuse une durée hors bornes et un rôle inconnu", async () => {
    const admin = await registerUser("adm");
    grantRole(admin.username, "admin");
    const session = await loginAs(admin);
    const victim = await registerUser("vic");

    const tooLong = await call(`/admin/users/${victim.id}/ban`, {
      method: "POST",
      jar: session.jar,
      csrf: session.csrf,
      body: JSON.stringify({ durationMinutes: 99_999_999 }),
    });
    assert.equal(tooLong.status, 400);

    const badRole = await call(`/admin/users/${victim.id}/role`, {
      method: "POST",
      jar: session.jar,
      csrf: session.csrf,
      body: JSON.stringify({ role: "superadmin" }),
    });
    assert.equal(badRole.status, 400);
  });

  test("neutralise une regex injectée dans la recherche", async () => {
    const admin = await registerUser("adm");
    grantRole(admin.username, "admin");
    const session = await loginAs(admin);

    const res = await call("/admin/users?q=.*", { jar: session.jar });
    assert.equal(res.status, 200);
  });
});
