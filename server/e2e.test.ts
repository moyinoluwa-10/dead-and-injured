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

type ClientSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

interface TestClient {
  socket: ClientSocket;
  token: string;
  id: string;
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
      resumed: false,
      state: null,
      lobby: [],
      room: null,
      events: [],
      last: (name) => c.events.findLast(([n]) => n === name)?.[1],
    };
    socket.on("session:hello", (h) => {
      c.id = h.playerId;
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
});
