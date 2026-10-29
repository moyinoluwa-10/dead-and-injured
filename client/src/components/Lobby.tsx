import type { PlayerInfo, PlayerStatus } from "../../../shared/protocol";

interface Props {
  players: PlayerInfo[];
  myStatus: PlayerStatus;
  onChallenge: (id: string) => void;
}

const statusLabel: Record<PlayerStatus, string> = {
  available: "Available",
  pending: "Waiting for reply",
  playing: "In a game",
};

const statusColor: Record<PlayerStatus, string> = {
  available: "bg-emerald-400",
  pending: "bg-amber-400",
  playing: "bg-slate-500",
};

export function Lobby({ players, myStatus, onChallenge }: Props) {
  const iAmFree = myStatus === "available";

  return (
    <section className="mx-auto w-full max-w-md">
      <h2 className="mb-1 text-xl font-bold">Players online</h2>
      <p className="mb-4 text-sm text-slate-400">
        {myStatus === "pending"
          ? "Waiting for your opponent to answer…"
          : "Pick someone to challenge to a game."}
      </p>

      {players.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-700 p-8 text-center text-slate-400">
          Nobody else is here yet. Open the game in a second tab or send the link to a friend.
        </div>
      ) : (
        <ul className="space-y-2">
          {players.map((p) => (
            <li key={p.id}>
              <button
                type="button"
                disabled={!iAmFree || p.status !== "available"}
                onClick={() => onChallenge(p.id)}
                className="flex w-full items-center justify-between rounded-xl border border-slate-800 bg-slate-900 px-4 py-3 text-left transition enabled:hover:border-amber-400 disabled:cursor-not-allowed disabled:opacity-60"
              >
                <span className="font-medium">{p.username}</span>
                <span className="flex items-center gap-2 text-sm text-slate-400">
                  <span className={`h-2 w-2 rounded-full ${statusColor[p.status]}`} />
                  {statusLabel[p.status]}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
