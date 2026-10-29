import { test } from "node:test";
import assert from "node:assert/strict";
import { isValidNumber, randomNumber, scoreGuess } from "./game";

test("isValidNumber", () => {
  assert.equal(isValidNumber("1234"), true);
  assert.equal(isValidNumber("0123"), true);
  assert.equal(isValidNumber("1123"), false);
  assert.equal(isValidNumber("123"), false);
  assert.equal(isValidNumber("12345"), false);
  assert.equal(isValidNumber("12a4"), false);
  assert.equal(isValidNumber("1e23"), false);
  assert.equal(isValidNumber(""), false);
});

test("scoreGuess", () => {
  assert.deepEqual(scoreGuess("1234", "1234"), { dead: 4, injured: 0 });
  assert.deepEqual(scoreGuess("1234", "4321"), { dead: 0, injured: 4 });
  assert.deepEqual(scoreGuess("1234", "1243"), { dead: 2, injured: 2 });
  assert.deepEqual(scoreGuess("1234", "5678"), { dead: 0, injured: 0 });
  assert.deepEqual(scoreGuess("1234", "1567"), { dead: 1, injured: 0 });
});

test("randomNumber is always valid", () => {
  for (let i = 0; i < 500; i++) assert.equal(isValidNumber(randomNumber()), true);
});
