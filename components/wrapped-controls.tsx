"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";

export function WrappedControls({ year, years, className }: {
  year: number;
  years: number[];
  className: string;
}) {
  const router = useRouter();
  const [selected, setSelected] = useState(year);
  const [pending, startTransition] = useTransition();

  return <div className={className} aria-busy={pending}>
    <label htmlFor="wrapped-year">Your year</label>
    <select id="wrapped-year" value={selected} disabled={pending} onChange={event => {
      const nextYear = Number(event.target.value);
      setSelected(nextYear);
      startTransition(() => router.push(`/wrapped?year=${nextYear}`));
    }}>
      {!years.includes(year) && <option value={year}>{year}</option>}
      {years.map(value => <option key={value} value={value}>{value}</option>)}
    </select>
    <button type="button" disabled={pending} onClick={() => startTransition(() => router.refresh())}>
      <RefreshCw size={13} aria-hidden="true" />
      <span role="status">{pending ? "Loading…" : "Refresh"}</span>
    </button>
  </div>;
}
