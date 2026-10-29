import { NUMBER_LENGTH, isValidNumber, scoreGuess } from "../shared/game";
import type { GameView, GuessResult, Phase } from "../shared/protocol";

/** Authoritative state for one game between two players. Secrets never leave this class. */
export class Match {
  phase: Phase = "setup";
  private secrets = new Map<string, string>();
  private guesses = new Map<string, GuessResult[]>();
  private rematchVotes = new Set<string>();
  private turn: string | null = null;
  private winner: string | null = null;

  constructor(
    readonly id: string,
    readonly players: readonly [string, string]
  ) {
    this.resetRound();
  }

  other(playerId: string): string {
    return this.players[0] === playerId ? this.players[1] : this.players[0];
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
      this.turn = this.players[Math.floor(Math.random() * 2)];
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

    if (score.dead === NUMBER_LENGTH) {
      this.phase = "finished";
      this.winner = playerId;
      this.turn = null;
    } else {
      this.turn = this.other(playerId);
    }
    return null;
  }

  /** Returns true once both players have asked for a rematch and the round was reset. */
  requestRematch(playerId: string): boolean {
    if (this.phase !== "finished") return false;
    this.rematchVotes.add(playerId);
    if (this.rematchVotes.size < 2) return false;
    this.resetRound();
    return true;
  }

  view(playerId: string, opponentName: string): GameView {
    const opponentId = this.other(playerId);
    return {
      phase: this.phase,
      opponent: { id: opponentId, username: opponentName },
      youReady: this.secrets.has(playerId),
      opponentReady: this.secrets.has(opponentId),
      yourTurn: this.turn === playerId,
      yourGuesses: this.guesses.get(playerId)!,
      opponentGuesses: this.guesses.get(opponentId)!,
      winner:
        this.winner === null ? null : this.winner === playerId ? "you" : "opponent",
      youWantRematch: this.rematchVotes.has(playerId),
      opponentWantsRematch: this.rematchVotes.has(opponentId),
    };
  }

  private resetRound() {
    this.phase = "setup";
    this.secrets.clear();
    this.rematchVotes.clear();
    this.turn = null;
    this.winner = null;
    for (const p of this.players) this.guesses.set(p, []);
  }
}
