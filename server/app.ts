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
import { ROOM_CODE_LENGTH } from "../shared/protocol";
import { Solver } from "../shared/solver";
import { Match, type RoundResult } from "./match";
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
  maxPlayers: number;
  /** Max events per socket in any 10 second window. */
  maxEventsPerWindow: number;
  clientDir: string;
  /** Where finished games are recorded. Without one the game works, but has no leaderboard. */
  store?: Store;
}

export const defaultOptions: ServerOptions = {
  turnMs: 60_000,
  reconnectGraceMs: 45_000,
  botDelayMs: [700, 1600],
  maxPlayers: 200,
  maxEventsPerWindow: 80,
  clientDir: path.resolve(process.cwd(), "client/dist"),
};

interface SocketData {
  username: string;
  token: string;
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
      setTimeout(() => {
        turnTimers.delete(match.id);
        if (matches.get(match.id) === match && match.expireTurn()) afterChange(match);
      }, left)
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
    bot.timer = setTimeout(() => {
      bot.timer = null;
      if (matches.get(match.id) !== match) return;
      const guess = bot.solver.next();
      if (match.guess(bot.id, guess) !== null) return;
      const result = match.lastGuess(bot.id)!;
      bot.solver.observe(guess, result);
      afterChange(match);
    }, min + Math.random() * (max - min));
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
    opts.store
      ?.recordRound({
        winner: nameOf(r.winnerId),
        loser: nameOf(r.loserId),
        reason: r.reason,
        winnerGuesses: r.winnerGuesses,
        loserGuesses: r.loserGuesses,
        vsComputer,
      })
      .catch((err) => console.error("failed to record game", err));
  }

  function startMatch(a: Player, b: Player | Bot) {
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

  /** Cancel every challenge that involves `playerId`, as sender or as target. */
  function clearChallenges(playerId: string, notifyDeclinedBy?: Player) {
    for (const p of players.values()) {
      if (p.challenging === playerId) {
        p.challenging = null;
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
      self.challenging = null;
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

  io.use((socket, next) => {
    const auth = parse(authSchema, socket.handshake.auth);
    if (!auth) return next(new Error("Invalid username"));
    if (!byToken.has(auth.token) && players.size >= opts.maxPlayers) {
      return next(new Error("The server is full, try again soon"));
    }
    socket.data.username = auth.username;
    socket.data.token = auth.token;
    next();
  });

  io.on("connection", (socket) => {
    const { username, token } = socket.data;

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
        roomCode: null,
        graceTimer: null,
      };
      players.set(me.id, me);
      byToken.set(token, me);
    }
    const self = me;
    socket.join(self.id);
    socket.emit("session:hello", { playerId: self.id, resumed });

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

    socket.on("challenge:send", (rawTarget) => {
      const targetId = parse(idSchema, rawTarget);
      const target = targetId ? players.get(targetId) : undefined;
      if (!target || target.id === self.id || !isOnline(target)) return;
      if (!isAvailable(self)) return socket.emit("error", "Finish what you're doing first");
      if (target.matchId || target.roomCode) {
        return socket.emit("error", `${target.username} is busy right now`);
      }

      self.challenging = target.id;
      emitTo(target.id).emit("challenge:received", { id: self.id, username: self.username });
      broadcastLobby();
    });

    socket.on("challenge:respond", (...args) => {
      const parsed = parse(respondSchema, args);
      if (!parsed) return;
      const [fromId, accept] = parsed;
      const challenger = players.get(fromId);
      // Ignore stale or forged responses.
      if (!challenger || challenger.challenging !== self.id) return;

      if (!accept || self.matchId || self.roomCode) {
        challenger.challenging = null;
        emitTo(challenger.id).emit("challenge:declined", {
          id: self.id,
          username: self.username,
        });
        return broadcastLobby();
      }

      challenger.challenging = null;
      // Anyone else who challenged either player, or was challenged by them, is out of luck.
      clearChallenges(self.id, self);
      clearChallenges(challenger.id, challenger);
      startMatch(challenger, self);
    });

    socket.on("room:create", () => {
      if (!isAvailable(self)) return socket.emit("error", "Finish what you're doing first");
      self.roomCode = newRoomCode();
      rooms.set(self.roomCode, self.id);
      socket.emit("room:created", self.roomCode);
      broadcastLobby();
    });

    socket.on("room:cancel", () => {
      closeRoom(self);
      broadcastLobby();
    });

    socket.on("room:join", (rawCode) => {
      const code = parse(roomCodeSchema, rawCode);
      const host = code ? players.get(rooms.get(code) ?? "") : undefined;
      if (!host || host.roomCode !== code || host.id === self.id || !isOnline(host)) {
        return socket.emit("error", "That room doesn't exist any more");
      }
      if (!isAvailable(self)) return socket.emit("error", "Finish what you're doing first");

      rooms.delete(host.roomCode!);
      host.roomCode = null;
      clearChallenges(host.id, host);
      startMatch(host, self);
    });

    socket.on("bot:start", () => {
      if (!isAvailable(self)) return socket.emit("error", "Finish what you're doing first");
      startMatch(self, { id: `bot-${nextBotId++}`, solver: new Solver(), timer: null });
    });

    socket.on("game:ready", (rawSecret) => {
      const match = matchOf(self);
      const secret = parse(digitsSchema, rawSecret);
      if (!match || secret === undefined) return;
      const err = match.ready(self.id, secret);
      if (err) return socket.emit("error", err);
      afterChange(match);
    });

    socket.on("game:guess", (rawGuess) => {
      const match = matchOf(self);
      const guess = parse(digitsSchema, rawGuess);
      if (!match || guess === undefined) return;
      const err = match.guess(self.id, guess);
      if (err) return socket.emit("error", err);
      afterChange(match);
    });

    socket.on("game:rematch", () => {
      const match = matchOf(self);
      if (!match) return;
      match.requestRematch(self.id);
      const bot = bots.get(match.id);
      if (bot && match.requestRematch(bot.id)) botReady(match, bot);
      afterChange(match);
    });

    socket.on("game:leave", () => {
      const match = matchOf(self);
      if (!match) return;
      endMatch(match, self.id);
      broadcastLobby();
    });

    socket.on("disconnect", () => {
      // A newer connection has taken over this session; nothing to clean up.
      if (self.socketId !== socket.id) return;
      self.socketId = null;

      const match = matchOf(self);
      if (match && !bots.has(match.id)) {
        // Give the player a chance to come back before abandoning the game.
        self.graceTimer = setTimeout(() => removePlayer(self), opts.reconnectGraceMs);
        sendGameState(match);
        broadcastLobby();
      } else {
        removePlayer(self);
      }
    });
  });

  return {
    server,
    io,
    /** Stop everything and release timers; used by tests. */
    async close() {
      for (const t of turnTimers.values()) clearTimeout(t);
      for (const b of bots.values()) clearTimeout(b.timer ?? undefined);
      for (const p of players.values()) clearTimeout(p.graceTimer ?? undefined);
      await io.close();
    },
  };
}
