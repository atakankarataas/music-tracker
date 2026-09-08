"use client";
import { useState } from "react";
import type { EntityItem } from "@/lib/data";
export function PlaylistExport({ items,name }: { items:EntityItem[];name:string }) {
  const [status,setStatus]=useState("");
  const [busy,setBusy]=useState(false);
  const [url,setUrl]=useState("");
  const [connect,setConnect]=useState(false);
  const [requestId,setRequestId]=useState("");
  const tracks=items.filter(item=>item.id && /^[A-Za-z0-9]{22}$/.test(item.id));
  if (!tracks.length) return null;
  return <details className="playlist-export"><summary>Make a Spotify playlist · {tracks.length} tracks</summary>
    <p>Create a private playlist named <strong>{name}</strong> with the tracks shown above.</p>
    <button type="button" disabled={busy||!!url} onClick={async()=>{
      setBusy(true);setStatus("");setConnect(false);
      const id=requestId||crypto.randomUUID();setRequestId(id);
      try {
        const response=await fetch("/api/spotify/playlists",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({name,ids:tracks.map(t=>t.id),requestId:id})});
        const result=await response.json();
        if (response.ok) {setUrl(result.url);setStatus("Your private playlist is ready.");}
        else {setStatus(result.error||"Could not create playlist.");setConnect(!!result.connect);}
      } catch {setStatus("Connection interrupted. Check Spotify before trying again.");}
      finally {setBusy(false);}
    }}>{busy?"Creating…":url?"Created":"Create private playlist"}</button>
    {connect&&<a className="quiet-link" href={`/api/spotify/connect?next=${encodeURIComponent(typeof window!=="undefined"?window.location.pathname+window.location.search:"/discover")}`}>Connect Spotify ↗</a>}
    {url&&<a className="quiet-link" href={url} target="_blank" rel="noreferrer">Open in Spotify ↗</a>}
    <p role="status">{status}</p>
  </details>;
}
