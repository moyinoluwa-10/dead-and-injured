import { NUMBER_LENGTH, randomNumber, scoreGuess, type Score } from "./game";

let cache: string[] | null = null;

/** Every valid secret number (4 different digits): 5040 of them. */
export function allValidNumbers(): string[] {
  if (cache) return cache;
  const out: string[] = [];
  const build = (prefix: string) => {
    if (prefix.length === NUMBER_LENGTH) {
      out.push(prefix);
      return;
    }
    for (let d = 0; d < 10; d++) {
      const digit = String(d);
      if (!prefix.includes(digit)) build(prefix + digit);
    }
  };
  build("");
  return (cache = out);
}

/**
 * Computer opponent. Keeps every number still consistent with the answers it has
 * been given and guesses one of them at random; this solves a game in ~6 guesses.
 */
export class Solver {
  private candidates = allValidNumbers();

  next(): string {
    if (this.candidates.length === 0) return randomNumber();
    return this.candidates[Math.floor(Math.random() * this.candidates.length)];
  }

  observe(guess: string, score: Score) {
    this.candidates = this.candidates.filter((c) => {
      const s = scoreGuess(c, guess);
      return s.dead === score.dead && s.injured === score.injured;
    });
  }
}
