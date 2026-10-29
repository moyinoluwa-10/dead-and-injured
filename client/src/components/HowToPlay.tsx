import { Modal } from "./Modal";

export function HowToPlay({ onClose }: { onClose: () => void }) {
  return (
    <Modal title="How to play" onClose={onClose}>
      <h2 className="text-lg font-bold">How to play</h2>
      <ol className="mt-3 list-decimal space-y-2 pl-5 text-sm text-slate-300">
        <li>
          Each player secretly picks a <strong>4-digit number</strong> where every digit is different.
        </li>
        <li>Take turns guessing the other player's number. You have 60 seconds per guess.</li>
        <li>
          After each guess you're told how many digits are <strong className="text-rose-400">dead</strong>{" "}
          (right digit, right place) and <strong className="text-amber-300">injured</strong> (right digit,
          wrong place).
        </li>
        <li>The first to get <strong>4 dead</strong> wins.</li>
      </ol>
      <div className="mt-4 rounded-lg bg-slate-800/70 p-3 text-sm">
        <p className="text-slate-400">Example</p>
        <p>
          Secret <span className="font-mono tracking-widest">1234</span>, guess{" "}
          <span className="font-mono tracking-widest">1325</span> →{" "}
          <span className="font-semibold text-rose-400">1 dead</span> (the 1),{" "}
          <span className="font-semibold text-amber-300">2 injured</span> (the 3 and the 2).
        </p>
      </div>
      <button
        type="button"
        autoFocus
        onClick={onClose}
        className="mt-5 w-full rounded-lg bg-amber-400 px-4 py-2 font-semibold text-slate-950 hover:bg-amber-300"
      >
        Got it
      </button>
    </Modal>
  );
}
