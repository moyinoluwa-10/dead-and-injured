import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { io, type Socket } from "socket.io-client";
import type {
  ClientToServerEvents,
  GameView,
  PlayerInfo,
  ServerToClientEvents,
} from "../../shared/protocol";

type GameSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

export interface Challenger {
  id: string;
  username: string;
}

const TOKEN_KEY = "session-token";

/**
 * A per-tab secret that lets the server recognise this player after a dropped
 * connection. sessionStorage keeps two tabs of the same browser as separate players.
 */
function sessionToken(): string {
  try {
    const existing = sessionStorage.getItem(TOKEN_KEY);
    if (existing) return existing;
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    const token = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
    sessionStorage.setItem(TOKEN_KEY, token);
    return token;
  } catch {
    return Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
  }
}

/** Owns the socket connection and exposes the server's state as plain React state. */
export function useSession(username: string) {
  const socketRef = useRef<GameSocket | null>(null);
  const [connected, setConnected] = useState(false);
  const [myId, setMyId] = useState<string | null>(null);
  const [players, setPlayers] = useState<PlayerInfo[]>([]);
  const [incoming, setIncoming] = useState<Challenger[]>([]);
  const [game, setGame] = useState<GameView | null>(null);
  const [roomCode, setRoomCode] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    const socket: GameSocket = io({ auth: { username, token: sessionToken() } });
    socketRef.current = socket;

    socket.on("connect", () => setConnected(true));
    // Keep the game on screen while the socket reconnects; the server restores it.
    socket.on("disconnect", () => setConnected(false));
    socket.on("connect_error", (err) => setNotice(err.message));

    socket.on("session:hello", ({ playerId, resumed }) => {
      setMyId(playerId);
      if (!resumed) {
        // The server doesn't know us any more (e.g. it restarted), so local state is stale.
        setGame(null);
        setIncoming([]);
        setRoomCode(null);
      }
    });
    socket.on("lobby:players", setPlayers);
    socket.on("challenge:received", (from) =>
      setIncoming((list) => (list.some((c) => c.id === from.id) ? list : [...list, from]))
    );
    socket.on("challenge:cancelled", (fromId) =>
      setIncoming((list) => list.filter((c) => c.id !== fromId))
    );
    socket.on("challenge:declined", (by) => setNotice(`${by.username} declined your challenge`));
    socket.on("room:created", setRoomCode);
    socket.on("room:closed", () => setRoomCode(null));
    socket.on("game:state", (view) => {
      setGame(view);
      setIncoming([]);
      setRoomCode(null);
    });
    socket.on("game:ended", () => {
      setGame(null);
      setNotice("Your opponent left the game");
    });
    socket.on("error", setNotice);

    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
  }, [username]);

  const emit = useCallback(
    <E extends keyof ClientToServerEvents>(
      event: E,
      ...args: Parameters<ClientToServerEvents[E]>
    ) => {
      (socketRef.current?.emit as (e: E, ...a: unknown[]) => void)(event, ...args);
    },
    []
  );

  const actions = useMemo(
    () => ({
      challenge: (id: string) => emit("challenge:send", id),
      respond: (id: string, accept: boolean) => {
        emit("challenge:respond", id, accept);
        setIncoming((list) => list.filter((c) => c.id !== id));
      },
      cancelChallenge: () => emit("challenge:cancel"),
      createRoom: () => emit("room:create"),
      cancelRoom: () => emit("room:cancel"),
      joinRoom: (code: string) => emit("room:join", code),
      playComputer: () => emit("bot:start"),
      ready: (secret: string) => emit("game:ready", secret),
      guess: (value: string) => emit("game:guess", value),
      rematch: () => emit("game:rematch"),
      leave: () => {
        emit("game:leave");
        setGame(null);
      },
      dismissNotice: () => setNotice(null),
    }),
    [emit]
  );

  const me = players.find((p) => p.id === myId);

  return {
    connected,
    myStatus: me?.status ?? "available",
    others: players.filter((p) => p.id !== myId && p.status !== "hosting"),
    incoming,
    game,
    roomCode,
    notice,
    actions,
  };
}
