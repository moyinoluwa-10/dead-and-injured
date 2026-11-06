import { afterEach, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import type { RoundRecord, Store } from "./store";
import { createMemoryStore } from "./testStore";

const round = (winner: string, loser: string, extra: Partial<RoundRecord> = {}): RoundRecord => ({
  winner,
  loser,
  reason: "solved",
  winnerGuesses: 6,
  loserGuesses: 5,
  vsComputer: false,
  ...extra,
});

describe("store", () => {
  let store: Store;
  beforeEach(async () => {
    store = await createMemoryStore();
  });
  afterEach(() => store.close());

  test("an empty database has an empty leaderboard", async () => {
    assert.deepEqual(await store.leaderboard(10), []);
  });

  test("counts wins and losses per player and ranks by wins", async () => {
    await store.recordRound(round("Ada", "Bob"));
    await store.recordRound(round("Ada", "Cy"));
    await store.recordRound(round("Bob", "Cy", { reason: "timeout" }));

    assert.deepEqual(await store.leaderboard(10), [
      { username: "Ada", wins: 2, losses: 0, games: 2 },
      { username: "Bob", wins: 1, losses: 1, games: 2 },
      { username: "Cy", wins: 0, losses: 2, games: 2 },
    ]);
  });

  test("groups names case-insensitively", async () => {
    await store.recordRound(round("Ada", "Bob"));
    await store.recordRound(round("ada", "bob"));
    const [top] = await store.leaderboard(10);
    assert.equal(top.wins, 2);
    assert.equal(top.games, 2);
    assert.equal((await store.leaderboard(10)).length, 2);
  });

  test("games against the computer are not on the leaderboard", async () => {
    await store.recordRound(round("Ada", "Computer", { vsComputer: true }));
    await store.recordRound(round("Computer", "Ada", { vsComputer: true }));
    assert.deepEqual(await store.leaderboard(10), []);
  });

  test("respects the limit and breaks ties by fewer losses", async () => {
    await store.recordRound(round("Ada", "Zed"));
    await store.recordRound(round("Bob", "Zed"));
    await store.recordRound(round("Cy", "Bob"));
    await store.recordRound(round("Bob", "Cy"));
    await store.recordRound(round("Bob", "Cy"));
    const top = await store.leaderboard(2);
    assert.equal(top.length, 2);
    assert.equal(top[0].username, "Bob");
  });

  test("names containing SQL metacharacters are stored safely", async () => {
    await store.recordRound(round("x'); DROP TABLE matches;--", "Bob"));
    const board = await store.leaderboard(10);
    assert.equal(board[0].username, "x'); DROP TABLE matches;--");
  });
});
