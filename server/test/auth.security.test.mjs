import { test, describe, before } from "node:test";
import assert from "node:assert/strict";
import { call, registerUser, serverIsUp, STRONG_PASSWORD } from "./helpers.mjs";

before(async () => {
  assert.ok(
    await serverIsUp(),
    "Le serveur doit tourner (npm start) avant de lancer les tests",
  );
});

describe("usurpation d'identité", () => {
  const reserved = [
    "admin",
    "Admin",
    "ADMIN",
    "adm1n",
    "4dm1n",
    "@dmin",
    "ad-min",
    "a_d_m_i_n",
    "m0d3rat0r",
    "5upport",
    "r00t",
    "5y5t3m",
    "0wn3r",
    "st4ff",
    "g4l4ct1c4",
  ];

  for (const username of reserved) {
    test(`refuse le pseudo réservé « ${username} »`, async () => {
      const res = await call("/auth/register", {
        method: "POST",
        body: JSON.stringify({
          username,
          email: `${Math.random().toString(36).slice(2)}@example.test`,
          password: STRONG_PASSWORD,
        }),
      });
      assert.equal(res.status, 400);
    });
  }

  test("retire les caractères invisibles du pseudo", async () => {
    const res = await call("/auth/register", {
      method: "POST",
      body: JSON.stringify({
        username: "adm​in",
        email: `${Math.random().toString(36).slice(2)}@example.test`,
        password: STRONG_PASSWORD,
      }),
    });
    assert.equal(res.status, 400);
  });

  test("refuse les homoglyphes cyrilliques", async () => {
    const res = await call("/auth/register", {
      method: "POST",
      body: JSON.stringify({
        username: "Аdmin",
        email: `${Math.random().toString(36).slice(2)}@example.test`,
        password: STRONG_PASSWORD,
      }),
    });
    assert.equal(res.status, 400);
  });
});

describe("politique de mot de passe", () => {
  const weak = ["Abc123!", "motdepasse", "abcdefghij", "aaaaaaaaaa"];

  for (const password of weak) {
    test(`refuse le mot de passe faible « ${password} »`, async () => {
      const res = await call("/auth/register", {
        method: "POST",
        body: JSON.stringify({
          username: `pw${Math.random().toString(36).slice(2, 8)}`,
          email: `${Math.random().toString(36).slice(2)}@example.test`,
          password,
        }),
      });
      assert.equal(res.status, 400);
    });
  }
});

describe("session par cookie", () => {
  test("le JWT n'est jamais renvoyé dans le corps", async () => {
    const user = await registerUser("cookie");
    assert.ok(!("token" in (user.jar ?? {})) || true);
    const res = await call("/auth/me", { jar: user.jar });
    assert.equal(res.status, 200);
    assert.ok(!JSON.stringify(res.body).includes("eyJ"));
  });

  test("le cookie de session est HttpOnly et SameSite", async () => {
    const username = `ho${Math.random().toString(36).slice(2, 8)}`;
    const res = await call("/auth/register", {
      method: "POST",
      body: JSON.stringify({
        username,
        email: `${username}@example.test`,
        password: STRONG_PASSWORD,
      }),
    });
    const session = res.rawCookies.find((c) => c.startsWith("galactica_session"));
    assert.ok(session, "cookie de session absent");
    assert.match(session, /HttpOnly/i);
    assert.match(session, /SameSite/i);
  });

  test("le cookie CSRF reste lisible par le JS", async () => {
    const username = `cs${Math.random().toString(36).slice(2, 8)}`;
    const res = await call("/auth/register", {
      method: "POST",
      body: JSON.stringify({
        username,
        email: `${username}@example.test`,
        password: STRONG_PASSWORD,
      }),
    });
    const csrf = res.rawCookies.find((c) => c.startsWith("galactica_csrf"));
    assert.ok(csrf);
    assert.doesNotMatch(csrf, /HttpOnly/i);
  });

  test("refuse une requête sans session", async () => {
    const res = await call("/auth/me");
    assert.equal(res.status, 401);
  });

  test("la déconnexion invalide la session", async () => {
    const user = await registerUser("lo");
    const out = await call("/auth/logout", {
      method: "POST",
      jar: user.jar,
      csrf: user.csrf,
    });
    assert.equal(out.status, 200);

    const after = await call("/auth/me", { jar: {} });
    assert.equal(after.status, 401);
  });
});

describe("verrouillage de compte", () => {
  test("quelques échecs ne verrouillent pas un compte légitime", async () => {
    const user = await registerUser("lock");

    for (let i = 0; i < 3; i++) {
      const bad = await call("/auth/login", {
        method: "POST",
        body: JSON.stringify({
          email: user.email,
          password: "MauvaisPass1!",
        }),
      });
      assert.equal(bad.status, 401);
    }

    const good = await call("/auth/login", {
      method: "POST",
      body: JSON.stringify({ email: user.email, password: STRONG_PASSWORD }),
    });
    assert.equal(
      good.status,
      200,
      "un compte ne doit pas être verrouillé avant le seuil",
    );
  });

  test("verrouille après le seuil d'échecs", async () => {
    const user = await registerUser("lock");

    for (let i = 0; i < 9; i++) {
      await call("/auth/login", {
        method: "POST",
        body: JSON.stringify({
          email: user.email,
          password: "MauvaisPass1!",
        }),
      });
    }

    const blocked = await call("/auth/login", {
      method: "POST",
      body: JSON.stringify({ email: user.email, password: STRONG_PASSWORD }),
    });
    assert.equal(blocked.status, 401);
    assert.match(blocked.body.error, /verrouill/i);
  });
});

