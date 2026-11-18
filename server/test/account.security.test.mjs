import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { io } from "socket.io-client";
import {
  SERVER,
  call,
  cookieHeader,
  randomName,
  registerUser,
  serverIsUp,
  STRONG_PASSWORD,
} from "./helpers.mjs";

const NEW_PASSWORD = "Zq7#mWp4Lt";

const sockets = [];

function connect(jar) {
  return new Promise((resolve, reject) => {
    const socket = io(SERVER, {
      transports: ["websocket"],
      extraHeaders: { cookie: cookieHeader(jar) },
      reconnection: false,
    });
    sockets.push(socket);
    socket.on("connect", () => resolve(socket));
    socket.on("connect_error", reject);
  });
}

function waitFor(socket, event, match = () => true, ms = 2000) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), ms);
    const handler = (payload) => {
      if (!match(payload)) return;
      clearTimeout(timer);
      socket.off(event, handler);
      resolve(payload ?? {});
    };
    socket.on(event, handler);
  });
}

before(async () => {
  assert.ok(await serverIsUp(), "Le serveur doit tourner avant les tests");
});

after(() => {
  for (const s of sockets) s.close();
});

function post(path, user, body) {
  return call(path, {
    method: "POST",
    jar: user.jar,
    csrf: user.csrf,
    body: JSON.stringify(body),
  });
}

describe("changement de pseudo par le joueur", () => {
  test("le nouveau pseudo est pris en compte et la session reste valide", async () => {
    const user = await registerUser("ren");
    const username = randomName("new");

    const res = await post("/auth/username", user, { username });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.user.username, username);

    const me = await call("/auth/me", { jar: res.cookies });
    assert.equal(me.status, 200);
    assert.equal(me.body.user.username, username);

    const oldSession = await call("/auth/me", { jar: user.jar });
    assert.equal(oldSession.status, 200, "un changement de pseudo ne coupe pas la session");
  });

  test("le lobby affiche tout de suite le nouveau pseudo", async () => {
    const user = await registerUser("ren");
    const socket = await connect(user.jar);
    const joined = waitFor(socket, "lobby:state", (s) =>
      s.players.some((p) => p.username === user.username),
    );
    socket.emit("user:join");
    assert.ok(await joined, "le joueur doit apparaître dans le lobby");

    const username = randomName("new");
    const renamed = waitFor(socket, "lobby:state", (s) =>
      s.players.some((p) => p.username === username),
    );
    const res = await post("/auth/username", user, { username });
    assert.equal(res.status, 200);
    const state = await renamed;
    assert.ok(state, "le lobby doit recevoir le nouveau pseudo");
    assert.ok(!state.players.some((p) => p.username === user.username));
  });

  test("un seul changement de pseudo par jour, même en parallèle", async () => {
    const user = await registerUser("ren");
    const results = await Promise.all(
      [randomName("a"), randomName("b"), randomName("c")].map((username) =>
        post("/auth/username", user, { username }),
      ),
    );
    const codes = results.map((r) => r.status).sort();
    assert.deepEqual(codes, [200, 429, 429], JSON.stringify(codes));
  });

  test("refuse un pseudo déjà pris, même avec une casse différente", async () => {
    const other = await registerUser("tak");
    const user = await registerUser("ren");
    const res = await post("/auth/username", user, { username: other.username.toUpperCase() });
    assert.equal(res.status, 409);
  });

  test("refuse un pseudo invalide ou réservé", async () => {
    const user = await registerUser("ren");
    for (const username of ["ab", "pas valide", "-tiret", "admin"]) {
      const res = await post("/auth/username", user, { username });
      assert.equal(res.status, 400, username);
    }
  });

  test("exige d'être connecté et le jeton CSRF", async () => {
    const anonymous = await call("/auth/username", {
      method: "POST",
      body: JSON.stringify({ username: randomName("x") }),
    });
    assert.equal(anonymous.status, 401);

    const user = await registerUser("ren");
    const noCsrf = await call("/auth/username", {
      method: "POST",
      jar: user.jar,
      body: JSON.stringify({ username: randomName("x") }),
    });
    assert.equal(noCsrf.status, 403);
  });
});

