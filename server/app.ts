import crypto from "crypto";
import express from "express";
import http from "http";
import path from "path";
import { Server } from "socket.io";
import { randomNumber } from "../shared/game";
import type {
  ClientToServerEvents,
  PlayerInfo,
  ServerToClientEvents,
} from "../shared/protocol";
import { MAX_USERNAME_LENGTH, ROOM_CODE_LENGTH } from "../shared/protocol";
import { Solver } from "../shared/solver";
import { Match, type RoundResult } from "./match";
import { describeClient, isPrivateAddress, safely, uniqueName } from "./safety";
import type { Store } from "./store";
import {
  authSchema,
  digitsSchema,
  idSchema,
  parse,
  respondSchema,
  roomCodeSchema,
} from "./schemas";

export interface ServerOptions {
  /** Time a player has for each guess. */
  turnMs: number;
  /** How long a player in a game may be disconnected before the game is abandoned. */
  reconnectGraceMs: number;
  /** Range of the computer opponent's "thinking" delay. */
  botDelayMs: [number, number];
  /** How long a challenge waits for an answer before it expires. */
  challengeTimeoutMs: number;
  maxPlayers: number;
  /** Max simultaneous connections from one client address. */
  maxConnectionsPerIp: number;
  /**
   * Name of a request header that carries the real client address, such as
   * "x-forwarded-for" (first value is used). Only set this to a header your host
   * sets itself: a client could otherwise forge it. Without it, addresses are
   * only used when they are public, i.e. when the server is not behind a proxy.
   */
  clientIpHeader?: string;
  /** Max events per socket in any 10 second window. */
  maxEventsPerWindow: number;
  clientDir: string;
  /** Receives connection diagnostics (connects, disconnect reasons, refused handshakes). */
  log: (message: string) => void;
  /** Where finished games are recorded. Without one the game works, but has no leaderboard. */
  store?: Store;
}

export const defaultOptions: ServerOptions = {
  turnMs: 60_000,
  reconnectGraceMs: 45_000,
  botDelayMs: [700, 1600],
  challengeTimeoutMs: 30_000,
  maxPlayers: 200,
  maxConnectionsPerIp: 10,
  maxEventsPerWindow: 80,
  clientDir: path.resolve(process.cwd(), "client/dist"),
  log: (message) => console.log(message),
};

/**
 * How long idle HTTP connections are kept open. Node's default (5s) is shorter than a
 * hosting proxy's idle timeout, so the proxy can reuse a connection Node has just closed,
 * which fails the request (and a POST isn't retried). Keep this comfortably longer than
 * the proxy's timeout; headersTimeout must exceed it.
 */
const KEEP_ALIVE_TIMEOUT_MS = 120_000;

interface SocketData {
  username: string;
  token: string;
  /** Client address used for the per-address connection limit, if one could be determined. */
  ip: string | null;
}

interface Player {
  /** Public id, safe to show to other players. */
  id: string;
  /** Private reconnect secret; never sent to anyone else. */
  token: string;
  username: string;
  /** Null while disconnected (only possible during the reconnect grace period). */
  socketId: string | null;
  matchId: string | null;
  /** Id of the player this player has challenged, if any. */
  challenging: string | null;
  /** Expires the outstanding challenge if nobody answers. */
  challengeTimer: NodeJS.Timeout | null;
  /** Code of the private room this player is hosting, if any. */
  roomCode: string | null;
  graceTimer: NodeJS.Timeout | null;
}

interface Bot {
  id: string;
  solver: Solver;
  timer: NodeJS.Timeout | null;
}

const ROOM_LETTERS = "ABCDEFGHJKLMNPQRSTUVWXYZ";
const EVENT_WINDOW_MS = 10_000;

