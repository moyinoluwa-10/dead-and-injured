import { useState } from "react";
import { ROOM_CODE_LENGTH, type PlayerInfo, type PlayerStatus } from "../../../shared/protocol";

interface Props {
  players: PlayerInfo[];
  myStatus: PlayerStatus;
  roomCode: string | null;
  onChallenge: (id: string) => void;
  onPlayComputer: () => void;
  onCreateRoom: () => void;
  onCancelRoom: () => void;
  onJoinRoom: (code: string) => void;
}

const statusLabel: Record<PlayerStatus, string> = {
  available: "Available",
  pending: "Waiting for reply",
  hosting: "Hosting a room",
  playing: "In a game",
};

const statusColor: Record<PlayerStatus, string> = {
  available: "bg-emerald-400",
  pending: "bg-amber-400",
  hosting: "bg-amber-400",
  playing: "bg-slate-500",
};

const secondaryBtn =
  "rounded-lg border border-slate-700 px-4 py-2 text-sm font-medium enabled:hover:bg-slate-800 disabled:opacity-50";

function RoomPanel({ code, onCancel }: { code: string; onCancel: () => void }) {
  const [copied, setCopied] = useState(false);
  const link = `${location.origin}/?room=${code}`;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      window.prompt("Copy this link and send it to your friend:", link);
    }
  };

  return (
    <div className="rounded-xl border border-amber-400/40 bg-slate-900 p-4 text-center">
      <p className="text-sm text-slate-400">Your private room code</p>
      <p className="my-1 font-mono text-4xl font-extrabold tracking-[0.3em] text-amber-300">{code}</p>
      <p className="text-sm text-slate-400">Waiting for a friend to join…</p>
      <div className="mt-3 flex justify-center gap-2">
        <button type="button" className={secondaryBtn} onClick={copy}>
          {copied ? "Copied!" : "Copy invite link"}
        </button>
        <button type="button" className={secondaryBtn} onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}

export function Lobby({
  players,
  myStatus,
  roomCode,
  onChallenge,
  onPlayComputer,
  onCreateRoom,
  onCancelRoom,
  onJoinRoom,
}: Props) {
  const [code, setCode] = useState("");
  const iAmFree = myStatus === "available";

  return (
    <section className="mx-auto w-full max-w-md space-y-8">
      <div className="space-y-3">
        {roomCode ? (
          <RoomPanel code={roomCode} onCancel={onCancelRoom} />
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                disabled={!iAmFree}
                onClick={onPlayComputer}
                className="rounded-xl bg-amber-400 px-4 py-3 font-semibold text-slate-950 enabled:hover:bg-amber-300 disabled:opacity-50"
              >
                Play the computer
              </button>
              <button
                type="button"
                disabled={!iAmFree}
                onClick={onCreateRoom}
                className="rounded-xl border border-slate-700 px-4 py-3 font-semibold enabled:hover:bg-slate-800 disabled:opacity-50"
              >
                Create private room
              </button>
            </div>
            <form
              className="flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                if (code.length === ROOM_CODE_LENGTH) onJoinRoom(code);
              }}
            >
              <input
                value={code}
                onChange={(e) =>
                  setCode(e.target.value.replace(/[^a-z]/gi, "").toUpperCase().slice(0, ROOM_CODE_LENGTH))
                }
                placeholder="Room code"
                aria-label="Room code"
                autoCapitalize="characters"
                className="min-w-0 flex-1 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 font-mono uppercase tracking-widest outline-none focus:border-amber-400"
              />
              <button type="submit" disabled={!iAmFree || code.length !== ROOM_CODE_LENGTH} className={secondaryBtn}>
                Join
              </button>
            </form>
          </>
        )}
      </div>

      <div>
        <h2 className="mb-1 text-xl font-bold">Players online</h2>
        <p className="mb-4 text-sm text-slate-400">
          {myStatus === "pending"
            ? "Waiting for your opponent to answer…"
            : "Pick someone to challenge to a game."}
        </p>

        {players.length === 0 ? (
          <div className="rounded-xl border border-dashed border-slate-700 p-8 text-center text-slate-400">
            Nobody else is here yet. Play the computer, or create a private room and send the link to a
            friend.
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
      </div>
    </section>
  );
}
