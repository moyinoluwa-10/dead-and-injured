import { useEffect, useRef, useState } from "react";

const BASE_TITLE = "Dead and Injured";

function beep() {
  try {
    const ctx = new AudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.value = 880;
    gain.gain.setValueAtTime(0.15, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.25);
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.25);
    osc.onended = () => void ctx.close();
  } catch {
    // Audio can be blocked or unsupported; the other cues still work.
  }
}

/** Sound, vibration and a tab-title nudge when it becomes your turn. */
export function useTurnAlerts(yourTurn: boolean, muted: boolean) {
  const wasYourTurn = useRef(false);

  useEffect(() => {
    if (yourTurn && !wasYourTurn.current) {
      if (!muted) beep();
      navigator.vibrate?.(150);
    }
    wasYourTurn.current = yourTurn;
  }, [yourTurn, muted]);

  useEffect(() => {
    const update = () => {
      document.title = yourTurn && document.hidden ? `● Your turn! – ${BASE_TITLE}` : BASE_TITLE;
    };
    update();
    document.addEventListener("visibilitychange", update);
    return () => {
      document.removeEventListener("visibilitychange", update);
      document.title = BASE_TITLE;
    };
  }, [yourTurn]);
}

/** Whole seconds left, counting down locally from the server's remaining-time snapshot. */
export function useCountdown(msLeft: number | null): number | null {
  const [seconds, setSeconds] = useState<number | null>(null);

  useEffect(() => {
    if (msLeft === null) {
      setSeconds(null);
      return;
    }
    const deadline = Date.now() + msLeft;
    const tick = () => setSeconds(Math.max(0, Math.ceil((deadline - Date.now()) / 1000)));
    tick();
    const timer = setInterval(tick, 250);
    return () => clearInterval(timer);
  }, [msLeft]);

  return seconds;
}
