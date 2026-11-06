import { afterEach, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import type { AddressInfo } from "node:net";
import { io, type Socket } from "socket.io-client";
import { Solver } from "../shared/solver";
import type {
  ClientToServerEvents,
  GameView,
  PlayerInfo,
  ServerToClientEvents,
} from "../shared/protocol";
import { createGameServer, type ServerOptions } from "./app";
import { createMemoryStore } from "./testStore";

type ClientSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

interface TestClient {
  socket: ClientSocket;
  token: string;
  id: string;
  /** The name the server gave this player. */
  name: string;
  resumed: boolean;
  state: GameView | null;
  lobby: PlayerInfo[];
  room: string | null;
  events: [string, unknown][];
  last(name: string): unknown;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function waitFor(check: () => boolean, what: string, timeout = 3000) {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > timeout) assert.fail(`timed out waiting for ${what}`);
    await sleep(10);
  }
}

describe("game server", () => {
  let game: ReturnType<typeof createGameServer>;
  let url: string;
  let clients: TestClient[] = [];

  async function start(opts: Partial<ServerOptions> = {}) {
    game = createGameServer({
      turnMs: 5_000,
      reconnectGraceMs: 5_000,
      botDelayMs: [5, 15],
      ...opts,
    });
    await new Promise<void>((r) => game.server.listen(0, r));
    url = `http://localhost:${(game.server.address() as AddressInfo).port}`;
  }

  async function connect(username: string, token = crypto.randomUUID()): Promise<TestClient> {
    const socket: ClientSocket = io(url, {
      auth: { username, token },
      transports: ["websocket"],
      reconnection: false,
    });
    const c: TestClient = {
      socket,
      token,
      id: "",
      name: "",
      resumed: false,
      state: null,
      lobby: [],
      room: null,
      events: [],
      last: (name) => c.events.findLast(([n]) => n === name)?.[1],
    };
    socket.on("session:hello", (h) => {
      c.id = h.playerId;
      c.name = h.username;
      c.resumed = h.resumed;
    });
    socket.on("lobby:players", (p) => (c.lobby = p));
    socket.on("game:state", (v) => (c.state = v));
    socket.on("room:created", (code) => (c.room = code));
    socket.on("room:closed", () => (c.room = null));
    socket.on("game:ended", (reason) => {
      c.state = null;
      c.events.push(["game:ended", reason]);
    });
    for (const name of ["challenge:received", "challenge:declined", "challenge:cancelled", "error"] as const) {
      socket.on(name, ((payload: unknown) => c.events.push([name, payload])) as never);
    }
    clients.push(c);
    await new Promise<void>((resolve, reject) => {
      socket.on("session:hello", () => resolve());
      socket.on("connect_error", reject);
    });
    return c;
  }

  /** Two clients paired in a game via a challenge. */
  async function pair() {
    const a = await connect("alice");
    const b = await connect("bob");
    await waitFor(() => a.lobby.length === 2, "lobby");
    a.socket.emit("challenge:send", b.id);
    await waitFor(() => b.last("challenge:received") !== undefined, "challenge");
    b.socket.emit("challenge:respond", a.id, true);
    await waitFor(() => a.state !== null && b.state !== null, "game start");
    return { a, b };
  }

  /** Both players ready; returns who moves first. */
  async function readyUp(a: TestClient, b: TestClient, secrets = ["1234", "5678"]) {
    a.socket.emit("game:ready", secrets[0]);
    b.socket.emit("game:ready", secrets[1]);
    await waitFor(() => a.state?.phase === "playing" && b.state?.phase === "playing", "playing");
    const aFirst = a.state!.yourTurn;
    return {
      first: aFirst ? a : b,
      second: aFirst ? b : a,
      secretOf: (c: TestClient) => (c === a ? secrets[0] : secrets[1]),
    };
  }

  beforeEach(() => {
    clients = [];
  });

  afterEach(async () => {
    for (const c of clients) c.socket.close();
    await game.close();
  });

  test("rejects bad credentials", async () => {
    await start();
    for (const auth of [{ username: "  ", token: "abcdefgh12" }, { username: "x", token: "short" }, {}]) {
      const s = io(url, { auth, transports: ["websocket"], reconnection: false });
      const err = await new Promise<Error>((r) => s.on("connect_error", r));
      assert.equal(err.message, "Invalid username");
      s.close();
    }
  });

  test("full game: declined and forged challenges, turns, scoring, win, reveal, rematch", async () => {
    await start();
    const a = await connect("alice");
    const b = await connect("bob");
    const c = await connect("carol");
    await waitFor(() => a.lobby.length === 3, "lobby");

    // decline
    a.socket.emit("challenge:send", b.id);
    await waitFor(() => b.last("challenge:received") !== undefined, "challenge");
    assert.equal(a.lobby.find((p) => p.id === a.id)?.status, "pending");
    b.socket.emit("challenge:respond", a.id, false);
    await waitFor(() => a.last("challenge:declined") !== undefined, "decline");
    await waitFor(() => a.lobby.find((p) => p.id === a.id)?.status === "available", "status reset");

    // forged response: carol was never challenged by alice
    c.socket.emit("challenge:respond", a.id, true);
    await sleep(100);
    assert.equal(a.state, null);

    // carol also challenges bob, but bob accepts alice
    a.socket.emit("challenge:send", b.id);
    c.socket.emit("challenge:send", b.id);
    await waitFor(() => b.events.filter(([n]) => n === "challenge:received").length >= 3, "challenges");
    b.socket.emit("challenge:respond", a.id, true);
    await waitFor(() => a.state !== null && b.state !== null, "game start");
    await waitFor(() => c.last("challenge:declined") !== undefined, "carol declined");

    // can't guess before ready; invalid secrets are refused
    a.socket.emit("game:guess", "1234");
    await waitFor(() => a.last("error") !== undefined, "guess error");
    a.socket.emit("game:ready", "1123");
    await waitFor(() => a.last("error") === "Your number must be 4 different digits", "secret error");

    const { first, second, secretOf } = await readyUp(a, b);
    assert.ok(!JSON.stringify(a.state).includes("5678"), "secret leaked");

    second.socket.emit("game:guess", "9012");
    await waitFor(() => second.last("error") === "It's not your turn", "turn error");

    // 2 dead, 2 injured against the opponent's number
    const target = secretOf(second);
    first.socket.emit("game:guess", target[0] + target[1] + target[3] + target[2]);
    await waitFor(() => first.state!.yourGuesses.length === 1, "first guess");
    assert.deepEqual(
      { d: first.state!.yourGuesses[0].dead, i: first.state!.yourGuesses[0].injured },
      { d: 2, i: 2 }
    );
    await waitFor(() => second.state!.yourTurn, "turn passes");
    assert.equal(second.state!.opponentGuesses.length, 1);

    second.socket.emit("game:guess", secretOf(first));
    await waitFor(() => first.state!.phase === "finished", "finish");
    assert.equal(second.state!.winner, "you");
    assert.equal(first.state!.winner, "opponent");
    assert.deepEqual(second.state!.revealed, { yours: secretOf(second), opponents: secretOf(first) });
    assert.equal(second.state!.yourWins, 1);

    // rematch needs both
    first.socket.emit("game:rematch");
    await waitFor(() => second.state!.opponentWantsRematch, "rematch request");
    assert.equal(first.state!.phase, "finished");
    second.socket.emit("game:rematch");
    await waitFor(() => a.state!.phase === "setup" && b.state!.phase === "setup", "rematch");
    assert.equal(second.state!.yourWins, 1, "series score survives the rematch");
    assert.equal(second.state!.revealed, null);

    // leaving frees the other player
    a.socket.emit("game:leave");
    await waitFor(() => b.last("game:ended") === "opponent-left", "opponent left");
    await waitFor(() => b.lobby.find((p) => p.id === b.id)?.status === "available", "b free");
  });

  test("a dropped player can reconnect and resume within the grace period", async () => {
    await start();
    const { a, b } = await pair();
    await readyUp(a, b);
    const id = a.id;

    a.socket.disconnect();
    await waitFor(() => b.state!.opponentConnected === false, "opponent offline");
    // while away, they are hidden from the lobby
    assert.ok(!b.lobby.some((p) => p.id === id));

    const back = await connect("alice", a.token);
    assert.equal(back.resumed, true);
    assert.equal(back.id, id);
    await waitFor(() => back.state?.phase === "playing", "state restored");
    await waitFor(() => b.state!.opponentConnected === true, "opponent online");
    assert.equal(back.state!.opponent.username, "bob");

    // the resumed session can still play
    const mover = back.state!.yourTurn ? back : b;
    const other = mover === back ? b : back;
    // alice's secret is 1234, bob's is 5678
    mover.socket.emit("game:guess", other === b ? "5678" : "1234");
    await waitFor(() => other.state!.phase === "finished", "game continues");
  });

  test("a player who stays away past the grace period forfeits the game", async () => {
    await start({ reconnectGraceMs: 150 });
    const { a, b } = await pair();
    a.socket.disconnect();
    await waitFor(() => b.last("game:ended") === "opponent-left", "game abandoned");

    // an unknown session starts fresh
    const back = await connect("alice", a.token);
    assert.equal(back.resumed, false);
    assert.equal(back.state, null);
  });

  test("a new connection with the same session replaces the old one", async () => {
    await start();
    const first = await connect("alice");
    const second = await connect("alice", first.token);
    assert.equal(second.resumed, true);
    await waitFor(() => !first.socket.connected, "old socket dropped");
    await sleep(50);
    assert.ok(second.socket.connected);
    assert.equal(second.lobby.length, 1);
  });

  test("running out of time forfeits the turn", async () => {
    await start({ turnMs: 200 });
    const { a, b } = await pair();
    const { first, second } = await readyUp(a, b);
    assert.ok(first.state!.turnMsLeft! <= 200);

    await waitFor(() => first.state!.phase === "finished", "timeout");
    assert.equal(first.state!.endReason, "timeout");
    assert.equal(first.state!.winner, "opponent");
    assert.equal(second.state!.winner, "you");
  });

  test("private rooms: create, join by code, cancel, unknown code", async () => {
    await start();
    const host = await connect("host");
    const guest = await connect("guest");

    host.socket.emit("room:create");
    await waitFor(() => host.room !== null, "room code");
    assert.match(host.room!, /^[A-Z]{4}$/);
    await waitFor(() => guest.lobby.find((p) => p.id === host.id)?.status === "hosting", "hosting status");

    guest.socket.emit("room:join", "ZZZZ");
    await waitFor(() => guest.last("error") === "That room doesn't exist any more", "bad code");

    guest.socket.emit("room:join", host.room!.toLowerCase());
    await waitFor(() => host.state !== null && guest.state !== null, "joined");
    assert.equal(host.state!.opponent.username, "guest");

    // a cancelled room can't be joined
    const host2 = await connect("host2");
    const late = await connect("late");
    host2.socket.emit("room:create");
    await waitFor(() => host2.room !== null, "room 2");
    const code = host2.room!;
    host2.socket.emit("room:cancel");
    await waitFor(() => host2.room === null, "room closed");
    late.socket.emit("room:join", code);
    await waitFor(() => late.last("error") !== undefined, "cancelled room");
  });

  test("playing the computer: it guesses back, and a full game ends with a reveal", async () => {
    await start();
    const me = await connect("solo");
    me.socket.emit("bot:start");
    await waitFor(() => me.state !== null, "bot game");
    assert.equal(me.state!.vsComputer, true);
    assert.equal(me.state!.opponent.username, "Computer");
    assert.equal(me.state!.opponentReady, true);

    me.socket.emit("game:ready", "0123");
    await waitFor(() => me.state!.phase === "playing", "playing");

    const solver = new Solver();
    while (me.state!.phase === "playing") {
      await waitFor(() => me.state!.yourTurn || me.state!.phase === "finished", "my turn");
      if (me.state!.phase === "finished") break;
      const guess = solver.next();
      const before = me.state!.yourGuesses.length;
      me.socket.emit("game:guess", guess);
      await waitFor(() => me.state!.yourGuesses.length > before, "guess scored");
      solver.observe(guess, me.state!.yourGuesses.at(-1)!);
    }
    assert.equal(me.state!.phase, "finished");
    assert.ok(me.state!.revealed);
    assert.ok(me.state!.opponentGuesses.length > 0, "the computer made guesses");

    me.socket.emit("game:rematch");
    await waitFor(() => me.state!.phase === "setup", "bot rematch");
    assert.equal(me.state!.opponentReady, true);

    me.socket.emit("game:leave");
    await waitFor(() => me.lobby.find((p) => p.id === me.id)?.status === "available", "back in lobby");
  });

  test("malformed payloads are ignored and the server keeps working", async () => {
    await start();
    const a = await connect("alice");
    const b = await connect("bob");
    const loose = a.socket as unknown as Socket;
    loose.emit("challenge:send", { evil: true });
    loose.emit("challenge:send", null);
    loose.emit("challenge:respond", 42);
    loose.emit("game:ready", { x: 1 });
    loose.emit("game:guess", ["1", "2", "3", "4"]);
    loose.emit("room:join", 12345);
    loose.emit("room:join", "toolongcode");
    await sleep(100);

    a.socket.emit("challenge:send", b.id);
    await waitFor(() => b.last("challenge:received") !== undefined, "server still alive");
  });

  test("flooding a socket gets it rate limited", async () => {
    await start({ maxEventsPerWindow: 10 });
    const a = await connect("alice");
    for (let i = 0; i < 30; i++) a.socket.emit("room:cancel");
    await waitFor(() => a.last("error") === "You're doing that too fast", "rate limit");
  });

  test("the server refuses new players when full, but lets known sessions back in", async () => {
    await start({ maxPlayers: 1 });
    const a = await connect("alice");
    const s = io(url, {
      auth: { username: "bob", token: crypto.randomUUID() },
      transports: ["websocket"],
      reconnection: false,
    });
    const err = await new Promise<Error>((r) => s.on("connect_error", r));
    assert.match(err.message, /full/);
    s.close();

    const again = await connect("alice", a.token);
    assert.equal(again.resumed, true);
  });

  test("finished games are recorded and served on the leaderboard", async () => {
    const store = await createMemoryStore();
    await start({ store });

    const empty = await (await fetch(`${url}/api/leaderboard`)).json();
    assert.deepEqual(empty, { enabled: true, leaders: [] });

    const { a, b } = await pair();
    const { first, second, secretOf } = await readyUp(a, b);
    first.socket.emit("game:guess", secretOf(second));
    await waitFor(() => first.state!.phase === "finished", "game over");

    let board: { leaders: { username: string; wins: number; losses: number }[] } = { leaders: [] };
    for (let i = 0; i < 50 && board.leaders.length === 0; i++) {
      await sleep(20);
      board = await (await fetch(`${url}/api/leaderboard`)).json();
    }
    const winnerName = first === a ? "alice" : "bob";
    const loserName = first === a ? "bob" : "alice";
    assert.equal(board.leaders[0].username, winnerName);
    assert.equal(board.leaders[0].wins, 1);
    assert.equal(board.leaders[1].username, loserName);
    assert.equal(board.leaders[1].losses, 1);
    await store.close();
  });

  test("games against the computer are not recorded", async () => {
    const store = await createMemoryStore();
    await start({ store, turnMs: 150 });
    const me = await connect("solo");
    me.socket.emit("bot:start");
    await waitFor(() => me.state !== null, "bot game");
    me.socket.emit("game:ready", "0123");
    await waitFor(() => me.state!.phase === "finished", "timeout or bot win", 5000);
    await sleep(100);
    assert.deepEqual(await store.leaderboard(10), []);
    await store.close();
  });

  test("without a database the leaderboard is disabled but the game works", async () => {
    await start();
    assert.deepEqual(await (await fetch(`${url}/api/leaderboard`)).json(), { enabled: false, leaders: [] });
  });

  test("a failing database never interrupts a game", async () => {
    const store = await createMemoryStore();
    store.recordRound = async () => {
      throw new Error("db down");
    };
    store.leaderboard = async () => {
      throw new Error("db down");
    };
    await start({ store });
    const { a, b } = await pair();
    const { first, second, secretOf } = await readyUp(a, b);
    first.socket.emit("game:guess", secretOf(second));
    await waitFor(() => second.state!.phase === "finished", "game still finishes");
    const res = await fetch(`${url}/api/leaderboard`);
    assert.equal(res.status, 503);
    await store.close();
  });

  test("nobody is left with a pending challenge after a game, whoever leaves first", async () => {
    for (const order of ["a-first", "b-first", "both-at-once"] as const) {
      await start();
      const { a, b } = await pair();
      const { first, second, secretOf } = await readyUp(a, b);
      first.socket.emit("game:guess", secretOf(second));
      await waitFor(() => a.state!.phase === "finished", "finished");

      if (order === "a-first") a.socket.emit("game:leave");
      else if (order === "b-first") b.socket.emit("game:leave");
      else {
        a.socket.emit("game:leave");
        b.socket.emit("game:leave");
      }
      await waitFor(
        () => a.lobby.find((p) => p.id === a.id)?.status === "available" &&
          b.lobby.find((p) => p.id === b.id)?.status === "available",
        `both available (${order})`
      );
      // the only challenge ever sent is the one that started the game
      const received = (c: TestClient) => c.events.filter(([n]) => n === "challenge:received").length;
      assert.equal(received(a), 0);
      assert.equal(received(b), 1);
      assert.ok(a.lobby.every((p) => p.status === "available"));
      assert.ok(b.lobby.every((p) => p.status === "available"));

      // the shared afterEach cleans up the last round
      if (order !== "both-at-once") {
        for (const c of clients) c.socket.close();
        clients = [];
        await game.close();
      }
    }
  });

  test("a challenge nobody answers expires, and the challenger can cancel it", async () => {
    await start({ challengeTimeoutMs: 200 });
    const a = await connect("alice");
    const b = await connect("bob");
    await waitFor(() => a.lobby.length === 2, "lobby");

    // expires on its own
    a.socket.emit("challenge:send", b.id);
    await waitFor(() => b.last("challenge:received") !== undefined, "challenge");
    await waitFor(() => b.last("challenge:cancelled") === a.id, "target told it expired");
    await waitFor(() => a.last("error") === "bob didn't answer your challenge", "challenger told");
    await waitFor(() => a.lobby.find((p) => p.id === a.id)?.status === "available", "challenger freed");

    // cancelled by the challenger
    const before = b.events.filter(([n]) => n === "challenge:cancelled").length;
    a.socket.emit("challenge:send", b.id);
    await waitFor(() => a.lobby.find((p) => p.id === a.id)?.status === "pending", "pending");
    a.socket.emit("challenge:cancel");
    await waitFor(() => b.events.filter(([n]) => n === "challenge:cancelled").length > before, "target told");
    await waitFor(() => a.lobby.find((p) => p.id === a.id)?.status === "available", "challenger freed again");

    // an accepted challenge doesn't leave a timer behind that cancels the game
    a.socket.emit("challenge:send", b.id);
    await waitFor(() => b.last("challenge:received") !== undefined, "challenge 3");
    b.socket.emit("challenge:respond", a.id, true);
    await waitFor(() => a.state !== null, "game");
    await sleep(400);
    assert.notEqual(a.state, null);
    assert.equal(a.last("error"), "bob didn't answer your challenge", "no new expiry error");
  });

  test("players never share a name: the second gets a numeric suffix", async () => {
    await start();
    const first = await connect("Don");
    const second = await connect("don");
    const third = await connect("DON");
    assert.equal(first.name, "Don");
    assert.equal(second.name, "don (2)");
    assert.equal(third.name, "DON (3)");
    await waitFor(() => first.lobby.length === 3, "lobby");
    assert.deepEqual(first.lobby.map((p) => p.username).sort(), ["DON (3)", "Don", "don (2)"]);

    // reconnecting keeps the same name rather than bumping it
    second.socket.disconnect();
    await waitFor(() => first.lobby.length === 2, "second gone");
    const back = await connect("don", second.token);
    assert.equal(back.name, "don (2)");

    // a name is free again once its owner leaves
    first.socket.close();
    third.socket.close();
    await waitFor(() => back.lobby.length === 1, "others gone");
    const fresh = await connect("Don");
    assert.equal(fresh.name, "Don");

    // a maximum-length name still fits after the suffix
    const long = "x".repeat(20);
    await connect(long);
    const longer = await connect(long);
    assert.equal(longer.name.length, 20);
    assert.ok(longer.name.endsWith(" (2)"));
  });

  test("limits connections per client address", async () => {
    await start({ maxConnectionsPerIp: 2, clientIpHeader: "x-test-ip" });
    const open = (ip: string) =>
      io(url, {
        auth: { username: `u${Math.random().toString(36).slice(2, 7)}`, token: crypto.randomUUID() },
        transports: ["websocket"],
        reconnection: false,
        extraHeaders: { "x-test-ip": ip },
      });
    const outcome = (s: ClientSocket) =>
      new Promise<string>((resolve) => {
        s.on("session:hello", () => resolve("ok"));
        s.on("connect_error", (e) => resolve(e.message));
      });
    const sockets: ClientSocket[] = [];
    const attempt = async (ip: string) => {
      const s = open(ip);
      sockets.push(s);
      return { s, result: await outcome(s) };
    };

    const one = await attempt("203.0.113.1");
    const two = await attempt("203.0.113.1");
    assert.equal(one.result, "ok");
    assert.equal(two.result, "ok");
    assert.equal((await attempt("203.0.113.1")).result, "Too many connections from your network");
    // another address is unaffected
    assert.equal((await attempt("203.0.113.2")).result, "ok");

    // closing a connection frees a slot
    one.s.close();
    await sleep(100);
    assert.equal((await attempt("203.0.113.1")).result, "ok");
    for (const s of sockets) s.close();
  });

  test("without a trusted client address, private connections are not limited", async () => {
    // Behind a proxy every client shares the proxy's private address; limiting it would cap the whole server.
    await start({ maxConnectionsPerIp: 1 });
    const a = await connect("one");
    const b = await connect("two");
    const c = await connect("three");
    assert.ok(a.id && b.id && c.id);
  });

  test("a store that throws synchronously cannot interrupt a game", async () => {
    const store = await createMemoryStore();
    store.recordRound = () => {
      throw new Error("sync failure");
    };
    await start({ store });
    const { a, b } = await pair();
    const { first, second, secretOf } = await readyUp(a, b);
    first.socket.emit("game:guess", secretOf(second));
    await waitFor(() => first.state!.phase === "finished" && second.state!.phase === "finished", "both see the end");

    // and the rematch still works afterwards
    first.socket.emit("game:rematch");
    second.socket.emit("game:rematch");
    await waitFor(() => a.state!.phase === "setup" && b.state!.phase === "setup", "rematch");
    await store.close();
  });

  test("challengers are told when the player they challenged starts something else", async () => {
    await start();
    const a = await connect("alice");
    const b = await connect("bob");
    await waitFor(() => a.lobby.length === 2, "lobby");

    a.socket.emit("challenge:send", b.id);
    await waitFor(() => b.last("challenge:received") !== undefined, "challenge");
    b.socket.emit("bot:start");
    await waitFor(() => b.state !== null, "bob playing the computer");
    await waitFor(() => a.last("challenge:declined") !== undefined, "alice told");
    await waitFor(() => a.lobby.find((p) => p.id === a.id)?.status === "available", "alice freed");
  });
});
