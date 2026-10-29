import { test } from "node:test";
import assert from "node:assert/strict";
import { isValidNumber, randomNumber, scoreGuess } from "./game";
import { Solver, allValidNumbers } from "./solver";

test("there are 5040 valid numbers, all valid", () => {
  const all = allValidNumbers();
  assert.equal(all.length, 5040);
  assert.ok(all.every(isValidNumber));
});

test("solver cracks any number quickly", () => {
  let total = 0;
  for (let game = 0; game < 200; game++) {
    const secret = randomNumber();
    const solver = new Solver();
    let guesses = 0;
    for (;;) {
      const guess = solver.next();
      guesses++;
      const score = scoreGuess(secret, guess);
      if (score.dead === 4) break;
      assert.ok(guesses < 12, `took too long to find ${secret}`);
      solver.observe(guess, score);
    }
    total += guesses;
  }
  assert.ok(total / 200 < 8, `average ${total / 200} guesses`);
});
