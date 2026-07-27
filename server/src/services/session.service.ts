import { randomBytes, timingSafeEqual } from "crypto";
import type { FastifyReply, FastifyRequest } from "fastify";
import { isProduction } from "../config.js";

export const SESSION_COOKIE = "galactica_session";
export const CSRF_COOKIE = "galactica_csrf";
export const CSRF_HEADER = "x-csrf-token";

const SESSION_MAX_AGE_S = 12 * 60 * 60;

export function issueSession(reply: FastifyReply, token: string) {
  const csrfToken = randomBytes(32).toString("base64url");

  reply.setCookie(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: isProduction,
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_MAX_AGE_S,
  });

  reply.setCookie(CSRF_COOKIE, csrfToken, {
    httpOnly: false,
    secure: isProduction,
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_MAX_AGE_S,
  });

  return csrfToken;
}

export function clearSession(reply: FastifyReply) {
  reply.clearCookie(SESSION_COOKIE, { path: "/" });
  reply.clearCookie(CSRF_COOKIE, { path: "/" });
}

export function readSessionToken(request: FastifyRequest): string | null {
  const cookie = request.cookies?.[SESSION_COOKIE];
  if (cookie) return cookie;

  const header = request.headers.authorization;
  if (typeof header === "string" && header.startsWith("Bearer ")) {
    return header.slice(7);
  }
  return null;
}

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * Double-submit : le cookie CSRF est lisible par le JS de notre origine mais
 * pas par un site tiers, qui ne peut donc pas reproduire l'en-tête. Ignoré
 * pour les requêtes portant un Bearer explicite, non soumises au CSRF.
 */
export function verifyCsrf(request: FastifyRequest): boolean {
  if (SAFE_METHODS.has(request.method)) return true;
  if (!request.cookies?.[SESSION_COOKIE]) return true;

  const cookieToken = request.cookies?.[CSRF_COOKIE];
  const headerToken = request.headers[CSRF_HEADER];

  if (typeof cookieToken !== "string" || typeof headerToken !== "string") {
    return false;
  }

  const a = Buffer.from(cookieToken);
  const b = Buffer.from(headerToken);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function readSocketToken(handshake: {
  auth?: { token?: unknown };
  headers?: Record<string, unknown>;
}): string | null {
  const authToken = handshake.auth?.token;
  if (typeof authToken === "string" && authToken) return authToken;

  const raw = handshake.headers?.cookie;
  if (typeof raw !== "string") return null;

  for (const part of raw.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === SESSION_COOKIE && rest.length) {
      return decodeURIComponent(rest.join("="));
    }
  }
  return null;
}
