import { NextRequest, NextResponse } from "next/server";
import { createToken, COOKIE_NAME, TOKEN_MAX_AGE } from "@/lib/auth";
import { createHmac, timingSafeEqual } from "node:crypto";
import { sql } from "@/lib/db";
import { isSameOrigin } from "@/lib/origin";

export async function POST(request: NextRequest) {
  const password = process.env.SITE_PASSWORD;
  const expectedUsername = process.env.SITE_USERNAME ?? "listener";

  if (!password) {
    return NextResponse.json(
      { error: "Sunucu yapılandırması eksik." },
      { status: 503 },
    );
  }

  if (!isSameOrigin(request)) return NextResponse.json({ error: "Geçersiz kaynak." }, { status: 403 });
  const ip = process.env.VERCEL ? request.headers.get("x-vercel-forwarded-for") ?? "unknown" : "local";
  const key = createHmac("sha256", password).update(ip).digest("hex");
  try {
    const [attempt] = await sql`SELECT public.music_login_allowed(${key}) AS allowed`;
    if (!attempt.allowed) return NextResponse.json({ error: "Çok fazla deneme. 15 dakika sonra tekrar deneyin." }, { status: 429, headers: { "Retry-After": "900" } });
  } catch {
    return NextResponse.json({ error: "Giriş şu anda kullanılamıyor. Biraz sonra deneyin." }, { status: 503 });
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Geçersiz istek." }, { status: 400 });
  }

  if (!body || typeof body !== "object") return NextResponse.json({ error: "Geçersiz istek." }, { status: 400 });
  const { username, password: supplied } = body as Record<string, unknown>;

  if (typeof username !== "string" || typeof supplied !== "string" || !username || !supplied || username.length > 200 || supplied.length > 1024) {
    return NextResponse.json(
      { error: "Kullanıcı adı ve şifre gerekli." },
      { status: 400 },
    );
  }

  const digest = (value: string) => createHmac("sha256", password).update(value).digest();
  if (username !== expectedUsername || !timingSafeEqual(digest(supplied), digest(password))) {
    return NextResponse.json(
      { error: "Kullanıcı adı veya şifre hatalı." },
      { status: 401 },
    );
  }

  const token = await createToken(username, password);
  const response = NextResponse.json({ ok: true });

  response.cookies.set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: TOKEN_MAX_AGE,
  });

  return response;
}
