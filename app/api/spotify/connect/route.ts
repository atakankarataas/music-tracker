import { NextRequest,NextResponse } from "next/server";
import { randomBytes,createHash } from "node:crypto";
import { seal,STATE_COOKIE,cookieOptions,spotifyScopes } from "@/lib/spotify-web";
export async function GET(request:NextRequest) {
  const redirect=process.env.SPOTIFY_WEB_REDIRECT_URI;
  if (!redirect||!process.env.SPOTIPY_CLIENT_ID||!process.env.SPOTIPY_CLIENT_SECRET||!process.env.SITE_PASSWORD)
    return NextResponse.redirect(new URL("/discover?spotify=setup",request.url));
  const state=randomBytes(24).toString("hex"),verifier=randomBytes(48).toString("base64url");
  const requested=request.nextUrl.searchParams.get("next")||"/discover";
  const next=requested.startsWith("/")&&!requested.startsWith("//")&&!requested.includes("\\")?requested:"/discover";
  const query=new URLSearchParams({response_type:"code",client_id:process.env.SPOTIPY_CLIENT_ID,
    redirect_uri:redirect,scope:spotifyScopes,state,code_challenge_method:"S256",code_challenge:createHash("sha256").update(verifier).digest("base64url")});
  const response=NextResponse.redirect(`https://accounts.spotify.com/authorize?${query}`);
  response.cookies.set(STATE_COOKIE,seal({state,verifier,next,expires:Date.now()+600000}),cookieOptions(600));
  return response;
}
