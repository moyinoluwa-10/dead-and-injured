import { useRef } from "react";
import { NUMBER_LENGTH } from "../../../shared/game";

export type Digits = string[];

export const emptyDigits = (): Digits => Array(NUMBER_LENGTH).fill("");
export const toDigits = (value: string): Digits =>
  Array.from({ length: NUMBER_LENGTH }, (_, i) => value[i] ?? "");

interface Props {
  value: Digits;
  onChange: (value: Digits) => void;
  onSubmit?: () => void;
  disabled?: boolean;
  autoFocus?: boolean;
  label: string;
}

/** Four single-digit boxes with auto-advance, backspace, arrow keys and paste support. */
export function DigitInput({ value, onChange, onSubmit, disabled, autoFocus, label }: Props) {
  const refs = useRef<(HTMLInputElement | null)[]>([]);

  const focus = (i: number) => refs.current[Math.max(0, Math.min(NUMBER_LENGTH - 1, i))]?.focus();

  const setAt = (i: number, digit: string) => {
    const next = value.slice();
    next[i] = digit;
    onChange(next);
  };

  return (
    <div className="flex justify-center gap-2 sm:gap-3" role="group" aria-label={label}>
      {value.map((digit, i) => (
        <input
          key={i}
          ref={(el) => {
            refs.current[i] = el;
          }}
          value={digit}
          disabled={disabled}
          autoFocus={autoFocus && i === 0}
          type="text"
          inputMode="numeric"
          autoComplete="off"
          aria-label={`${label}, digit ${i + 1}`}
          className="h-14 w-12 rounded-lg border-2 border-slate-700 bg-slate-900 text-center text-2xl font-bold text-white outline-none transition focus:border-amber-400 disabled:opacity-50 sm:h-16 sm:w-14"
          onFocus={(e) => e.target.select()}
          onChange={(e) => {
            const typed = e.target.value.replace(/\D/g, "");
            if (!typed) return setAt(i, "");
            setAt(i, typed[typed.length - 1]);
            if (i < NUMBER_LENGTH - 1) focus(i + 1);
          }}
          onKeyDown={(e) => {
            if (e.key === "Backspace" && !digit) {
              e.preventDefault();
              setAt(Math.max(0, i - 1), "");
              focus(i - 1);
            } else if (e.key === "ArrowLeft") focus(i - 1);
            else if (e.key === "ArrowRight") focus(i + 1);
            else if (e.key === "Enter") onSubmit?.();
          }}
          onPaste={(e) => {
            const pasted = e.clipboardData.getData("text").replace(/\D/g, "");
            if (!pasted) return;
            e.preventDefault();
            onChange(toDigits(pasted.slice(0, NUMBER_LENGTH)));
            focus(Math.min(pasted.length, NUMBER_LENGTH) - 1);
          }}
        />
      ))}
    </div>
  );
}
