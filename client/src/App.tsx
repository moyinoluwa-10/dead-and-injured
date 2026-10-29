import { useEffect, useState } from "react";
import { ChallengeDialog } from "./components/ChallengeDialog";
import { GameScreen } from "./components/GameScreen";
import { Lobby } from "./components/Lobby";
import { UsernameForm } from "./components/UsernameForm";
import { useSession } from "./useSession";

const STORAGE_KEY = "username";

function readStoredUsername(): string {
  try {
    return localStorage.getItem(STORAGE_KEY)?.trim() ?? "";
  } catch {
    return "";
  }
}

function Session({ username, onChangeName }: { username: string; onChangeName: () => void }) {
  const { connected, myStatus, others, incoming, game, notice, actions } = useSession(username);

  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(actions.dismissNotice, 4000);
    return () => clearTimeout(timer);
  }, [notice, actions.dismissNotice]);

  return (
    <div className="mx-auto flex min-h-screen max-w-5xl flex-col px-4 py-6">
      <header className="mb-8 flex items-center justify-between">
        <h1 className="text-2xl font-extrabold tracking-tight">
          Dead <span className="text-amber-400">&amp;</span> Injured
        </h1>
        <div className="flex items-center gap-3 text-sm text-slate-400">
          <span className="flex items-center gap-2">
            <span className={`h-2 w-2 rounded-full ${connected ? "bg-emerald-400" : "bg-rose-500"}`} />
            {username}
          </span>
          {!game && (
            <button type="button" className="hover:text-white" onClick={onChangeName}>
              Change name
            </button>
          )}
        </div>
      </header>

      {notice && (
        <div
          role="status"
          className="fixed left-1/2 top-4 z-30 -translate-x-1/2 rounded-lg bg-slate-100 px-4 py-2 text-sm font-medium text-slate-900 shadow-lg"
        >
          {notice}
        </div>
      )}

      <main className="flex-1">
        {!connected ? (
          <p className="mt-16 text-center text-slate-400">Connecting to the server…</p>
        ) : game ? (
          <GameScreen
            game={game}
            username={username}
            onReady={actions.ready}
            onGuess={actions.guess}
            onRematch={actions.rematch}
            onLeave={actions.leave}
          />
        ) : (
          <Lobby players={others} myStatus={myStatus} onChallenge={actions.challenge} />
        )}
      </main>

      {incoming[0] && !game && <ChallengeDialog challenger={incoming[0]} onRespond={actions.respond} />}

      <footer className="mt-12 text-center text-sm text-slate-500">
        Made with ♥ by{" "}
        <a className="underline hover:text-slate-300" href="https://twitter.com/t3ch_spawn">
          Boluwatife
        </a>{" "}
        and{" "}
        <a className="underline hover:text-slate-300" href="https://twitter.com/rotii_mii">
          Moyinoluwa
        </a>
      </footer>
    </div>
  );
}

export default function App() {
  const [username, setUsername] = useState(readStoredUsername);

  const save = (name: string) => {
    try {
      localStorage.setItem(STORAGE_KEY, name);
    } catch {
      // Storage can be unavailable (private mode); the name just won't be remembered.
    }
    setUsername(name);
  };

  if (!username) return <UsernameForm onSubmit={save} />;
  return <Session key={username} username={username} onChangeName={() => save("")} />;
}
