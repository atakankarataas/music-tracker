"use client";

import { AlertCircle } from "lucide-react";

export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="error-state">
      <AlertCircle aria-hidden="true" size={24} strokeWidth={1.5} />
      <h1>Something went wrong</h1>
      <p>The listening archive could not be loaded. Your play history is safe — this is only a problem reading it.</p>
      <button onClick={reset} type="button">Try again</button>
    </div>
  );
}
