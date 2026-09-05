"use client";

import { useEffect, useState } from "react";

export default function Home() {
  const [health, setHealth] = useState<string>("checking...");

  useEffect(() => {
    fetch("http://localhost:3001/health")
      .then((r) => r.json())
      .then((d) => setHealth(JSON.stringify(d)))
      .catch(() => setHealth("API unreachable"));
  }, []);

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 bg-slate-950 text-white">
      <h1 className="text-4xl font-bold tracking-tight">GeoLens</h1>
      <p className="text-slate-400">AI Visibility Intelligence</p>
      <p className="mt-4 rounded-md border border-emerald-500/30 bg-emerald-500/10 px-4 py-2 font-mono text-sm text-emerald-400">
        API /health → {health}
      </p>
    </main>
  );
}
