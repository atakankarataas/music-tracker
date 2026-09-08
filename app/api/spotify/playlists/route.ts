import { NextRequest,NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { sql } from "@/lib/db";
import { isSameOrigin } from "@/lib/origin";
import { playlistToken,spotifyFetch } from "@/lib/spotify-web";
export async function POST(request:NextRequest) {
  if (!isSameOrigin(request)) return NextResponse.json({error:"Invalid origin"},{status:403});
  const data=await request.json().catch(()=>null);
  if (!data||typeof data.name!=="string"||data.name.length>100||!Array.isArray(data.ids)||!data.ids.length||data.ids.length>100
    ||!data.ids.every((id:unknown)=>typeof id==="string"&&/^[A-Za-z0-9]{22}$/.test(id))
    ||typeof data.requestId!=="string"||!/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(data.requestId))
    return NextResponse.json({error:"Invalid playlist selection"},{status:400});
  let token:string|null;
  try {token=await playlistToken();} catch {token=null;}
  if (!token) return NextResponse.json({error:"Connect Spotify to allow private playlist creation.",connect:true},{status:401});
  const ids=[...new Set<string>(data.ids)];
  const fingerprint=createHash("sha256").update(JSON.stringify({name:data.name,ids})).digest("hex");
  const [existing]=await sql`SELECT * FROM public.music_playlist_exports WHERE request_id=${data.requestId}`;
  if (existing) {
    if (existing.fingerprint!==fingerprint) return NextResponse.json({error:"Selection changed. Reload and preview again."},{status:409});
    if (existing.status==="complete") return NextResponse.json({url:existing.url});
    return NextResponse.json({error:"This attempt already started. Check Spotify before creating another playlist.",url:existing.url},{status:409});
  }
  const reservation=await sql`INSERT INTO public.music_playlist_exports(request_id,fingerprint,status)
    VALUES (${data.requestId},${fingerprint},'creating') ON CONFLICT DO NOTHING RETURNING request_id`;
  if (!reservation.length) return NextResponse.json({error:"Playlist creation is already in progress."},{status:409});
  try {
    const created=await spotifyFetch(token,"/me/playlists",{name:data.name,public:false,description:"A personal selection from atakan.fm"});
    if (!created.ok) throw new Error("Create failed");
    const playlist=await created.json() as {id:string};
    if (!/^[A-Za-z0-9]{22}$/.test(playlist.id)) throw new Error("Invalid response");
    const url=`https://open.spotify.com/playlist/${playlist.id}`;
    await sql`UPDATE public.music_playlist_exports SET status='adding',spotify_id=${playlist.id},url=${url} WHERE request_id=${data.requestId}`;
    const added=await spotifyFetch(token,`/playlists/${playlist.id}/items`,{uris:ids.map(id=>`spotify:track:${id}`)});
    if (!added.ok) throw new Error("Adding tracks failed");
    await sql`UPDATE public.music_playlist_exports SET status='complete' WHERE request_id=${data.requestId}`;
    return NextResponse.json({url});
  } catch {
    await sql`UPDATE public.music_playlist_exports SET status='failed' WHERE request_id=${data.requestId}`;
    return NextResponse.json({error:"Spotify could not complete this request. Check your Spotify playlists before trying again."},{status:502});
  }
}
