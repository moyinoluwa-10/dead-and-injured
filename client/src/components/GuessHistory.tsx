import { NUMBER_LENGTH } from "../../../shared/game";
import type { GuessResult } from "../../../shared/protocol";

interface Props {
  title: string;
  guesses: GuessResult[];
  emptyText: string;
}

/** One pip per digit: filled rose = dead, amber ring = injured, grey = miss. */
function Pips({ dead, injured }: { dead: number; injured: number }) {
  return (
    <span className="flex gap-1" aria-hidden="true">
      {Array.from({ length: NUMBER_LENGTH }, (_, i) => {
        const style =
          i < dead
            ? "bg-rose-500 border-rose-500"
            : i < dead + injured
              ? "border-amber-300 bg-transparent"
              : "border-slate-700 bg-slate-800";
        return <span key={i} className={`h-3 w-3 rounded-full border-2 ${style}`} />;
      })}
    </span>
  );
}

export function GuessHistory({ title, guesses, emptyText }: Props) {
  return (
    <section className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
      <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-400">{title}</h3>
      {guesses.length === 0 ? (
        <p className="text-sm text-slate-500">{emptyText}</p>
      ) : (
        <ol className="space-y-2">
          {guesses.map((g, i) => (
            <li
              key={i}
              className={`flex items-center justify-between gap-3 rounded-lg px-3 py-2 ${
                g.dead === NUMBER_LENGTH ? "bg-emerald-500/20" : "bg-slate-800/70"
              }`}
            >
              <span className="font-mono text-lg tracking-widest">{g.guess}</span>
              <Pips dead={g.dead} injured={g.injured} />
              <span className="text-sm">
                <span className="font-semibold text-rose-400">{g.dead} dead</span>
                <span className="text-slate-500">, </span>
                <span className="font-semibold text-amber-300">{g.injured} injured</span>
              </span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
