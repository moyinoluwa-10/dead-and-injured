import { useEffect, useRef, useState } from "react";
import { ChallengeDialog } from "./components/ChallengeDialog";
import { GameScreen } from "./components/GameScreen";
import { HowToPlay } from "./components/HowToPlay";
import { Lobby } from "./components/Lobby";
import { UsernameForm } from "./components/UsernameForm";
import { useTurnAlerts } from "./useGameEffects";
import { useSession } from "./useSession";

const USERNAME_KEY = "username";
const MUTED_KEY = "muted";
const SEEN_RULES_KEY = "seen-rules";

function readStorage(key: string): string {
  try {
    return localStorage.getItem(key) ?? "";
  } catch {
    return "";
  }
}

function writeStorage(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Storage can be unavailable (private mode); the preference just won't be remembered.
  }
}

function Session({
  username,
  onChangeName,
  inviteCode,
}: {
  username: string;
  onChangeName: () => void;
  /** Room code from an invite link, joined once connected. */
  inviteCode: React.RefObject<string | null>;
}) {
  const {
    connected,
    refused,
    displayName,
    myStatus,
    others,
    incoming,
    game,
    roomCode,
    notice,
    actions,
  } = useSession(username);
  const [muted, setMuted] = useState(() => readStorage(MUTED_KEY) === "1");
  const [showRules, setShowRules] = useState(
    () => readStorage(SEEN_RULES_KEY) !== "1",
  );
  const everConnected = useRef(false);
  if (connected) everConnected.current = true;

  useTurnAlerts(game?.yourTurn ?? false, muted);

  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(actions.dismissNotice, 4000);
    return () => clearTimeout(timer);
  }, [notice, actions.dismissNotice]);

  // Join the room from an invite link (?room=ABCD) as soon as we're online.
  useEffect(() => {
    if (!connected || !inviteCode.current) return;
    actions.joinRoom(inviteCode.current);
    inviteCode.current = null;
    history.replaceState(null, "", location.pathname);
  }, [connected, inviteCode, actions]);

  const closeRules = () => {
    writeStorage(SEEN_RULES_KEY, "1");
    setShowRules(false);
  };

  const toggleMuted = () => {
    writeStorage(MUTED_KEY, muted ? "0" : "1");
    setMuted(!muted);
  };

  return (
    <div className="mx-auto flex min-h-screen max-w-5xl flex-col px-4 py-6">
      <header className="mb-8 flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-extrabold tracking-tight">
          Dead <span className="text-amber-400">&amp;</span> Injured
        </h1>
        <div className="flex items-center gap-4 text-sm text-slate-400">
          <span className="flex items-center gap-2">
            <span
              className={`h-2 w-2 rounded-full ${connected ? "bg-emerald-400" : "bg-rose-500"}`}
            />
            {displayName ?? username}
          </span>
          <button
            type="button"
            className="hover:text-white"
            onClick={() => setShowRules(true)}
          >
            How to play
          </button>
          <button
            type="button"
            className="hover:text-white"
            aria-pressed={muted}
            onClick={toggleMuted}
          >
            {muted ? "Sound off" : "Sound on"}
          </button>
          {!game && (
            <button
              type="button"
              className="hover:text-white"
              onClick={onChangeName}
            >
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

      {!connected && everConnected.current && (
        <p
          role="status"
          className="mb-4 rounded-lg bg-rose-500/10 px-4 py-2 text-center text-sm text-rose-300"
        >
          Connection lost. Reconnecting…
        </p>
      )}

      <main className="flex-1">
        {game ? (
          <GameScreen
            game={game}
            username={displayName ?? username}
            onReady={actions.ready}
            onGuess={actions.guess}
            onRematch={actions.rematch}
            onLeave={actions.leave}
          />
        ) : refused && !connected ? (
          <div role="alert" className="mx-auto mt-16 max-w-sm space-y-4 text-center">
            <p className="text-slate-300">Couldn't join: {refused}.</p>
            <button
              type="button"
              onClick={() => location.reload()}
              className="rounded-lg bg-amber-400 px-5 py-2 font-semibold text-slate-950 hover:bg-amber-300"
            >
              Try again
            </button>
          </div>
        ) : !connected && !everConnected.current ? (
          <p className="mt-16 text-center text-slate-400">
            Connecting to the server…
          </p>
        ) : (
          <Lobby
            players={others}
            myStatus={myStatus}
            roomCode={roomCode}
            onChallenge={actions.challenge}
            onCancelChallenge={actions.cancelChallenge}
            onPlayComputer={actions.playComputer}
            onCreateRoom={actions.createRoom}
            onCancelRoom={actions.cancelRoom}
            onJoinRoom={actions.joinRoom}
          />
        )}
      </main>

      {incoming[0] && !game && !showRules && (
        <ChallengeDialog challenger={incoming[0]} onRespond={actions.respond} />
      )}
      {showRules && <HowToPlay onClose={closeRules} />}

      <footer className="mt-12 text-center text-sm text-slate-500">
        Made with ♥ by{" "}
        <a
          className="underline hover:text-slate-300"
          href="https://twitter.com/t3ch_spawn"
        >
          Boluwatife
        </a>{" "}
        and{" "}
        <a
          className="underline hover:text-slate-300"
          href="https://twitter.com/moyinadelowo"
        >
          Moyinoluwa
        </a>
      </footer>
    </div>
  );
}

export default function App() {
  const [username, setUsername] = useState(() =>
    readStorage(USERNAME_KEY).trim(),
  );
  const inviteCode = useRef<string | null>(
    new URLSearchParams(location.search).get("room"),
  );

  const save = (name: string) => {
    writeStorage(USERNAME_KEY, name);
    setUsername(name);
  };

  if (!username) return <UsernameForm onSubmit={save} />;
  return (
    <Session
      key={username}
      username={username}
      onChangeName={() => save("")}
      inviteCode={inviteCode}
    />
  );
}

