import type { Challenger } from "../useSession";
import { Modal } from "./Modal";

interface Props {
  challenger: Challenger;
  onRespond: (id: string, accept: boolean) => void;
}

export function ChallengeDialog({ challenger, onRespond }: Props) {
  return (
    <Modal title={`${challenger.username} wants to play`} onClose={() => onRespond(challenger.id, false)}>
      <div className="text-center">
        <h2 className="text-lg font-bold">{challenger.username} wants to play</h2>
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
    </Modal>
  );
}
