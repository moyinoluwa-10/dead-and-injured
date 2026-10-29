import { useState } from "react";

/** Scratch pad for crossing off digits you've ruled out. Purely local; never sent anywhere. */
export function DigitNotes() {
  const [crossedOut, setCrossedOut] = useState<Set<string>>(new Set());

  const toggle = (digit: string) =>
    setCrossedOut((prev) => {
      const next = new Set(prev);
      if (!next.delete(digit)) next.add(digit);
      return next;
    });

  return (
    <div className="space-y-2">
      <p className="text-xs uppercase tracking-wide text-slate-500">Notes: tap to cross off a digit</p>
      <div className="flex flex-wrap justify-center gap-1.5">
        {Array.from({ length: 10 }, (_, i) => String(i)).map((digit) => {
          const out = crossedOut.has(digit);
          return (
            <button
              key={digit}
              type="button"
              aria-pressed={out}
              aria-label={`${digit}${out ? ", crossed off" : ""}`}
              onClick={() => toggle(digit)}
              className={`h-9 w-9 rounded-md border text-sm font-semibold transition ${
                out
                  ? "border-slate-800 bg-slate-900 text-slate-600 line-through"
                  : "border-slate-700 bg-slate-800 text-slate-200 hover:border-amber-400"
              }`}
            >
              {digit}
            </button>
          );
        })}
      </div>
    </div>
  );
}
