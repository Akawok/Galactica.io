import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { io } from "socket.io-client";
import {
  API,
  call,
  cookieHeader,
  registerUser,
  serverIsUp,
} from "./helpers.mjs";

const sockets = [];

function connect(jar, { timeout = 5000 } = {}) {
  return new Promise((resolve, reject) => {
    const socket = io(API, {
      transports: ["websocket"],
      extraHeaders: jar ? { cookie: cookieHeader(jar) } : {},
      reconnection: false,
    });
    sockets.push(socket);
    const timer = setTimeout(() => reject(new Error("timeout")), timeout);
    socket.on("connect", () => {
      clearTimeout(timer);
      resolve(socket);
    });
    socket.on("connect_error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
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

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function joinedSocket(prefix) {
  const user = await registerUser(prefix);
  const socket = await connect(user.jar);
  socket.emit("user:join");
  await sleep(350);
  return { user, socket };
}

before(async () => {
  assert.ok(await serverIsUp(), "Le serveur doit tourner avant les tests");
});

after(() => {
  for (const s of sockets) s.close();
});

describe("authentification du socket", () => {
  test("refuse une connexion sans session", async () => {
    await assert.rejects(() => connect(null));
  });

  test("refuse un cookie de session forgé", async () => {
    await assert.rejects(() =>
      connect({ galactica_session: "aa.bb.cc" }),
    );
  });

  test("refuse un JWT alg:none", async () => {
    const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
    const forged = `${b64({ alg: "none", typ: "JWT" })}.${b64({
      id: "a".repeat(24),
      username: "admin",
      role: "admin",
      tv: 0,
    })}.`;
    await assert.rejects(() => connect({ galactica_session: forged }));
  });

  test("accepte une session valide", async () => {
    const user = await registerUser("sok");
    const socket = await connect(user.jar);
    assert.ok(socket.connected);
  });
});

describe("session unique", () => {
  test("une nouvelle connexion évince la précédente", async () => {
    const user = await registerUser("uni");
    const first = await connect(user.jar);
    const evicted = waitFor(first, "session:terminated", 3000);
    await connect(user.jar);
    const notice = await evicted;
    assert.ok(notice, "la première session doit être terminée");
  });
});

describe("anti-triche", () => {
  test("interdit de rejoindre sa propre partie", async () => {
    const { user, socket } = await joinedSocket("self");
    socket.emit("game:create");
    const created = await waitFor(socket, "game:created");
    assert.ok(created?.roomId);

    const second = await connect(user.jar);
    second.emit("user:join");
    await sleep(300);
    second.emit("game:join", { roomId: created.roomId });

    const navigated = await waitFor(second, "game:navigate", 1200);
    assert.equal(navigated, null, "l'auto-affrontement doit être bloqué");
  });

  test("limite à une partie en attente par joueur", async () => {
    const { socket } = await joinedSocket("cap");
    const rooms = [];
    socket.on("game:created", (d) => rooms.push(d.roomId));

    for (let i = 0; i < 5; i++) {
      socket.emit("game:create");
      await sleep(200);
    }
    assert.equal(rooms.length, 1);
  });

  test("ignore les identifiants de partie malformés", async () => {
    const { socket } = await joinedSocket("bad");
    for (const roomId of [
      "../../etc/passwd",
      { $ne: null },
      "x".repeat(500),
      "<script>",
      42,
    ]) {
      socket.emit("game:join", { roomId });
    }
    await sleep(400);
    assert.ok(await serverIsUp(), "le serveur doit rester debout");
  });

  test("ignore les entrées de jeu malveillantes", async () => {
    const { socket } = await joinedSocket("inp");
    for (const input of [
      { seq: 1, keys: ["hack", "admin"], mouseAngle: Number.NaN, leftClick: true },
      { seq: -5, keys: [], mouseAngle: Number.POSITIVE_INFINITY },
      { seq: 1e9, keys: new Array(1000).fill("z"), mouseAngle: 0 },
      null,
      "chaine",
    ]) {
      socket.emit("game:input", input);
    }
    await sleep(400);
    assert.ok(await serverIsUp());
  });
});

describe("chat", () => {
  test("normalise et tronque les messages", async () => {
    const { socket, user } = await joinedSocket("cht");
    const received = [];
    socket.on("chat:message", (m) => {
      if (m.username === user.username) received.push(m.message);
    });

    socket.emit("chat:message", { message: "  bonjour\n\ntout   le monde  " });
    await sleep(900);
    assert.equal(received.at(-1), "bonjour tout le monde");

    socket.emit("chat:message", { message: "A".repeat(5000) });
    await sleep(1100);
    assert.equal(received.at(-1).length, 200);
  });

  test("retire les caractères de contrôle et RTL", async () => {
    const { socket, user } = await joinedSocket("cht");
    const received = [];
    socket.on("chat:message", (m) => {
      if (m.username === user.username) received.push(m.message);
    });

    socket.emit("chat:message", { message: "s​p​a​m" });
    await sleep(900);
    assert.equal(received.at(-1), "spam");

    socket.emit("chat:message", { message: "‮kcatta" });
    await sleep(1100);
    assert.ok(!received.at(-1).includes("‮"));
  });

  test("limite le flood", async () => {
    const { socket, user } = await joinedSocket("fld");
    const received = [];
    socket.on("chat:message", (m) => {
      if (m.username === user.username) received.push(m.message);
    });

    for (let i = 0; i < 30; i++) {
      socket.emit("chat:message", { message: `flood${i}` });
    }
    await sleep(1500);
    assert.ok(
      received.length <= 3,
      `trop de messages passés : ${received.length}`,
    );
  });

  test("le mute empêche d'écrire", async () => {
    const admin = await registerUser("adm");
    const { execFileSync } = await import("node:child_process");
    execFileSync("node", ["dist/scripts/grant-role.js", admin.username, "admin"], {
      cwd: new URL("..", import.meta.url).pathname,
      stdio: "pipe",
    });
    const session = await call("/auth/login", {
      method: "POST",
      body: JSON.stringify({
        email: admin.email,
        password: "Xk9!vRt2Qm",
      }),
    });

    const { user, socket } = await joinedSocket("mut");
    const listener = await joinedSocket("lis");
    const heard = [];
    listener.socket.on("chat:message", (m) => heard.push(m.message));

    socket.emit("chat:message", { message: "avant le mute" });
    await sleep(900);
    assert.ok(heard.includes("avant le mute"));

    const muted = await call(`/admin/users/${user.id}/mute`, {
      method: "POST",
      jar: session.cookies,
      csrf: session.body.csrfToken,
      body: JSON.stringify({ durationMinutes: 30 }),
    });
    assert.equal(muted.status, 200);

    const before = heard.length;
    socket.emit("chat:message", { message: "APRES LE MUTE" });
    await sleep(1200);
    assert.equal(heard.length, before, "le message ne doit pas passer");
  });
});
