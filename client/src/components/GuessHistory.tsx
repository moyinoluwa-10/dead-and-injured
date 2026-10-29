import { NUMBER_LENGTH } from "../../../shared/game";
import type { GuessResult } from "../../../shared/protocol";

interface Props {
  title: string;
  guesses: GuessResult[];
  emptyText: string;
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
              className={`flex items-center justify-between rounded-lg px-3 py-2 ${
                g.dead === NUMBER_LENGTH ? "bg-emerald-500/20" : "bg-slate-800/70"
              }`}
            >
              <span className="font-mono text-lg tracking-widest">{g.guess}</span>
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
