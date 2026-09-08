"use client";
import { useState } from "react";
export function PeriodNote({ month, initial }: { month: string; initial: string }) {
  const [body,setBody] = useState(initial);
  const [notice,setNotice] = useState("");
  const [busy,setBusy] = useState(false);
  return <form onSubmit={async (event) => {
    event.preventDefault(); setBusy(true);setNotice("");
    try {
      const response=await fetch("/api/notes",{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify({month,body})});
      setNotice(response.ok ? "Note saved." : "Could not save. Please try again.");
    } catch { setNotice("Connection interrupted. Your text is still here."); }
    finally {setBusy(false);}
  }} className="period-note">
    <label htmlFor="period-note">What did this month sound like?</label>
    <textarea id="period-note" value={body} onChange={(event)=>setBody(event.target.value)} maxLength={4000} rows={4} placeholder="A place, a memory, an album you lived with…" />
    <button type="submit" disabled={busy}>{busy ? "Saving…" : "Save note"}</button>
    <span role="status">{notice}</span>
  </form>;
}
