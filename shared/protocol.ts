import type { Score } from "./game";

export type PlayerStatus = "available" | "pending" | "hosting" | "playing";

export interface PlayerInfo {
  id: string;
  username: string;
  status: PlayerStatus;
}

export interface GuessResult extends Score {
  guess: string;
}

export type Phase = "setup" | "playing" | "finished";

/** Everything a client needs to render a game. The opponent's secret is only revealed once the game is over. */
export interface GameView {
  phase: Phase;
  opponent: { id: string; username: string };
  vsComputer: boolean;
  opponentConnected: boolean;
  youReady: boolean;
  opponentReady: boolean;
  yourTurn: boolean;
  /** Milliseconds left to make the current guess, or null when nobody is on the clock. */
  turnMsLeft: number | null;
  /** Your guesses at the opponent's number, with results. */
  yourGuesses: GuessResult[];
  /** Opponent's guesses at your number, with results. */
  opponentGuesses: GuessResult[];
  winner: "you" | "opponent" | null;
  endReason: "solved" | "timeout" | null;
  /** Both secrets, only once the game is finished. */
  revealed: { yours: string; opponents: string } | null;
  /** Series score across rematches. */
  yourWins: number;
  opponentWins: number;
  youWantRematch: boolean;
  opponentWantsRematch: boolean;
}

export interface ClientToServerEvents {
  "challenge:send": (targetId: string) => void;
  "challenge:respond": (fromId: string, accept: boolean) => void;
  "room:create": () => void;
  "room:cancel": () => void;
  "room:join": (code: string) => void;
  "bot:start": () => void;
  "game:ready": (secret: string) => void;
  "game:guess": (guess: string) => void;
  "game:rematch": () => void;
  "game:leave": () => void;
}

export interface ServerToClientEvents {
  /** Sent on every (re)connection. `resumed` is false when the server did not recognise the session. */
  "session:hello": (info: { playerId: string; resumed: boolean }) => void;
  "lobby:players": (players: PlayerInfo[]) => void;
  "challenge:received": (from: { id: string; username: string }) => void;
  "challenge:cancelled": (fromId: string) => void;
  "challenge:declined": (by: { id: string; username: string }) => void;
  "room:created": (code: string) => void;
  "room:closed": () => void;
  "game:state": (view: GameView) => void;
  "game:ended": (reason: "opponent-left") => void;
  error: (message: string) => void;
}

export const MAX_USERNAME_LENGTH = 20;
export const ROOM_CODE_LENGTH = 4;