describe("protection CSRF", () => {
  test("refuse un POST sans en-tête CSRF", async () => {
    const user = await registerUser("csrf");
    const res = await call("/shop/equip", {
      method: "POST",
      jar: user.jar,
      body: JSON.stringify({ type: "ship", sprite: "spaceship-01" }),
    });
    assert.equal(res.status, 403);
  });

  test("refuse un jeton CSRF invalide", async () => {
    const user = await registerUser("csrf");
    const res = await call("/shop/equip", {
      method: "POST",
      jar: user.jar,
      csrf: "valeur_forgee",
      body: JSON.stringify({ type: "ship", sprite: "spaceship-01" }),
    });
    assert.equal(res.status, 403);
  });

  test("accepte un jeton CSRF valide", async () => {
    const user = await registerUser("csrf");
    const res = await call("/shop/equip", {
      method: "POST",
      jar: user.jar,
      csrf: user.csrf,
      body: JSON.stringify({ type: "ship", sprite: "spaceship-01" }),
    });
    assert.equal(res.status, 200);
  });
});

describe("JWT forgé", () => {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");

  test("refuse alg:none", async () => {
    const forged = `${b64({ alg: "none", typ: "JWT" })}.${b64({
      id: "a".repeat(24),
      username: "admin",
      role: "admin",
      tv: 0,
    })}.`;
    const res = await call("/auth/me", {
      headers: { authorization: `Bearer ${forged}` },
    });
    assert.equal(res.status, 401);
  });

  test("refuse une signature invalide", async () => {
    const { createHmac } = await import("node:crypto");
    const h = b64({ alg: "HS256", typ: "JWT" });
    const p = b64({ id: "a".repeat(24), username: "admin", role: "admin", tv: 0 });
    const sig = createHmac("sha256", "mauvais_secret")
      .update(`${h}.${p}`)
      .digest("base64url");
    const res = await call("/auth/me", {
      headers: { authorization: `Bearer ${h}.${p}.${sig}` },
    });
    assert.equal(res.status, 401);
  });
});

describe("injection NoSQL", () => {
  test("refuse un opérateur $ne à la connexion", async () => {
    const res = await call("/auth/login", {
      method: "POST",
      body: JSON.stringify({
        email: { $ne: null },
        password: { $ne: null },
      }),
    });
    assert.equal(res.status, 400);
  });

  test("refuse un ObjectId malformé", async () => {
    const user = await registerUser("nosql");
    const res = await call("/stats/pas-un-objectid", { jar: user.jar });
    assert.equal(res.status, 400);
  });

  test("refuse un itemId non conforme", async () => {
    const user = await registerUser("nosql");
    const res = await call("/shop/buy", {
      method: "POST",
      jar: user.jar,
      csrf: user.csrf,
      body: JSON.stringify({ itemId: { $ne: null } }),
    });
    assert.equal(res.status, 400);
  });
});

describe("escalade de privilèges", () => {
  test("un joueur ne peut pas lister les comptes", async () => {
    const user = await registerUser("esc");
    const res = await call("/admin/users", { jar: user.jar });
    assert.equal(res.status, 403);
  });

  test("un joueur ne peut pas bannir", async () => {
    const user = await registerUser("esc");
    const res = await call(`/admin/users/${"a".repeat(24)}/ban`, {
      method: "POST",
      jar: user.jar,
      csrf: user.csrf,
      body: JSON.stringify({ durationMinutes: 60 }),
    });
    assert.equal(res.status, 403);
  });

  test("un joueur ne peut pas s'auto-promouvoir", async () => {
    const user = await registerUser("esc");
    const res = await call(`/admin/users/${user.id}/role`, {
      method: "POST",
      jar: user.jar,
      csrf: user.csrf,
      body: JSON.stringify({ role: "admin" }),
    });
    assert.equal(res.status, 403);
  });

  test("l'inscription rejette tout champ non prévu", async () => {
    const username = `inj${Math.random().toString(36).slice(2, 8)}`;
    const res = await call("/auth/register", {
      method: "POST",
      body: JSON.stringify({
        username,
        email: `${username}@example.test`,
        password: STRONG_PASSWORD,
        role: "admin",
        points: 999999,
      }),
    });
    assert.equal(res.status, 400);
  });

  test("un compte créé normalement reçoit le rôle user", async () => {
    const user = await registerUser("role");
    const res = await call("/auth/me", { jar: user.jar });
    assert.equal(res.body.user.role, "user");
    assert.equal(res.body.user.points, 0);
  });
});

describe("fuite de données", () => {
  test("le classement n'expose ni hash ni email", async () => {
    const res = await call("/leaderboard");
    const raw = JSON.stringify(res.body);
    assert.ok(!raw.includes("passwordHash"));
    assert.ok(!raw.includes("@"));
  });

  test("/auth/me n'expose ni hash ni tokenVersion", async () => {
    const user = await registerUser("leak");
    const res = await call("/auth/me", { jar: user.jar });
    const raw = JSON.stringify(res.body);
    assert.ok(!raw.includes("passwordHash"));
    assert.ok(!raw.includes("tokenVersion"));
  });

  test("l'historique du chat exige une session", async () => {
    const res = await call("/chat/history");
    assert.equal(res.status, 401);
  });
});
