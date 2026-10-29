import { test } from "node:test";
import assert from "node:assert/strict";
import { Match } from "./match";

function startedMatch() {
  const m = new Match("m", ["a", "b"]);
  assert.equal(m.ready("a", "1234"), null);
  assert.equal(m.ready("b", "5678"), null);
  assert.equal(m.phase, "playing");
  return m;
}

/** Whoever's turn it is, plus the other player. */
function whoseTurn(m: Match) {
  const first = m.view("a", "A").yourTurn ? "a" : "b";
  return { first, second: first === "a" ? "b" : "a" };
}

test("rejects invalid secrets and double ready", () => {
  const m = new Match("m", ["a", "b"]);
  assert.ok(m.ready("a", "1123"));
  assert.ok(m.ready("a", "12"));
  assert.equal(m.ready("a", "1234"), null);
  assert.ok(m.ready("a", "4321"));
});

test("only the player whose turn it is can guess, and turns alternate", () => {
  const m = startedMatch();
  const { first, second } = whoseTurn(m);
  assert.ok(m.guess(second, "1234"));
  assert.equal(m.guess(first, "9021"), null);
  assert.equal(m.view(second, "x").yourTurn, true);
  assert.equal(m.view(first, "x").yourTurn, false);
});

test("a correct guess ends the game and never exposes secrets", () => {
  const m = startedMatch();
  const { first, second } = whoseTurn(m);
  const winning = first === "a" ? "5678" : "1234";
  assert.equal(m.guess(first, winning), null);
  assert.equal(m.phase, "finished");
  assert.equal(m.view(first, "x").winner, "you");
  assert.equal(m.view(second, "x").winner, "opponent");
  assert.ok(m.guess(second, "1234"));
  assert.ok(!JSON.stringify(m.view(first, "x")).includes(first === "a" ? "1234" : "5678"));
});

test("rematch needs both players and resets the round", () => {
  const m = startedMatch();
  const { first, second } = whoseTurn(m);
  m.guess(first, first === "a" ? "5678" : "1234");
  assert.equal(m.requestRematch(first), false);
  assert.equal(m.requestRematch(second), true);
  assert.equal(m.phase, "setup");
  assert.deepEqual(m.view("a", "x").yourGuesses, []);
});
