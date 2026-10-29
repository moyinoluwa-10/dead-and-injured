import { useCallback, useEffect, useRef, useState } from "react";
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

/** Owns the socket connection and exposes the server's state as plain React state. */
export function useSession(username: string) {
  const socketRef = useRef<GameSocket | null>(null);
  const [connected, setConnected] = useState(false);
  const [myId, setMyId] = useState<string | null>(null);
  const [players, setPlayers] = useState<PlayerInfo[]>([]);
  const [incoming, setIncoming] = useState<Challenger[]>([]);
  const [game, setGame] = useState<GameView | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    const socket: GameSocket = io({ auth: { username } });
    socketRef.current = socket;

    socket.on("connect", () => {
      setConnected(true);
      setMyId(socket.id ?? null);
    });
    socket.on("disconnect", () => {
      setConnected(false);
      setGame(null);
      setIncoming([]);
    });
    socket.on("connect_error", (err) => setNotice(err.message));

    socket.on("lobby:players", setPlayers);
    socket.on("challenge:received", (from) =>
      setIncoming((list) => (list.some((c) => c.id === from.id) ? list : [...list, from]))
    );
    socket.on("challenge:cancelled", (fromId) =>
      setIncoming((list) => list.filter((c) => c.id !== fromId))
    );
    socket.on("challenge:declined", (by) => setNotice(`${by.username} declined your challenge`));
    socket.on("game:state", (view) => {
      setGame(view);
      setIncoming([]);
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

  const challenge = useCallback((id: string) => socketRef.current?.emit("challenge:send", id), []);
  const respond = useCallback((id: string, accept: boolean) => {
    socketRef.current?.emit("challenge:respond", id, accept);
    setIncoming((list) => list.filter((c) => c.id !== id));
  }, []);
  const ready = useCallback((secret: string) => socketRef.current?.emit("game:ready", secret), []);
  const guess = useCallback((value: string) => socketRef.current?.emit("game:guess", value), []);
  const rematch = useCallback(() => socketRef.current?.emit("game:rematch"), []);
  const leave = useCallback(() => {
    socketRef.current?.emit("game:leave");
    setGame(null);
  }, []);
  const dismissNotice = useCallback(() => setNotice(null), []);

  const me = players.find((p) => p.id === myId);

  return {
    connected,
    myId,
    myStatus: me?.status ?? "available",
    others: players.filter((p) => p.id !== myId),
    incoming,
    game,
    notice,
    actions: { challenge, respond, ready, guess, rematch, leave, dismissNotice },
  };
}
