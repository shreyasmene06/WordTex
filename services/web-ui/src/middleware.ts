import { auth } from "@/lib/auth";
import { NextResponse } from "next/server";
import { SignJWT } from "jose";

const JWT_SECRET = new TextEncoder().encode(
  process.env.JWT_SECRET || "dev-secret-change-in-production"
);

/**
 * Middleware that bridges NextAuth sessions with the Go API gateway's
 * JWT-based auth.  For every `/api/v1/*` request the middleware:
 *   1. Resolves the NextAuth session from the cookie.
 *   2. Mints a short-lived HS256 JWT the gateway can validate.
 *   3. Injects the `Authorization: Bearer <token>` header before
 *      the Next.js rewrite proxies the request to the gateway.
 */
export default auth(async (req) => {
  if (!req.nextUrl.pathname.startsWith("/api/v1/")) {
    return NextResponse.next();
  }

  const session = req.auth;

  // In development, allow unauthenticated API requests through
  // (the gateway will still validate its own JWT if configured)
  if (!session?.user) {
    if (process.env.NODE_ENV === "development") {
      // Mint a dev token so the gateway doesn't reject the request
      const token = await new SignJWT({
        sub: "dev-user",
        email: "dev@wordtex.local",
      })
        .setProtectedHeader({ alg: "HS256" })
        .setIssuedAt()
        .setExpirationTime("1h")
        .sign(JWT_SECRET);

      const requestHeaders = new Headers(req.headers);
      requestHeaders.set("Authorization", `Bearer ${token}`);
      return NextResponse.next({ request: { headers: requestHeaders } });
    }

    return NextResponse.json(
      { error: "Not authenticated" },
      { status: 401 }
    );
  }

  // Mint a gateway-compatible JWT (same secret + expected claims)
  const token = await new SignJWT({
    sub: session.user.id ?? session.user.email ?? "anonymous",
    email: session.user.email ?? "",
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("1h")
    .sign(JWT_SECRET);

  // Clone request headers and inject the bearer token
  const requestHeaders = new Headers(req.headers);
  requestHeaders.set("Authorization", `Bearer ${token}`);

  return NextResponse.next({
    request: { headers: requestHeaders },
  });
});

export const config = {
  matcher: ["/api/v1/:path*"],
};
