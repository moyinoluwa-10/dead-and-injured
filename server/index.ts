import express from "express";
import http from "http";
import path from "path";
import { Server } from "socket.io";
import type {
  ClientToServerEvents,
  PlayerInfo,
  ServerToClientEvents,
} from "../shared/protocol";
import { MAX_USERNAME_LENGTH } from "../shared/protocol";
import { Match } from "./match";

const PORT = Number(process.env.PORT) || 3000;

const app = express();
const server = http.createServer(app);
const io = new Server<ClientToServerEvents, ServerToClientEvents>(server);

app.use(express.static(path.resolve(process.cwd(), "client/dist")));

interface Player {
  id: string;
  username: string;
  matchId: string | null;
  /** Id of the player this player has challenged, if any. */
  challenging: string | null;
}

const players = new Map<string, Player>();
const matches = new Map<string, Match>();
let nextMatchId = 1;

const isAvailable = (p: Player) => p.matchId === null && p.challenging === null;

function statusOf(p: Player): PlayerInfo["status"] {
  if (p.matchId) return "playing";
  if (p.challenging) return "pending";
  return "available";
}

function broadcastLobby() {
  io.emit(
    "lobby:players",
    [...players.values()].map((p) => ({
      id: p.id,
      username: p.username,
      status: statusOf(p),
    }))
  );
}

function sendGameState(match: Match) {
  for (const id of match.players) {
    const opponent = players.get(match.other(id));
    if (opponent) io.to(id).emit("game:state", match.view(id, opponent.username));
  }
}

function matchOf(p: Player): Match | undefined {
  return p.matchId ? matches.get(p.matchId) : undefined;
}

/** Drop a match and tell the remaining player (if any) it is over. */
function endMatch(match: Match, leaverId: string) {
  matches.delete(match.id);
  for (const id of match.players) {
    const p = players.get(id);
    if (p) p.matchId = null;
  }
  const remaining = match.other(leaverId);
  if (players.has(remaining)) io.to(remaining).emit("game:ended", "opponent-left");
}

/** Cancel every challenge that involves `playerId`, as sender or as target. */
function clearChallenges(playerId: string, notifyDeclinedBy?: Player) {
  for (const p of players.values()) {
    if (p.challenging === playerId) {
      p.challenging = null;
      if (notifyDeclinedBy) {
        io.to(p.id).emit("challenge:declined", {
          id: notifyDeclinedBy.id,
          username: notifyDeclinedBy.username,
        });
      }
    }
  }
  const self = players.get(playerId);
  if (self?.challenging) {
    io.to(self.challenging).emit("challenge:cancelled", playerId);
    self.challenging = null;
  }
}

io.use((socket, next) => {
  const raw = socket.handshake.auth?.username;
  const username = typeof raw === "string" ? raw.trim() : "";
  if (!username || username.length > MAX_USERNAME_LENGTH) {
    return next(new Error("Invalid username"));
  }
  socket.data.username = username;
  next();
});

io.on("connection", (socket) => {
  const me: Player = {
    id: socket.id,
    username: socket.data.username as string,
    matchId: null,
    challenging: null,
  };
  players.set(me.id, me);
  broadcastLobby();

  socket.on("challenge:send", (targetId) => {
    const target = players.get(targetId);
    if (!target || target.id === me.id) return;
    if (!isAvailable(me)) return socket.emit("error", "Finish what you're doing first");
    if (target.matchId) return socket.emit("error", `${target.username} is already playing`);

    me.challenging = target.id;
    io.to(target.id).emit("challenge:received", { id: me.id, username: me.username });
    broadcastLobby();
  });

  socket.on("challenge:respond", (fromId, accept) => {
    const challenger = players.get(fromId);
    // Ignore stale or forged responses.
    if (!challenger || challenger.challenging !== me.id) return;

    if (!accept || me.matchId) {
      challenger.challenging = null;
      io.to(challenger.id).emit("challenge:declined", { id: me.id, username: me.username });
      return broadcastLobby();
    }

    challenger.challenging = null;
    // Anyone else who challenged either player, or was challenged by them, is out of luck.
    clearChallenges(me.id, me);
    clearChallenges(challenger.id, challenger);

    const match = new Match(String(nextMatchId++), [challenger.id, me.id]);
    matches.set(match.id, match);
    challenger.matchId = match.id;
    me.matchId = match.id;

    sendGameState(match);
    broadcastLobby();
  });

  socket.on("game:ready", (secret) => {
    const match = matchOf(me);
    if (!match) return;
    const err = match.ready(me.id, String(secret));
    if (err) return socket.emit("error", err);
    sendGameState(match);
  });

  socket.on("game:guess", (guess) => {
    const match = matchOf(me);
    if (!match) return;
    const err = match.guess(me.id, String(guess));
    if (err) return socket.emit("error", err);
    sendGameState(match);
  });

  socket.on("game:rematch", () => {
    const match = matchOf(me);
    if (!match) return;
    match.requestRematch(me.id);
    sendGameState(match);
  });

  socket.on("game:leave", () => {
    const match = matchOf(me);
    if (!match) return;
    endMatch(match, me.id);
    broadcastLobby();
  });

  socket.on("disconnect", () => {
    const match = matchOf(me);
    if (match) endMatch(match, me.id);
    clearChallenges(me.id, me);
    players.delete(me.id);
    broadcastLobby();
  });
});

server.listen(PORT, () => {
  console.log(`server listening on ${PORT}`);
});
