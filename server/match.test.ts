import { test } from "node:test";
import assert from "node:assert/strict";
import { Match } from "./match";

function startedMatch(opts?: ConstructorParameters<typeof Match>[2]) {
  const m = new Match("m", ["a", "b"], opts);
  assert.equal(m.ready("a", "1234"), null);
  assert.equal(m.ready("b", "5678"), null);
  assert.equal(m.phase, "playing");
  return m;
}

/** Whoever's turn it is, plus the other player. */
function whoseTurn(m: Match) {
  const first = m.currentTurn!;
  return { first, second: m.other(first) };
}

const secretOf = (id: string) => (id === "a" ? "1234" : "5678");

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

test("secrets stay hidden until the game is over", () => {
  const m = startedMatch();
  const { first, second } = whoseTurn(m);
  m.guess(first, "9021");
  const midGame = JSON.stringify(m.view(first, "x")) + JSON.stringify(m.view(second, "x"));
  assert.ok(!midGame.includes("1234") && !midGame.includes("5678"));
  assert.equal(m.view(first, "x").revealed, null);

  m.guess(second, secretOf(first));
  const view = m.view(first, "x");
  assert.deepEqual(view.revealed, { yours: secretOf(first), opponents: secretOf(second) });
});

test("a correct guess ends the game and scores the series", () => {
  const m = startedMatch();
  const { first, second } = whoseTurn(m);
  assert.equal(m.guess(first, secretOf(second)), null);
  assert.equal(m.phase, "finished");
  assert.equal(m.view(first, "x").winner, "you");
  assert.equal(m.view(second, "x").winner, "opponent");
  assert.equal(m.view(first, "x").endReason, "solved");
  assert.equal(m.view(first, "x").yourWins, 1);
  assert.equal(m.view(second, "x").opponentWins, 1);
  assert.ok(m.guess(second, "1234"));
});

test("rematch needs both players, resets the round and keeps the score", () => {
  const m = startedMatch();
  const { first, second } = whoseTurn(m);
  m.guess(first, secretOf(second));
  assert.equal(m.requestRematch(first), false);
  assert.equal(m.requestRematch(second), true);
  assert.equal(m.phase, "setup");
  assert.deepEqual(m.view("a", "x").yourGuesses, []);
  assert.equal(m.view(first, "x").yourWins, 1);
});

test("the turn clock counts down and a timeout forfeits the game", () => {
  let t = 1_000;
  const m = startedMatch({ turnMs: 5_000, now: () => t });
  const { first, second } = whoseTurn(m);
  assert.equal(m.turnMsLeft(), 5_000);
  t += 3_000;
  assert.equal(m.turnMsLeft(), 2_000);
  t += 10_000;
  assert.equal(m.turnMsLeft(), 0);

  assert.equal(m.expireTurn(), true);
  assert.equal(m.phase, "finished");
  assert.equal(m.view(second, "x").winner, "you");
  assert.equal(m.view(first, "x").endReason, "timeout");
  assert.equal(m.turnMsLeft(), null);
  assert.equal(m.expireTurn(), false);
});

test("a guess restarts the clock for the next player", () => {
  let t = 0;
  const m = startedMatch({ turnMs: 5_000, now: () => t });
  const { first, second } = whoseTurn(m);
  t += 4_000;
  m.guess(first, "9021");
  assert.equal(m.currentTurn, second);
  assert.equal(m.turnMsLeft(), 5_000);
});
