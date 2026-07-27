import { test, describe, before } from "node:test";
import assert from "node:assert/strict";
import { call, registerUser, serverIsUp, STRONG_PASSWORD } from "./helpers.mjs";

let captureEnabled = false;

before(async () => {
  assert.ok(await serverIsUp(), "Le serveur doit tourner avant les tests");
  const probe = await call("/test/mails");
  captureEnabled = probe.status === 200;
});

async function tokenFromMail(email) {
  const res = await call("/test/mails");
  const mail = [...res.body.mails].reverse().find((m) => m.to === email);
  if (!mail) return null;
  const match = mail.body.match(/token=([^\s&]+)/);
  return match ? decodeURIComponent(match[1]) : null;
}

describe("mot de passe oublié", () => {
  test("ne révèle pas si l'adresse existe", async () => {
    const user = await registerUser("fp");

    const known = await call("/auth/forgot-password", {
      method: "POST",
      body: JSON.stringify({ email: user.email }),
    });
    const unknown = await call("/auth/forgot-password", {
      method: "POST",
      body: JSON.stringify({ email: "inexistant@example.test" }),
    });

    assert.equal(known.status, unknown.status);
    assert.deepEqual(known.body, unknown.body);
  });

  test("refuse un token inexistant", async () => {
    const res = await call("/auth/reset-password", {
      method: "POST",
      body: JSON.stringify({
        token: "x".repeat(43),
        password: "Nouveau!Pass9",
      }),
    });
    assert.equal(res.status, 400);
  });

  test("le flux complet change le mot de passe", async (t) => {
    if (!captureEnabled) {
      t.skip("CAPTURE_MAILS=true requis pour ce test");
      return;
    }

    const user = await registerUser("fp");
    await call("/auth/forgot-password", {
      method: "POST",
      body: JSON.stringify({ email: user.email }),
    });

    const token = await tokenFromMail(user.email);
    assert.ok(token, "aucun lien de réinitialisation reçu");

    const NEW_PASSWORD = "Toute!Neuve42";
    const reset = await call("/auth/reset-password", {
      method: "POST",
      body: JSON.stringify({ token, password: NEW_PASSWORD }),
    });
    assert.equal(reset.status, 200);

    const oldLogin = await call("/auth/login", {
      method: "POST",
      body: JSON.stringify({ email: user.email, password: STRONG_PASSWORD }),
    });
    assert.equal(oldLogin.status, 401, "l'ancien mot de passe doit être refusé");

    const newLogin = await call("/auth/login", {
      method: "POST",
      body: JSON.stringify({ email: user.email, password: NEW_PASSWORD }),
    });
    assert.equal(newLogin.status, 200);
  });

  test("la réinitialisation révoque les sessions existantes", async (t) => {
    if (!captureEnabled) {
      t.skip("CAPTURE_MAILS=true requis pour ce test");
      return;
    }

    const user = await registerUser("rev");
    assert.equal((await call("/auth/me", { jar: user.jar })).status, 200);

    await call("/auth/forgot-password", {
      method: "POST",
      body: JSON.stringify({ email: user.email }),
    });
    const token = await tokenFromMail(user.email);
    assert.ok(token);

    await call("/auth/reset-password", {
      method: "POST",
      body: JSON.stringify({ token, password: "Encore!Autre77" }),
    });

    const after = await call("/auth/me", { jar: user.jar });
    assert.equal(after.status, 401, "l'ancienne session doit être révoquée");
  });

  test("un token ne peut servir qu'une seule fois", async (t) => {
    if (!captureEnabled) {
      t.skip("CAPTURE_MAILS=true requis pour ce test");
      return;
    }

    const user = await registerUser("once");
    await call("/auth/forgot-password", {
      method: "POST",
      body: JSON.stringify({ email: user.email }),
    });
    const token = await tokenFromMail(user.email);
    assert.ok(token);

    const first = await call("/auth/reset-password", {
      method: "POST",
      body: JSON.stringify({ token, password: "Premier!Pass9" }),
    });
    assert.equal(first.status, 200);

    const second = await call("/auth/reset-password", {
      method: "POST",
      body: JSON.stringify({ token, password: "Second!Pass99" }),
    });
    assert.equal(second.status, 400, "le token doit être consommé");
  });

  test("une nouvelle demande invalide le lien précédent", async (t) => {
    if (!captureEnabled) {
      t.skip("CAPTURE_MAILS=true requis pour ce test");
      return;
    }

    const user = await registerUser("two");
    await call("/auth/forgot-password", {
      method: "POST",
      body: JSON.stringify({ email: user.email }),
    });
    const firstToken = await tokenFromMail(user.email);

    await call("/auth/forgot-password", {
      method: "POST",
      body: JSON.stringify({ email: user.email }),
    });
    const secondToken = await tokenFromMail(user.email);
    assert.notEqual(firstToken, secondToken);

    const stale = await call("/auth/reset-password", {
      method: "POST",
      body: JSON.stringify({ token: firstToken, password: "Ancien!Lien42" }),
    });
    assert.equal(stale.status, 400, "l'ancien lien doit être invalide");
  });

  test("refuse un mot de passe faible sans consommer le lien", async (t) => {
    if (!captureEnabled) {
      t.skip("CAPTURE_MAILS=true requis pour ce test");
      return;
    }

    const user = await registerUser("weak");
    await call("/auth/forgot-password", {
      method: "POST",
      body: JSON.stringify({ email: user.email }),
    });
    const token = await tokenFromMail(user.email);

    const rejected = await call("/auth/reset-password", {
      method: "POST",
      body: JSON.stringify({ token, password: "motdepasse" }),
    });
    assert.equal(rejected.status, 400);

    const retry = await call("/auth/reset-password", {
      method: "POST",
      body: JSON.stringify({ token, password: "Seconde!Chance7" }),
    });
    assert.equal(
      retry.status,
      200,
      "un refus de validation ne doit pas invalider le lien",
    );
  });
});

describe("vérification d'email", () => {
  test("l'envoi de vérification exige une session", async () => {
    const res = await call("/auth/send-verification", { method: "POST" });
    assert.equal(res.status, 401);
  });

  test("refuse un token de vérification invalide", async () => {
    const res = await call("/auth/verify-email", {
      method: "POST",
      body: JSON.stringify({ token: "z".repeat(43) }),
    });
    assert.equal(res.status, 400);
  });

  test("le flux complet vérifie l'adresse", async (t) => {
    if (!captureEnabled) {
      t.skip("CAPTURE_MAILS=true requis pour ce test");
      return;
    }

    const user = await registerUser("ver");
    const sent = await call("/auth/send-verification", {
      method: "POST",
      jar: user.jar,
      csrf: user.csrf,
    });
    assert.equal(sent.status, 200);

    const token = await tokenFromMail(user.email);
    assert.ok(token, "aucun lien de vérification reçu");

    const verified = await call("/auth/verify-email", {
      method: "POST",
      body: JSON.stringify({ token }),
    });
    assert.equal(verified.status, 200);

    const again = await call("/auth/verify-email", {
      method: "POST",
      body: JSON.stringify({ token }),
    });
    assert.equal(again.status, 400, "le token doit être consommé");
  });
});
