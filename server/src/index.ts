import Fastify, { type FastifyError } from "fastify";
import fastifyJwt from "@fastify/jwt";
import fastifyCors from "@fastify/cors";
import fastifyHelmet from "@fastify/helmet";
import fastifyRateLimit from "@fastify/rate-limit";
import fastifyCookie from "@fastify/cookie";
import { createServer } from "http";
import { Server } from "socket.io";
import { config, isProduction, connectDB } from "./config.js";
import { authRoutes } from "./routes/auth.js";
import { shopRoutes } from "./routes/shop.js";
import { statsRoutes } from "./routes/stats.js";
import { attributesRoutes } from "./routes/attributes.js";
import { leaderboardRoutes } from "./routes/leaderboard.js";
import { chatRoutes } from "./routes/chat.js";
import { adminRoutes } from "./routes/admin.js";
import { adminItemsRoutes } from "./routes/admin-items.js";
import { adminSiteRoutes } from "./routes/admin-site.js";
import { assetsRoutes } from "./routes/assets.js";
import { registerLobbySocket } from "./sockets/lobby.js";
import { bindIO } from "./sockets/registry.js";
import {
  AUTH_FAILURE_MESSAGE,
  authorizeToken,
  hasRole,
} from "./services/access.service.js";
import {
  readSessionToken,
  readSocketToken,
  verifyCsrf,
} from "./services/session.service.js";
import type { UserRole } from "./models/User.js";
import { pruneLoginAttempts } from "./services/auth.service.js";
import { sentMails } from "./services/mailer.service.js";

const httpServer = createServer();

const app = Fastify({
  trustProxy: isProduction || process.env.TRUST_PROXY === "true",
  bodyLimit: 64 * 1024,
  ajv: { customOptions: { removeAdditional: false, allErrors: false } },
  logger: {
    level: isProduction ? "info" : "debug",
    redact: {
      paths: [
        "req.headers.authorization",
        "req.headers.cookie",
        "req.body.password",
        "req.body.email",
        "res.headers['set-cookie']",
      ],
      censor: "[redacted]",
    },
  },
  serverFactory: (handler) => {
    httpServer.on("request", handler);
    return httpServer;
  },
});

await app.register(fastifyHelmet, {
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:", "blob:"],
      connectSrc: ["'self'", ...config.clientUrls],
      objectSrc: ["'none'"],
      frameAncestors: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'"],
    },
  },
  crossOriginResourcePolicy: { policy: "same-site" },
  hsts: isProduction
    ? { maxAge: 31_536_000, includeSubDomains: true, preload: true }
    : false,
});

await app.register(fastifyCookie);

await app.register(fastifyCors, {
  origin: config.clientUrls,
  credentials: true,
  methods: ["GET", "POST", "PATCH"],
  allowedHeaders: ["Content-Type", "Authorization", "x-csrf-token"],
});

await app.register(fastifyRateLimit, {
  global: true,
  max: 300,
  timeWindow: "1 minute",
  keyGenerator: (req) => req.account?.id ?? req.ip,
  allowList: (req) => req.url === "/api/health",
  errorResponseBuilder: (_req, context) => ({
    statusCode: 429,
    error: "Too Many Requests",
    message: `Trop de requêtes, réessaie dans ${context.after}`,
  }),
});

await app.register(fastifyJwt, {
  secret: config.jwtSecret,
  sign: { algorithm: "HS256" },
  verify: { algorithms: ["HS256"] },
});

app.decorate("authenticate", async (request: any, reply: any) => {
  if (!verifyCsrf(request)) {
    return reply.code(403).send({ error: "Requête non autorisée (CSRF)" });
  }

  const token = readSessionToken(request);
  if (!token) return reply.code(401).send({ error: "Non autorisé" });

  let payload: unknown;
  try {
    payload = app.jwt.verify(token);
  } catch {
    return reply.code(401).send({ error: "Non autorisé" });
  }

  const result = await authorizeToken(payload);
  if ("failure" in result) {
    const code = result.failure === "banned" ? 403 : 401;
    return reply
      .code(code)
      .send({ error: AUTH_FAILURE_MESSAGE[result.failure] });
  }
  request.account = result.account;
});

app.decorate(
  "requireRole",
  (role: UserRole) => async (request: any, reply: any) => {
    const account = request.account;
    if (!account || !hasRole(account.role, role)) {
      return reply.code(403).send({ error: "Accès refusé" });
    }
  },
);

app.setErrorHandler((err: FastifyError, req, reply) => {
  const status = err.statusCode ?? 500;
  if (status >= 500) {
    req.log.error({ err }, "unhandled error");
    return reply.code(500).send({ error: "Erreur serveur" });
  }
  if (status === 429) {
    return reply.code(429).send({
      error: "Trop de requêtes, réessaie dans un instant",
    });
  }
  return reply.code(status).send({ error: err.message ?? "Requête invalide" });
});

app.setNotFoundHandler((_req, reply) =>
  reply.code(404).send({ error: "Ressource introuvable" }),
);

// Everything under /api: Caddy serves the client on the same origin and routes /api and /socket.io here.
await app.register(
  async (api) => {
    await api.register(authRoutes);
    await api.register(shopRoutes);
    await api.register(statsRoutes);
    await api.register(attributesRoutes);
    await api.register(leaderboardRoutes);
    await api.register(chatRoutes);
    await api.register(adminRoutes);
    await api.register(adminItemsRoutes);
    await api.register(adminSiteRoutes);
    await api.register(assetsRoutes);

    api.get("/health", async () => ({ status: "ok" }));

    if (config.captureMails) {
      api.log.warn("CAPTURE_MAILS actif : /api/test/mails est exposé (jamais en prod)");
      api.get("/test/mails", async () => ({ mails: sentMails }));
    }
  },
  { prefix: "/api" },
);

const io = new Server(httpServer, {
  cors: {
    origin: config.clientUrls,
    methods: ["GET", "POST"],
    credentials: true,
  },
  transports: ["websocket"],
  allowUpgrades: false,
  // CORS does not apply to a WebSocket upgrade: without this, any site could open one
  // with the player's cookie. Clients without an Origin header are not browsers.
  allowRequest: (req, callback) => {
    const origin = req.headers.origin;
    callback(null, !origin || config.clientUrls.includes(origin));
  },
  maxHttpBufferSize: 8 * 1024,
  pingTimeout: 20_000,
  connectTimeout: 10_000,
});

io.use(async (socket, next) => {
  try {
    const token = readSocketToken(socket.handshake);
    if (!token) {
      return next(new Error("Authentification requise"));
    }

    const payload = app.jwt.verify(token);
    const result = await authorizeToken(payload);
    if ("failure" in result) {
      return next(new Error(AUTH_FAILURE_MESSAGE[result.failure]));
    }

    socket.data.userId = result.account.id;
    next();
  } catch {
    next(new Error("Token invalide"));
  }
});

bindIO(io);

io.on("connection", (socket) => {
  registerLobbySocket(io, socket);
});

setInterval(pruneLoginAttempts, 5 * 60_000).unref();

await connectDB();
await app.ready();
httpServer.listen(config.port, () => {
  app.log.info(`🚀 Serveur démarré sur http://localhost:${config.port}`);
});
