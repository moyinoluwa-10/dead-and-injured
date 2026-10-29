import { NUMBER_LENGTH, isValidNumber, scoreGuess } from "../shared/game";
import type { GameView, GuessResult, Phase } from "../shared/protocol";

export interface MatchOptions {
  /** How long a player has to make each guess. */
  turnMs: number;
  now?: () => number;
}

export interface ViewExtras {
  opponentConnected?: boolean;
  vsComputer?: boolean;
}

/** Authoritative state for one game between two players. Secrets leave this class only when the game is over. */
export class Match {
  phase: Phase = "setup";
  private secrets = new Map<string, string>();
  private guesses = new Map<string, GuessResult[]>();
  private rematchVotes = new Set<string>();
  private wins = new Map<string, number>();
  private turn: string | null = null;
  private turnEndsAt: number | null = null;
  private winner: string | null = null;
  private endReason: GameView["endReason"] = null;
  private readonly now: () => number;

  constructor(
    readonly id: string,
    readonly players: readonly [string, string],
    private readonly opts: MatchOptions = { turnMs: 60_000 }
  ) {
    this.now = opts.now ?? Date.now;
    for (const p of players) this.wins.set(p, 0);
    this.resetRound();
  }

  get currentTurn(): string | null {
    return this.turn;
  }

  other(playerId: string): string {
    return this.players[0] === playerId ? this.players[1] : this.players[0];
  }

  hasSecret(playerId: string): boolean {
    return this.secrets.has(playerId);
  }

  /** The most recent guess `playerId` made, with its result. */
  lastGuess(playerId: string): GuessResult | undefined {
    return this.guesses.get(playerId)?.at(-1);
  }

  turnMsLeft(): number | null {
    return this.turnEndsAt === null ? null : Math.max(0, this.turnEndsAt - this.now());
  }

  /** Returns an error message, or null on success. */
  ready(playerId: string, secret: string): string | null {
    if (this.phase !== "setup") return "The game has already started";
    if (!isValidNumber(secret))
      return `Your number must be ${NUMBER_LENGTH} different digits`;
    if (this.secrets.has(playerId)) return "You are already ready";

    this.secrets.set(playerId, secret);
    if (this.secrets.size === 2) {
      this.phase = "playing";
      this.startTurn(this.players[Math.floor(Math.random() * 2)]);
    }
    return null;
  }

  guess(playerId: string, guess: string): string | null {
    if (this.phase !== "playing") return "The game is not in progress";
    if (this.turn !== playerId) return "It's not your turn";
    if (!isValidNumber(guess))
      return `A guess must be ${NUMBER_LENGTH} different digits`;

    const opponentSecret = this.secrets.get(this.other(playerId))!;
    const score = scoreGuess(opponentSecret, guess);
    this.guesses.get(playerId)!.push({ guess, ...score });

    if (score.dead === NUMBER_LENGTH) this.finish(playerId, "solved");
    else this.startTurn(this.other(playerId));
    return null;
  }

  /** The player on the clock ran out of time and forfeits. Returns false if nobody was on the clock. */
  expireTurn(): boolean {
    if (this.phase !== "playing" || this.turn === null) return false;
    this.finish(this.other(this.turn), "timeout");
    return true;
  }

  /** Returns true once both players have asked for a rematch and the round was reset. */
  requestRematch(playerId: string): boolean {
    if (this.phase !== "finished") return false;
    this.rematchVotes.add(playerId);
    if (this.rematchVotes.size < 2) return false;
    this.resetRound();
    return true;
  }

  view(playerId: string, opponentName: string, extras: ViewExtras = {}): GameView {
    const opponentId = this.other(playerId);
    const finished = this.phase === "finished";
    return {
      phase: this.phase,
      opponent: { id: opponentId, username: opponentName },
      vsComputer: extras.vsComputer ?? false,
      opponentConnected: extras.opponentConnected ?? true,
      youReady: this.secrets.has(playerId),
      opponentReady: this.secrets.has(opponentId),
      yourTurn: this.turn === playerId,
      turnMsLeft: this.turnMsLeft(),
      yourGuesses: this.guesses.get(playerId)!,
      opponentGuesses: this.guesses.get(opponentId)!,
      winner:
        this.winner === null ? null : this.winner === playerId ? "you" : "opponent",
      endReason: this.endReason,
      revealed: finished
        ? { yours: this.secrets.get(playerId)!, opponents: this.secrets.get(opponentId)! }
        : null,
      yourWins: this.wins.get(playerId)!,
      opponentWins: this.wins.get(opponentId)!,
      youWantRematch: this.rematchVotes.has(playerId),
      opponentWantsRematch: this.rematchVotes.has(opponentId),
    };
  }

  private startTurn(playerId: string) {
    this.turn = playerId;
    this.turnEndsAt = this.now() + this.opts.turnMs;
  }

  private finish(winnerId: string, reason: "solved" | "timeout") {
    this.phase = "finished";
    this.winner = winnerId;
    this.endReason = reason;
    this.turn = null;
    this.turnEndsAt = null;
    this.wins.set(winnerId, this.wins.get(winnerId)! + 1);
  }

  private resetRound() {
    this.phase = "setup";
    this.secrets.clear();
    this.rematchVotes.clear();
    this.turn = null;
    this.turnEndsAt = null;
    this.winner = null;
    this.endReason = null;
    for (const p of this.players) this.guesses.set(p, []);
  }
}
