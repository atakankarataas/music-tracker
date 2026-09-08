import { NextRequest, NextResponse } from "next/server";
import { verifyToken, COOKIE_NAME } from "@/lib/auth";

export async function middleware(request: NextRequest) {
  const password = process.env.SITE_PASSWORD;

  const uncachedResponse = () => {
    const response = NextResponse.next();
    response.headers.set("Cache-Control", "private, no-store, max-age=0, must-revalidate");
    return response;
  };

  // No password configured → open access
  if (!password) {
    if (process.env.VERCEL) {
      return new NextResponse("Private site access has not been configured", {
        status: 503,
        headers: { "Cache-Control": "no-store" },
      });
    }
    return uncachedResponse();
  }

  const token = request.cookies.get(COOKIE_NAME)?.value;
  if (token && (await verifyToken(token, password))) {
    return uncachedResponse();
  }

  // Not authenticated → redirect to login
  const loginUrl = new URL("/login", request.url);
  if (request.nextUrl.pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Please sign in again." }, { status: 401 });
  }
  loginUrl.searchParams.set("next", request.nextUrl.pathname + request.nextUrl.search);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: [
    "/((?!login(?:/|$)|api/auth/(?:login|logout)(?:/|$)|api/health$|_next/static|_next/image|favicon\\.ico|icon\\.svg|apple-icon\\.png).*)",
  ],
};