export function createGameServer(overrides: Partial<ServerOptions> = {}) {
  const opts: ServerOptions = { ...defaultOptions, ...overrides };

  const app = express();
  const server = http.createServer(app);
  const io = new Server<
    ClientToServerEvents,
    ServerToClientEvents,
    Record<string, never>,
    SocketData
  >(server, { maxHttpBufferSize: 10_000 });

  server.keepAliveTimeout = KEEP_ALIVE_TIMEOUT_MS;
  server.headersTimeout = KEEP_ALIVE_TIMEOUT_MS + 1_000;

  // Handshakes Socket.io turned away before a connection existed, e.g. "Session ID unknown".
  io.engine.on("connection_error", (err: { code?: number; message?: string; req?: http.IncomingMessage }) => {
    const client = describeClient(err.req?.headers["user-agent"]);
    opts.log(`handshake refused: ${client}, code=${err.code}, "${err.message}"`);
  });

  app.disable("x-powered-by");
  app.get("/health", (_req, res) => {
    res.json({ ok: true });
  });
  app.get("/api/leaderboard", async (_req, res) => {
    if (!opts.store) return void res.json({ enabled: false, leaders: [] });
    try {
      res.set("Cache-Control", "public, max-age=10");
      res.json({ enabled: true, leaders: await opts.store.leaderboard(20) });
    } catch (err) {
      console.error("leaderboard query failed", err);
      res.status(503).json({ error: "Leaderboard unavailable" });
    }
  });
  app.use(express.static(opts.clientDir));

  const players = new Map<string, Player>();
  const byToken = new Map<string, Player>();
  const matches = new Map<string, Match>();
  const bots = new Map<string, Bot>(); // keyed by match id
  const rooms = new Map<string, string>(); // room code -> host player id
  const turnTimers = new Map<string, NodeJS.Timeout>(); // keyed by match id
  let nextMatchId = 1;
  let nextBotId = 1;

  const isBot = (id: string) => id.startsWith("bot-");
  const isAvailable = (p: Player) =>
    p.matchId === null && p.challenging === null && p.roomCode === null;
  const isOnline = (p: Player) => p.socketId !== null;
  const emitTo = (id: string) => io.to(id);

  function statusOf(p: Player): PlayerInfo["status"] {
    if (p.matchId) return "playing";
    if (p.roomCode) return "hosting";
    if (p.challenging) return "pending";
    return "available";
  }

  function broadcastLobby() {
    io.emit(
      "lobby:players",
      [...players.values()].filter(isOnline).map((p) => ({
        id: p.id,
        username: p.username,
        status: statusOf(p),
      }))
    );
  }

  // ---- matches ----------------------------------------------------------

  function sendGameState(match: Match) {
    for (const id of match.players) {
      const me = players.get(id);
      if (!me) continue; // the computer
      const opponentId = match.other(id);
      const opponent = players.get(opponentId);
      emitTo(id).emit(
        "game:state",
        match.view(id, opponent?.username ?? "Computer", {
          opponentConnected: opponent ? isOnline(opponent) : true,
          vsComputer: bots.has(match.id),
        })
      );
    }
  }

  function scheduleTurnTimer(match: Match) {
    clearTimeout(turnTimers.get(match.id));
    turnTimers.delete(match.id);
    const left = match.turnMsLeft();
    if (match.phase !== "playing" || left === null) return;

    turnTimers.set(
      match.id,
      setTimeout(
        safely("turn timer", () => {
          turnTimers.delete(match.id);
          if (matches.get(match.id) === match && match.expireTurn()) afterChange(match);
        }),
        left
      )
    );
  }

  function botReady(match: Match, bot: Bot) {
    bot.solver = new Solver();
    match.ready(bot.id, randomNumber());
  }

  function maybeBotMove(match: Match) {
    const bot = bots.get(match.id);
    if (!bot || bot.timer) return;
    if (match.phase !== "playing" || match.currentTurn !== bot.id) return;

    const [min, max] = opts.botDelayMs;
    bot.timer = setTimeout(
      safely("computer move", () => {
        bot.timer = null;
        if (matches.get(match.id) !== match) return;
        const guess = bot.solver.next();
        if (match.guess(bot.id, guess) !== null) return;
        const result = match.lastGuess(bot.id)!;
        bot.solver.observe(guess, result);
        afterChange(match);
      }),
      min + Math.random() * (max - min)
    );
  }

  /** Call after any change to a match: pushes state, restarts the turn clock, lets the computer move. */
  function afterChange(match: Match) {
    sendGameState(match);
    scheduleTurnTimer(match);
    maybeBotMove(match);
  }

  const nameOf = (id: string) => players.get(id)?.username ?? "Computer";

  /** Fire and forget: a database problem must never interrupt a game. */
  function recordRound(r: RoundResult, vsComputer: boolean) {
    const store = opts.store;
    if (!store) return;
    // The async wrapper turns a synchronous throw from the store into a rejection too.
    void (async () =>
      store.recordRound({
        winner: nameOf(r.winnerId),
        loser: nameOf(r.loserId),
        reason: r.reason,
        winnerGuesses: r.winnerGuesses,
        loserGuesses: r.loserGuesses,
        vsComputer,
      }))().catch((err) => console.error("failed to record game", err));
  }

  function startMatch(a: Player, b: Player | Bot) {
    // Anyone who challenged these players, or was challenged by them, is told it's off.
    clearChallenges(a.id, a);
    if ("socketId" in b) clearChallenges(b.id, b);

    const match = new Match(String(nextMatchId++), [a.id, b.id], {
      turnMs: opts.turnMs,
      onFinish: (r) => recordRound(r, bots.has(match.id)),
    });
    matches.set(match.id, match);
    a.matchId = match.id;
    if ("socketId" in b) b.matchId = match.id;
    else {
      bots.set(match.id, b);
      botReady(match, b);
    }
    afterChange(match);
    broadcastLobby();
  }

  /** Drop a match and tell the remaining human player (if any) it is over. */
  function endMatch(match: Match, leaverId: string) {
    matches.delete(match.id);
    clearTimeout(turnTimers.get(match.id));
    turnTimers.delete(match.id);
    const bot = bots.get(match.id);
    if (bot) clearTimeout(bot.timer ?? undefined);
    bots.delete(match.id);

    for (const id of match.players) {
      const p = players.get(id);
      if (p) p.matchId = null;
    }
    const remaining = match.other(leaverId);
    if (players.has(remaining)) emitTo(remaining).emit("game:ended", "opponent-left");
  }

  const matchOf = (p: Player): Match | undefined => (p.matchId ? matches.get(p.matchId) : undefined);

  // ---- challenges and rooms ----------------------------------------------

  function endChallenge(p: Player) {
    clearTimeout(p.challengeTimer ?? undefined);
    p.challengeTimer = null;
    p.challenging = null;
  }

  /** `challenger` challenges `target`; the challenge expires if it goes unanswered. */
  function startChallenge(challenger: Player, target: Player) {
    challenger.challenging = target.id;
    challenger.challengeTimer = setTimeout(
      safely("challenge timer", () => {
        if (challenger.challenging !== target.id) return;
        endChallenge(challenger);
        emitTo(target.id).emit("challenge:cancelled", challenger.id);
        emitTo(challenger.id).emit("error", `${target.username} didn't answer your challenge`);
        broadcastLobby();
      }),
      opts.challengeTimeoutMs
    );
  }

  /** Cancel every challenge that involves `playerId`, as sender or as target. */
  function clearChallenges(playerId: string, notifyDeclinedBy?: Player) {
    for (const p of players.values()) {
      if (p.challenging === playerId) {
        endChallenge(p);
        if (notifyDeclinedBy) {
          emitTo(p.id).emit("challenge:declined", {
            id: notifyDeclinedBy.id,
            username: notifyDeclinedBy.username,
          });
        }
      }
    }
    const self = players.get(playerId);
    if (self?.challenging) {
      emitTo(self.challenging).emit("challenge:cancelled", playerId);
      endChallenge(self);
    }
  }

  function closeRoom(p: Player) {
    if (!p.roomCode) return;
    rooms.delete(p.roomCode);
    p.roomCode = null;
    emitTo(p.id).emit("room:closed");
  }

  function newRoomCode(): string {
    for (;;) {
      let code = "";
      for (let i = 0; i < ROOM_CODE_LENGTH; i++) {
        code += ROOM_LETTERS[crypto.randomInt(ROOM_LETTERS.length)];
      }
      if (!rooms.has(code)) return code;
    }
  }

  /** Remove a player for good (left, or failed to reconnect in time). */
  function removePlayer(p: Player) {
    clearTimeout(p.graceTimer ?? undefined);
    const match = matchOf(p);
    if (match) endMatch(match, p.id);
    clearChallenges(p.id, p);
    closeRoom(p);
    players.delete(p.id);
    byToken.delete(p.token);
    broadcastLobby();
  }

  // ---- connections -------------------------------------------------------

  /** The client's address for rate limiting, or null if it can't be told apart from other clients. */
  function clientIp(socket: { handshake: { address: string; headers: http.IncomingHttpHeaders } }) {
    if (opts.clientIpHeader) {
      const raw = socket.handshake.headers[opts.clientIpHeader.toLowerCase()];
      const first = (Array.isArray(raw) ? raw[0] : raw)?.split(",")[0]?.trim();
      if (first) return first;
    }
    // Behind a proxy every connection arrives from the proxy's private address, which
    // says nothing about the client, so limiting by it would cap the whole server.
    const address = socket.handshake.address;
    return address && !isPrivateAddress(address) ? address : null;
  }

  const connectionsByIp = new Map<string, number>();

  io.use((socket, next) => {
    const auth = parse(authSchema, socket.handshake.auth);
    if (!auth) return next(new Error("Invalid username"));
    if (!byToken.has(auth.token) && players.size >= opts.maxPlayers) {
      return next(new Error("The server is full, try again soon"));
    }
    const ip = clientIp(socket);
    if (ip && (connectionsByIp.get(ip) ?? 0) >= opts.maxConnectionsPerIp) {
      return next(new Error("Too many connections from your network"));
    }
    socket.data.username = auth.username;
    socket.data.token = auth.token;
    socket.data.ip = ip;
    next();
  });

  io.on("connection", (socket) => {
    const { username: requestedName, token, ip } = socket.data;

    const client = describeClient(socket.handshake.headers["user-agent"]);
    const connectedAt = Date.now();
    socket.on("disconnect", (reason) => {
      const seconds = Math.round((Date.now() - connectedAt) / 1000);
      opts.log(`disconnect: ${client}, reason="${reason}", after ${seconds}s`);
    });

    if (ip) {
      connectionsByIp.set(ip, (connectionsByIp.get(ip) ?? 0) + 1);
      socket.on("disconnect", () => {
        const left = (connectionsByIp.get(ip) ?? 1) - 1;
        if (left <= 0) connectionsByIp.delete(ip);
        else connectionsByIp.set(ip, left);
      });
    }

    // Per-socket rate limit.
    let recent: number[] = [];
    socket.use((_packet, next) => {
      const now = Date.now();
      recent = recent.filter((t) => now - t < EVENT_WINDOW_MS);
      if (recent.length >= opts.maxEventsPerWindow) {
        socket.emit("error", "You're doing that too fast");
        return;
      }
      recent.push(now);
      next();
    });

    // Two players can't share a name: the second gets "Name (2)". The player's own
    // existing session doesn't count, so reconnecting keeps the same name.
    const username = uniqueName(
      requestedName,
      (candidate) =>
        [...players.values()].some(
          (p) => p.token !== token && p.username.toLowerCase() === candidate.toLowerCase()
        ),
      MAX_USERNAME_LENGTH
    );

    let me = byToken.get(token);
    const resumed = me !== undefined;
    if (me) {
      clearTimeout(me.graceTimer ?? undefined);
      me.graceTimer = null;
      me.username = username;
      // Point the player at the new socket *before* dropping the old one, so the
      // old socket's disconnect handler recognises it is stale and does nothing.
      me.socketId = socket.id;
      io.in(me.id).disconnectSockets(true);
    } else {
      me = {
        id: crypto.randomUUID().slice(0, 8),
        token,
        username,
        socketId: socket.id,
        matchId: null,
        challenging: null,
        challengeTimer: null,
        roomCode: null,
        graceTimer: null,
      };
      players.set(me.id, me);
      byToken.set(token, me);
    }
    const self = me;
    socket.join(self.id);
    socket.emit("session:hello", { playerId: self.id, username: self.username, resumed });
    opts.log(
      `connect: ${client} via ${socket.conn.transport.name}, ${resumed ? "resumed session" : "new session"}, ${players.size} players`
    );

    // Handlers that throw are logged and reported to the player instead of taking the server down.
    const on = <E extends keyof ClientToServerEvents>(event: E, handler: ClientToServerEvents[E]) => {
      socket.on(
        event,
        safely(event, handler as (...args: unknown[]) => void, () =>
          socket.emit("error", "Something went wrong, please try again")
        ) as never
      );
    };

    if (resumed) {
      // Bring the returning client back up to date.
      for (const p of players.values()) {
        if (p.challenging === self.id) {
          socket.emit("challenge:received", { id: p.id, username: p.username });
        }
      }
      if (self.roomCode) socket.emit("room:created", self.roomCode);
      const match = matchOf(self);
      if (match) sendGameState(match);
    }
    broadcastLobby();

    on("challenge:send", (rawTarget) => {
      const targetId = parse(idSchema, rawTarget);
      const target = targetId ? players.get(targetId) : undefined;
      if (!target || target.id === self.id || !isOnline(target)) return;
      if (!isAvailable(self)) return socket.emit("error", "Finish what you're doing first");
      if (target.matchId || target.roomCode) {
        return socket.emit("error", `${target.username} is busy right now`);
      }

      startChallenge(self, target);
      emitTo(target.id).emit("challenge:received", { id: self.id, username: self.username });
      broadcastLobby();
    });

    on("challenge:cancel", () => {
      const targetId = self.challenging;
      if (!targetId) return;
      endChallenge(self);
      emitTo(targetId).emit("challenge:cancelled", self.id);
      broadcastLobby();
    });

    on("challenge:respond", (...args) => {
      const parsed = parse(respondSchema, args);
      if (!parsed) return;
      const [fromId, accept] = parsed;
      const challenger = players.get(fromId);
      // Ignore stale or forged responses.
      if (!challenger || challenger.challenging !== self.id) return;

      if (!accept || self.matchId || self.roomCode) {
        endChallenge(challenger);
        emitTo(challenger.id).emit("challenge:declined", {
          id: self.id,
          username: self.username,
        });
        return broadcastLobby();
      }

      endChallenge(challenger);
      startMatch(challenger, self);
    });

    on("session:ping", (ack) => {
      if (typeof ack === "function") ack();
    });

    on("room:create", () => {
      if (!isAvailable(self)) return socket.emit("error", "Finish what you're doing first");
      self.roomCode = newRoomCode();
      rooms.set(self.roomCode, self.id);
      socket.emit("room:created", self.roomCode);
      broadcastLobby();
    });

    on("room:cancel", () => {
      closeRoom(self);
      broadcastLobby();
    });

    on("room:join", (rawCode) => {
      const code = parse(roomCodeSchema, rawCode);
      const host = code ? players.get(rooms.get(code) ?? "") : undefined;
      if (!host || host.roomCode !== code || host.id === self.id || !isOnline(host)) {
        return socket.emit("error", "That room doesn't exist any more");
      }
      if (!isAvailable(self)) return socket.emit("error", "Finish what you're doing first");

      rooms.delete(host.roomCode!);
      host.roomCode = null;
      startMatch(host, self);
    });

    on("bot:start", () => {
      if (!isAvailable(self)) return socket.emit("error", "Finish what you're doing first");
      startMatch(self, { id: `bot-${nextBotId++}`, solver: new Solver(), timer: null });
    });

    on("game:ready", (rawSecret) => {
      const match = matchOf(self);
      const secret = parse(digitsSchema, rawSecret);
      if (!match || secret === undefined) return;
      const err = match.ready(self.id, secret);
      if (err) return socket.emit("error", err);
      afterChange(match);
    });

    on("game:guess", (rawGuess) => {
      const match = matchOf(self);
      const guess = parse(digitsSchema, rawGuess);
      if (!match || guess === undefined) return;
      const err = match.guess(self.id, guess);
      if (err) return socket.emit("error", err);
      afterChange(match);
    });

    on("game:rematch", () => {
      const match = matchOf(self);
      if (!match) return;
      match.requestRematch(self.id);
      const bot = bots.get(match.id);
      if (bot && match.requestRematch(bot.id)) botReady(match, bot);
      afterChange(match);
    });

    on("game:leave", () => {
      const match = matchOf(self);
      if (!match) return;
      endMatch(match, self.id);
      broadcastLobby();
    });

    socket.on(
      "disconnect",
      safely("disconnect", () => {
        // A newer connection has taken over this session; nothing to clean up.
        if (self.socketId !== socket.id) return;
        self.socketId = null;

        const match = matchOf(self);
        if (match && !bots.has(match.id)) {
          // Give the player a chance to come back before abandoning the game.
          self.graceTimer = setTimeout(
            safely("reconnect timeout", () => removePlayer(self)),
            opts.reconnectGraceMs
          );
          sendGameState(match);
          broadcastLobby();
        } else {
          removePlayer(self);
        }
      })
    );
  });

  return {
    server,
    io,
    /** Stop everything and release timers; used by tests. */
    async close() {
      for (const t of turnTimers.values()) clearTimeout(t);
      for (const b of bots.values()) clearTimeout(b.timer ?? undefined);
      for (const p of players.values()) {
        clearTimeout(p.graceTimer ?? undefined);
        clearTimeout(p.challengeTimer ?? undefined);
      }
      await io.close();
    },
  };
}
