import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { getAuthConfig } from "@/lib/config";

export const SESSION_COOKIE = "fantasy_session";
const SESSION_DURATION_SECONDS = 60 * 60 * 24 * 14;

const encode = (value: string) => Buffer.from(value).toString("base64url");

const sign = (payload: string, secret: string) =>
  createHmac("sha256", secret).update(payload).digest("base64url");

export const safeEqual = (left: string, right: string) => {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  if (leftBuffer.length !== rightBuffer.length) return false;
  return timingSafeEqual(leftBuffer, rightBuffer);
};

export type SessionRole = "admin" | "member";
export interface Session { version: 2; role: SessionRole; exp: number }

export const createSessionToken = (role: SessionRole) => {
  const { sessionSecret } = getAuthConfig();
  const payload = encode(
    JSON.stringify({ version: 2, role, exp: Math.floor(Date.now() / 1000) + SESSION_DURATION_SECONDS }),
  );
  return `${payload}.${sign(payload, sessionSecret)}`;
};

export const readSessionToken = (token: string | undefined): Session | null => {
  if (!token) return null;
  try {
    const parts = token.split(".");
    if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
    const [payload, signature] = parts;
    const config = getAuthConfig();
    if (!safeEqual(signature, sign(payload, config.sessionSecret))) return null;
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Partial<Session>;
    if (parsed.version !== 2 || !["admin", "member"].includes(parsed.role ?? "") || typeof parsed.exp !== "number" || !Number.isFinite(parsed.exp) || parsed.exp <= Date.now() / 1000) return null;
    if (parsed.role === "member" && !config.memberPassword) return null;
    return { version: 2, role: parsed.role as SessionRole, exp: parsed.exp };
  } catch { return null; }
};
export const verifySessionToken = (token: string | undefined) => readSessionToken(token) !== null;

export const getRequestSession = (request: Request): Session | null => {
  const rawCookie = request.headers.get("cookie") ?? "";
  const token = rawCookie.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${SESSION_COOKIE}=`))?.slice(SESSION_COOKIE.length + 1);
  return readSessionToken(token);
};
export const isRequestAuthenticated = (request: Request) => getRequestSession(request) !== null;
export const isPageAuthenticated = async () => {
  const cookieStore = await cookies();
  return verifySessionToken(cookieStore.get(SESSION_COOKIE)?.value);
};

export const sessionCookieOptions = {
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  path: "/",
  maxAge: SESSION_DURATION_SECONDS,
};
