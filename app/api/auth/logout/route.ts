import { NextRequest, NextResponse } from "next/server";
import { COOKIE_NAME } from "@/lib/auth";

export async function POST(request: NextRequest) {
  const response = NextResponse.redirect(
    new URL("/login", request.url), 303
  );

  response.cookies.set(COOKIE_NAME, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });

  response.cookies.set("spotify-connection", "", { path: "/", maxAge: 0 });
  response.cookies.set("spotify-connect-state", "", { path: "/", maxAge: 0 });
  return response;
}
