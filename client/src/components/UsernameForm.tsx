import { useState } from "react";
import { MAX_USERNAME_LENGTH } from "../../../shared/protocol";

export function UsernameForm({ onSubmit }: { onSubmit: (name: string) => void }) {
  const [name, setName] = useState("");
  const trimmed = name.trim();

  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <form
        className="w-full max-w-sm space-y-4 rounded-2xl border border-slate-800 bg-slate-900 p-6"
        onSubmit={(e) => {
          e.preventDefault();
          if (trimmed) onSubmit(trimmed);
        }}
      >
        <h1 className="text-2xl font-bold">Dead and Injured</h1>
        <p className="text-sm text-slate-400">
          Guess your opponent's secret four-digit number. Every digit is different.
        </p>
        <label className="block text-sm font-medium" htmlFor="username">
          Choose a username
        </label>
        <input
          id="username"
          autoFocus
          value={name}
          maxLength={MAX_USERNAME_LENGTH}
          onChange={(e) => setName(e.target.value)}
          className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 outline-none focus:border-amber-400"
        />
        <button
          type="submit"
          disabled={!trimmed}
          className="w-full rounded-lg bg-amber-400 px-4 py-2 font-semibold text-slate-950 enabled:hover:bg-amber-300 disabled:opacity-50"
        >
          Play
        </button>
      </form>
    </main>
  );
}
