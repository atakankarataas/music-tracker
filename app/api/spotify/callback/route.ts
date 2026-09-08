import { NextRequest,NextResponse } from "next/server";
import { unseal,seal,STATE_COOKIE,SPOTIFY_COOKIE,cookieOptions,exchangeToken } from "@/lib/spotify-web";
export async function GET(request:NextRequest) {
  const state=unseal<{state:string;verifier:string;next:string;expires:number}>(request.cookies.get(STATE_COOKIE)?.value||"");
  const code=request.nextUrl.searchParams.get("code");
  let target="/discover?spotify=failed";
  const response=NextResponse.redirect(new URL(state?.next||target,request.url));
  response.cookies.set(STATE_COOKIE,"",cookieOptions(0));
  if (!state||state.expires<Date.now()||state.state!==request.nextUrl.searchParams.get("state")||!code||!process.env.SPOTIFY_WEB_REDIRECT_URI) {
    response.headers.set("Location",new URL(target,request.url).toString());return response;
  }
  try {
    const token=await exchangeToken(new URLSearchParams({grant_type:"authorization_code",code,
      redirect_uri:process.env.SPOTIFY_WEB_REDIRECT_URI,code_verifier:state.verifier}));
    if (!token.refresh_token||!token.scope?.split(" ").includes("playlist-modify-private")) throw new Error("Permission missing");
    response.cookies.set(SPOTIFY_COOKIE,seal({refresh:token.refresh_token,scope:token.scope,expires:Date.now()+30*86400000}),cookieOptions(30*86400));
    target=state.next;
  } catch { /* Keep provider credentials and response bodies out of errors. */ }
  response.headers.set("Location",new URL(target,request.url).toString());return response;
}
