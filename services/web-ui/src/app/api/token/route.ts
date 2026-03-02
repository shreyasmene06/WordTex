import { auth } from "@/lib/auth";
import { SignJWT } from "jose";
import { NextResponse } from "next/server";

const JWT_SECRET = new TextEncoder().encode(
  process.env.JWT_SECRET || "dev-secret-change-in-production"
);

/**
 * Returns a short-lived gateway JWT for the current NextAuth session.
 *
 * This is used by the client for paths that can't go through Next.js
 * middleware (e.g. raw WebSocket connections to the gateway).
 */
export async function GET() {
  const session = await auth();

  if (!session?.user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const token = await new SignJWT({
    sub: session.user.id ?? session.user.email ?? "anonymous",
    email: session.user.email ?? "",
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("1h")
    .sign(JWT_SECRET);

  return NextResponse.json({ token });
}
