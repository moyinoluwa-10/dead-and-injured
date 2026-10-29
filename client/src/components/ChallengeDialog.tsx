import type { Challenger } from "../useSession";

interface Props {
  challenger: Challenger;
  onRespond: (id: string, accept: boolean) => void;
}

export function ChallengeDialog({ challenger, onRespond }: Props) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="challenge-title"
      className="fixed inset-0 z-20 flex items-center justify-center bg-black/70 p-4"
    >
      <div className="w-full max-w-sm rounded-2xl border border-slate-700 bg-slate-900 p-6 text-center shadow-xl">
        <h2 id="challenge-title" className="text-lg font-bold">
          {challenger.username} wants to play
        </h2>
        <p className="mt-1 text-sm text-slate-400">Accept the challenge?</p>
        <div className="mt-5 flex gap-3">
          <button
            type="button"
            onClick={() => onRespond(challenger.id, false)}
            className="flex-1 rounded-lg border border-slate-700 px-4 py-2 font-medium hover:bg-slate-800"
          >
            Decline
          </button>
          <button
            type="button"
            autoFocus
            onClick={() => onRespond(challenger.id, true)}
            className="flex-1 rounded-lg bg-amber-400 px-4 py-2 font-semibold text-slate-950 hover:bg-amber-300"
          >
            Accept
          </button>
        </div>
      </div>
    </div>
  );
}
