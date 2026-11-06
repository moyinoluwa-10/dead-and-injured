import { useEffect, useState } from "react";

interface Entry {
  username: string;
  wins: number;
  losses: number;
  games: number;
}

/** Top players. Renders nothing when the server has no database or nobody has played yet. */
export function Leaderboard() {
  const [leaders, setLeaders] = useState<Entry[]>([]);

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/leaderboard", { signal: controller.signal })
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { enabled: boolean; leaders: Entry[] } | null) => {
        if (data?.enabled) setLeaders(data.leaders);
      })
      .catch(() => {
        // The leaderboard is optional; stay hidden if it can't load.
      });
    return () => controller.abort();
  }, []);

  if (leaders.length === 0) return null;

  return (
    <section>
      <h2 className="mb-3 text-xl font-bold">Leaderboard</h2>
      <ol className="space-y-2">
        {leaders.map((p, i) => (
          <li
            key={p.username}
            className="flex items-center justify-between rounded-xl border border-slate-800 bg-slate-900 px-4 py-2"
          >
            <span className="flex items-center gap-3">
              <span className="w-5 text-right font-mono text-sm text-slate-500">{i + 1}</span>
              <span className="font-medium">{p.username}</span>
            </span>
            <span className="text-sm text-slate-400">
              <span className="font-semibold text-emerald-400">{p.wins}W</span>{" "}
              <span className="font-semibold text-rose-400">{p.losses}L</span>
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}
