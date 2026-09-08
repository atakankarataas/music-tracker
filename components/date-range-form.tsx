"use client";
import { useState } from "react";
import { CalendarRange } from "lucide-react";
export function DateRangeForm({ start = "", end = "", className }: { start?: string; end?: string; className?: string }) {
  const [from, setFrom] = useState(start);
  const [to, setTo] = useState(end);
  const invalid = !!from && !!to && from > to;
  return <form className={className} action="/">
    <input name="period" type="hidden" value="custom" />
    <label>From<input name="start" value={from} onChange={(e) => setFrom(e.target.value)} required type="date" max={to || undefined} /></label>
    <label>To<input name="end" value={to} onChange={(e) => setTo(e.target.value)} required type="date" min={from || undefined} /></label>
    <button disabled={invalid} type="submit"><CalendarRange size={15} /> Apply</button>
    {invalid && <p role="alert">Start must be on or before the end.</p>}
  </form>;
}
