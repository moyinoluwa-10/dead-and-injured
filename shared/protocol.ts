import type { Score } from "./game";

export type PlayerStatus = "available" | "pending" | "playing";

export interface PlayerInfo {
  id: string;
  username: string;
  status: PlayerStatus;
}

export interface GuessResult extends Score {
  guess: string;
}

export type Phase = "setup" | "playing" | "finished";

/** Everything a client needs to render a game. Never contains the opponent's secret. */
export interface GameView {
  phase: Phase;
  opponent: { id: string; username: string };
  youReady: boolean;
  opponentReady: boolean;
  yourTurn: boolean;
  /** Your guesses at the opponent's number, with results. */
  yourGuesses: GuessResult[];
  /** Opponent's guesses at your number, with results. */
  opponentGuesses: GuessResult[];
  winner: "you" | "opponent" | null;
  youWantRematch: boolean;
  opponentWantsRematch: boolean;
}

export interface ClientToServerEvents {
  "challenge:send": (targetId: string) => void;
  "challenge:respond": (fromId: string, accept: boolean) => void;
  "game:ready": (secret: string) => void;
  "game:guess": (guess: string) => void;
  "game:rematch": () => void;
  "game:leave": () => void;
}

export interface ServerToClientEvents {
  "lobby:players": (players: PlayerInfo[]) => void;
  "challenge:received": (from: { id: string; username: string }) => void;
  "challenge:cancelled": (fromId: string) => void;
  "challenge:declined": (by: { id: string; username: string }) => void;
  "game:state": (view: GameView) => void;
  "game:ended": (reason: "opponent-left") => void;
  error: (message: string) => void;
}

export const MAX_USERNAME_LENGTH = 20;
