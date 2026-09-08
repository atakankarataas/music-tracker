import "server-only";
import type { NextRequest } from "next/server";

/**
 * Reject cross-site posts by comparing the browser's Origin with the host it
 * actually addressed.
 *
 * `request.nextUrl.origin` cannot be used for this. Under `next start` it
 * reports `http://localhost:3000` even when the request arrived at
 * `127.0.0.1:3000`, so a legitimate sign-in from the address the user typed was
 * answered with 403. The forwarded host is the value the browser resolved, so
 * that is what the Origin has to agree with.
 *
 * A missing Origin is allowed: browsers always send it on the cross-site posts
 * this guards against, so its absence means the request is not one of them.
 */
export function isSameOrigin(request: NextRequest) {
  const origin = request.headers.get("origin");
  if (!origin) return true;

  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  if (!host) return false;

  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}