describe("changement de mot de passe par le joueur", () => {
  test("refuse un mot de passe actuel faux sans couper la session", async () => {
    const user = await registerUser("pwd");
    const res = await post("/auth/password", user, {
      currentPassword: "PasLeBon1!x",
      newPassword: NEW_PASSWORD,
    });
    assert.equal(res.status, 400);
    const me = await call("/auth/me", { jar: user.jar });
    assert.equal(me.status, 200);
  });

  test("verrouille après plusieurs mauvais mots de passe actuels", async () => {
    const user = await registerUser("pwd");
    let last;
    for (let i = 0; i < 9; i++) {
      last = await post("/auth/password", user, {
        currentPassword: `Faux${i}!abcdef`,
        newPassword: NEW_PASSWORD,
      });
    }
    assert.equal(last.status, 429, "le compte doit être verrouillé");
    const good = await post("/auth/password", user, {
      currentPassword: STRONG_PASSWORD,
      newPassword: NEW_PASSWORD,
    });
    assert.equal(good.status, 429, "même le bon mot de passe attend la fin du verrouillage");
  });

  test("refuse un nouveau mot de passe faible ou identique", async () => {
    const user = await registerUser("pwd");
    for (const newPassword of ["motdepasse", STRONG_PASSWORD]) {
      const res = await post("/auth/password", user, {
        currentPassword: STRONG_PASSWORD,
        newPassword,
      });
      assert.equal(res.status, 400, newPassword);
    }
  });

  test("le nouveau mot de passe remplace l'ancien et coupe les autres sessions", async () => {
    const user = await registerUser("pwd");
    const otherDevice = await call("/auth/login", {
      method: "POST",
      body: JSON.stringify({ email: user.email, password: STRONG_PASSWORD }),
    });
    assert.equal(otherDevice.status, 200);

    const res = await post("/auth/password", user, {
      currentPassword: STRONG_PASSWORD,
      newPassword: NEW_PASSWORD,
    });
    assert.equal(res.status, 200, JSON.stringify(res.body));

    const current = await call("/auth/me", { jar: res.cookies });
    assert.equal(current.status, 200, "la session qui a changé le mot de passe continue");

    const revoked = await call("/auth/me", { jar: otherDevice.cookies });
    assert.equal(revoked.status, 401, "les autres sessions sont coupées");

    const oldLogin = await call("/auth/login", {
      method: "POST",
      body: JSON.stringify({ email: user.email, password: STRONG_PASSWORD }),
    });
    assert.equal(oldLogin.status, 401);

    const newLogin = await call("/auth/login", {
      method: "POST",
      body: JSON.stringify({ email: user.email, password: NEW_PASSWORD }),
    });
    assert.equal(newLogin.status, 200);
  });

  test("la page qui change le mot de passe garde sa connexion temps réel", async () => {
    const user = await registerUser("pwd");
    const socket = await connect(user.jar);
    const kicked = waitFor(socket, "session:terminated", undefined, 800);
    const res = await post("/auth/password", user, {
      currentPassword: STRONG_PASSWORD,
      newPassword: NEW_PASSWORD,
      socketId: socket.id,
    });
    assert.equal(res.status, 200);
    assert.equal(await kicked, null, "cette page ne doit pas être déconnectée");
    assert.ok(socket.connected);
  });

  test("les autres pages ouvertes sont déconnectées", async () => {
    const user = await registerUser("pwd");
    const socket = await connect(user.jar);
    const kicked = waitFor(socket, "session:terminated");
    const res = await post("/auth/password", user, {
      currentPassword: STRONG_PASSWORD,
      newPassword: NEW_PASSWORD,
    });
    assert.equal(res.status, 200);
    assert.ok(await kicked, "l'autre page doit être renvoyée à la connexion");
  });
});
