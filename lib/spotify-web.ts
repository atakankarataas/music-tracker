import "server-only";
import { cookies } from "next/headers";
import { createCipheriv,createDecipheriv,createHash,randomBytes } from "node:crypto";
export const SPOTIFY_COOKIE="spotify-connection";
export const STATE_COOKIE="spotify-connect-state";
export const spotifyScopes="playlist-modify-private user-read-currently-playing user-read-recently-played";
export function seal(value:unknown) {
  if (!process.env.SITE_PASSWORD) throw new Error("Private access must be configured");
  const key=createHash("sha256").update(process.env.SITE_PASSWORD).digest();
  const iv=randomBytes(12);
  const cipher=createCipheriv("aes-256-gcm",key,iv);
  const encrypted=Buffer.concat([cipher.update(JSON.stringify(value),"utf8"),cipher.final()]);
  return Buffer.concat([iv,encrypted,cipher.getAuthTag()]).toString("base64url");
}
export function unseal<T>(value:string):T|null {
  try {
    if (!process.env.SITE_PASSWORD||value.length>6000) return null;
    const bytes=Buffer.from(value,"base64url");
    const key=createHash("sha256").update(process.env.SITE_PASSWORD).digest();
    const cipher=createDecipheriv("aes-256-gcm",key,bytes.subarray(0,12));
    cipher.setAuthTag(bytes.subarray(-16));
    return JSON.parse(Buffer.concat([cipher.update(bytes.subarray(12,-16)),cipher.final()]).toString("utf8")) as T;
  } catch {return null;}
}
export async function exchangeToken(body:URLSearchParams) {
  const response=await fetch("https://accounts.spotify.com/api/token",{
    method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded",Authorization:`Basic ${Buffer.from(`${process.env.SPOTIPY_CLIENT_ID}:${process.env.SPOTIPY_CLIENT_SECRET}`).toString("base64")}`},
    body,cache:"no-store",signal:AbortSignal.timeout(10000),
  });
  if (!response.ok) throw new Error("Spotify connection expired. Connect again.");
  return await response.json() as {access_token:string;refresh_token?:string;scope?:string;expires_in:number};
}
export type SpotifyConnection={refresh:string;scope:string;expires:number};
export async function playlistToken() {
  const jar=await cookies();
  const value=jar.get(SPOTIFY_COOKIE)?.value;
  const connection=value?unseal<SpotifyConnection>(value):null;
  if (!connection||connection.expires<Date.now()||!connection.scope.split(" ").includes("playlist-modify-private")) return null;
  const token=await exchangeToken(new URLSearchParams({grant_type:"refresh_token",refresh_token:connection.refresh}));
  if (token.refresh_token) jar.set(SPOTIFY_COOKIE,seal({...connection,refresh:token.refresh_token}),cookieOptions(30*86400));
  return token.access_token;
}
export function cookieOptions(maxAge:number) {
  return {httpOnly:true,secure:process.env.NODE_ENV==="production",sameSite:"lax" as const,path:"/",maxAge};
}
export async function spotifyFetch(token:string,path:string,body:unknown,method="POST") {
  const response=await fetch(`https://api.spotify.com/v1${path}`,{method,headers:{Authorization:`Bearer ${token}`,"Content-Type":"application/json"},body:JSON.stringify(body),cache:"no-store",signal:AbortSignal.timeout(10000)});
  return response;
}
