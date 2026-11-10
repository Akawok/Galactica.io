import type { Server, Socket } from "socket.io";

const socketsByUser = new Map<string, Set<string>>();
let io: Server | null = null;

export function bindIO(server: Server) {
  io = server;
}

export function trackSocket(socket: Socket, userId: string) {
  let set = socketsByUser.get(userId);
  if (!set) {
    set = new Set();
    socketsByUser.set(userId, set);
  }
  set.add(socket.id);
}

export function untrackSocket(socket: Socket, userId: string) {
  const set = socketsByUser.get(userId);
  if (!set) return;
  set.delete(socket.id);
  if (set.size === 0) socketsByUser.delete(userId);
}

export function socketCountForUser(userId: string): number {
  return socketsByUser.get(userId)?.size ?? 0;
}

export function getUserSocketIds(userId: string): string[] {
  return Array.from(socketsByUser.get(userId) ?? []);
}

export function disconnectUserSockets(userId: string, reason: string) {
  if (!io) return;
  for (const socketId of getUserSocketIds(userId)) {
    const socket = io.sockets.sockets.get(socketId);
    if (!socket) continue;
    socket.emit("session:terminated", { reason });
    socket.disconnect(true);
  }
}

export function getIO(): Server | null {
  return io;
}
