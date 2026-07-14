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

export const createSessionToken = () => {
  const { sessionSecret } = getAuthConfig();
  const payload = encode(
    JSON.stringify({ exp: Math.floor(Date.now() / 1000) + SESSION_DURATION_SECONDS }),
  );
  return `${payload}.${sign(payload, sessionSecret)}`;
};

export const verifySessionToken = (token: string | undefined) => {
  if (!token) return false;
  try {
    const [payload, signature] = token.split(".");
    if (!payload || !signature) return false;
    const { sessionSecret } = getAuthConfig();
    if (!safeEqual(signature, sign(payload, sessionSecret))) return false;
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as {
      exp?: number;
    };
    return typeof parsed.exp === "number" && parsed.exp > Date.now() / 1000;
  } catch {
    return false;
  }
};

export const isRequestAuthenticated = (request: Request) => {
  const rawCookie = request.headers.get("cookie") ?? "";
  const token = rawCookie
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${SESSION_COOKIE}=`))
    ?.slice(SESSION_COOKIE.length + 1);
  return verifySessionToken(token);
};

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
