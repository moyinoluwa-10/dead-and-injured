export const NUMBER_LENGTH = 4;

export interface Score {
  dead: number;
  injured: number;
}

/** A valid number is exactly four digits, none repeated. */
export function isValidNumber(value: string): boolean {
  return (
    new RegExp(`^\\d{${NUMBER_LENGTH}}$`).test(value) &&
    new Set(value).size === NUMBER_LENGTH
  );
}

/** Dead = right digit in the right place; injured = right digit, wrong place. */
export function scoreGuess(secret: string, guess: string): Score {
  let dead = 0;
  let injured = 0;
  for (let i = 0; i < guess.length; i++) {
    if (guess[i] === secret[i]) dead++;
    else if (secret.includes(guess[i])) injured++;
  }
  return { dead, injured };
}

export function randomNumber(): string {
  const digits = "0123456789".split("");
  for (let i = digits.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [digits[i], digits[j]] = [digits[j], digits[i]];
  }
  return digits.slice(0, NUMBER_LENGTH).join("");
}
