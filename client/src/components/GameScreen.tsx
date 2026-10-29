import { useState } from "react";
import { NUMBER_LENGTH, isValidNumber, randomNumber } from "../../../shared/game";
import type { GameView } from "../../../shared/protocol";
import { DigitInput, emptyDigits, toDigits } from "./DigitInput";
import { GuessHistory } from "./GuessHistory";

interface Props {
  game: GameView;
  username: string;
  onReady: (secret: string) => void;
  onGuess: (guess: string) => void;
  onRematch: () => void;
  onLeave: () => void;
}

const primaryBtn =
  "rounded-lg bg-amber-400 px-5 py-2 font-semibold text-slate-950 enabled:hover:bg-amber-300 disabled:opacity-50";
const secondaryBtn = "rounded-lg border border-slate-700 px-4 py-2 font-medium hover:bg-slate-800";

/** Shown only while the game is in the setup phase, so it remounts with a fresh random number on every rematch. */
function SetupPanel({ game, onReady }: Pick<Props, "game" | "onReady">) {
  const [digits, setDigits] = useState(() => toDigits(randomNumber()));
  const value = digits.join("");
  const complete = value.length === NUMBER_LENGTH;
  const valid = isValidNumber(value);

  if (game.youReady) {
    return (
      <p className="text-center text-slate-300">
        Waiting for {game.opponent.username} to get ready…
      </p>
    );
  }

  return (
    <div className="space-y-4 text-center">
      <p className="text-slate-300">
        Pick your secret number, or keep this random one. {game.opponent.username}{" "}
        {game.opponentReady ? "is ready." : "is picking theirs."}
      </p>
      <DigitInput label="Your secret number" value={digits} onChange={setDigits} />
      <p className={`h-5 text-sm ${complete && !valid ? "text-rose-400" : "text-slate-500"}`}>
        {complete && !valid ? "Every digit must be different" : `${NUMBER_LENGTH} different digits`}
      </p>
      <div className="flex justify-center gap-3">
        <button type="button" className={secondaryBtn} onClick={() => setDigits(toDigits(randomNumber()))}>
          Random
        </button>
        <button type="button" disabled={!valid} className={primaryBtn} onClick={() => onReady(value)}>
          Ready
        </button>
      </div>
    </div>
  );
}

function PlayPanel({ game, onGuess }: Pick<Props, "game" | "onGuess">) {
  const [digits, setDigits] = useState(emptyDigits);
  const value = digits.join("");
  const valid = isValidNumber(value);
  const complete = value.length === NUMBER_LENGTH;

  const submit = () => {
    if (!valid || !game.yourTurn) return;
    onGuess(value);
    setDigits(emptyDigits());
  };

  return (
    <div className="space-y-4 text-center">
      <p
        className={`text-lg font-semibold ${game.yourTurn ? "text-amber-300" : "text-slate-400"}`}
        aria-live="polite"
      >
        {game.yourTurn ? "Your turn" : `${game.opponent.username}'s turn`}
      </p>
      <DigitInput
        label="Your guess"
        value={digits}
        onChange={setDigits}
        onSubmit={submit}
        disabled={!game.yourTurn}
        autoFocus
      />
      <p className={`h-5 text-sm ${complete && !valid ? "text-rose-400" : "text-slate-500"}`}>
        {complete && !valid ? "Every digit must be different" : ""}
      </p>
      <button type="button" disabled={!game.yourTurn || !valid} className={primaryBtn} onClick={submit}>
        {game.yourTurn ? "Guess!" : "Wait!"}
      </button>
    </div>
  );
}

function FinishedPanel({ game, onRematch, onLeave }: Pick<Props, "game" | "onRematch" | "onLeave">) {
  const won = game.winner === "you";
  return (
    <div className="space-y-4 text-center">
      <p className={`text-3xl font-extrabold ${won ? "text-emerald-400" : "text-rose-400"}`}>
        {won ? "You win!" : "You lose!"}
      </p>
      <p className="text-slate-300">
        {won
          ? `You cracked ${game.opponent.username}'s number.`
          : `${game.opponent.username} cracked your number.`}
      </p>
      <div className="flex justify-center gap-3">
        <button type="button" className={secondaryBtn} onClick={onLeave}>
          Back to lobby
        </button>
        <button type="button" disabled={game.youWantRematch} className={primaryBtn} onClick={onRematch}>
          {game.youWantRematch ? "Waiting for opponent…" : "Rematch"}
        </button>
      </div>
      {game.opponentWantsRematch && !game.youWantRematch && (
        <p className="text-sm text-amber-300">{game.opponent.username} wants a rematch.</p>
      )}
    </div>
  );
}

export function GameScreen({ game, username, onReady, onGuess, onRematch, onLeave }: Props) {
  // Remembered locally so the player can see their own number while playing.
  const [mySecret, setMySecret] = useState<string | null>(null);

  const handleReady = (secret: string) => {
    setMySecret(secret);
    onReady(secret);
  };

  return (
    <div className="mx-auto w-full max-w-4xl space-y-6">
      <div className="flex items-center justify-between rounded-xl border border-slate-800 bg-slate-900/60 px-4 py-3">
        <p className="font-semibold">
          {username} <span className="text-slate-500">vs</span> {game.opponent.username}
        </p>
        {game.phase !== "finished" && (
          <button type="button" className="text-sm text-slate-400 hover:text-white" onClick={onLeave}>
            Leave game
          </button>
        )}
      </div>

      {game.youReady && mySecret && (
        <p className="text-center text-sm text-slate-400">
          Your number: <span className="font-mono text-lg tracking-widest text-white">{mySecret}</span>
        </p>
      )}

      <div className="rounded-2xl border border-slate-800 bg-slate-900 p-6">
        {game.phase === "setup" && <SetupPanel game={game} onReady={handleReady} />}
        {game.phase === "playing" && <PlayPanel game={game} onGuess={onGuess} />}
        {game.phase === "finished" && (
          <FinishedPanel game={game} onRematch={onRematch} onLeave={onLeave} />
        )}
      </div>

      {game.phase !== "setup" && (
        <div className="grid gap-4 md:grid-cols-2">
          <GuessHistory
            title="Your guesses"
            guesses={game.yourGuesses}
            emptyText={`Your guesses at ${game.opponent.username}'s number will show up here.`}
          />
          <GuessHistory
            title={`${game.opponent.username}'s guesses`}
            guesses={game.opponentGuesses}
            emptyText="Nothing yet."
          />
        </div>
      )}
    </div>
  );
}
