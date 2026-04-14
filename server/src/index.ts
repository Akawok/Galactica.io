import Fastify from "fastify";
import fastifyJwt from "@fastify/jwt";
import fastifyCors from "@fastify/cors";
import { createServer } from "http";
import { Server } from "socket.io";
import { config, connectDB } from "./config.js";
import { authRoutes } from "./routes/auth.js";
import { shopRoutes } from "./routes/shop.js";
import { statsRoutes } from "./routes/stats.js";
import { leaderboardRoutes } from "./routes/leaderboard.js";
import { chatRoutes } from "./routes/chat.js";
import { registerLobbySocket } from "./sockets/lobby.js";

// On crée d'abord le serveur HTTP nu, puis on le passe à Fastify
const httpServer = createServer();

const app = Fastify({
  logger: true,
  serverFactory: (handler) => {
    httpServer.on("request", handler);
    return httpServer;
  },
});

// Plugins
await app.register(fastifyCors, {
  origin: config.clientUrl,
  credentials: true,
});
await app.register(fastifyJwt, { secret: config.jwtSecret });

// Décorateur pour protéger les routes
app.decorate("authenticate", async (request: any, reply: any) => {
  try {
    await request.jwtVerify();
  } catch {
    reply.code(401).send({ error: "Non autorisé" });
  }
});

// Routes REST
await app.register(authRoutes);
await app.register(shopRoutes);
await app.register(statsRoutes);
await app.register(leaderboardRoutes);
await app.register(chatRoutes);

// Health check
app.get("/health", async () => ({ status: "ok" }));

// Socket.IO attaché au même serveur HTTP
const io = new Server(httpServer, {
  cors: { origin: config.clientUrl, methods: ["GET", "POST"] },
});

io.on("connection", (socket) => {
  app.log.info(`Socket connecté : ${socket.id}`);
  registerLobbySocket(io, socket);
});

// Démarrage
await connectDB();
await app.ready();
httpServer.listen(config.port, () => {
  app.log.info(`🚀 Serveur démarré sur http://localhost:${config.port}`);
});
