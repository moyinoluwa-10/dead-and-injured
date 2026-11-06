import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import {
  boolean,
  integer,
  pgTable,
  serial,
  text,
  timestamp,
  type PgDatabase,
  type PgQueryResultHKT,
} from "drizzle-orm/pg-core";
import { Pool } from "pg";

export const matches = pgTable("matches", {
  id: serial("id").primaryKey(),
  finishedAt: timestamp("finished_at", { withTimezone: true }).notNull().defaultNow(),
  winner: text("winner").notNull(),
  loser: text("loser").notNull(),
  reason: text("reason").notNull(), // "solved" | "timeout"
  winnerGuesses: integer("winner_guesses").notNull(),
  loserGuesses: integer("loser_guesses").notNull(),
  vsComputer: boolean("vs_computer").notNull().default(false),
});

/** One finished game. Names are display names: players are not authenticated. */
export interface RoundRecord {
  winner: string;
  loser: string;
  reason: "solved" | "timeout";
  winnerGuesses: number;
  loserGuesses: number;
  vsComputer: boolean;
}

export interface LeaderboardEntry {
  username: string;
  wins: number;
  losses: number;
  games: number;
}

export interface Store {
  recordRound(round: RoundRecord): Promise<void>;
  /** Top players by wins, counting only games between people. */
  leaderboard(limit: number): Promise<LeaderboardEntry[]>;
  close(): Promise<void>;
}

type Db = PgDatabase<PgQueryResultHKT>;

/** Idempotent, so it is safe to run on every start. Keep in sync with `matches` above. */
async function ensureSchema(db: Db) {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS matches (
      id SERIAL PRIMARY KEY,
      finished_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      winner TEXT NOT NULL,
      loser TEXT NOT NULL,
      reason TEXT NOT NULL,
      winner_guesses INTEGER NOT NULL,
      loser_guesses INTEGER NOT NULL,
      vs_computer BOOLEAN NOT NULL DEFAULT FALSE
    )
  `);
}

/** A store on any Drizzle Postgres database (node-postgres in production, PGlite in tests). */
export async function createStore(db: Db, close: () => Promise<void>): Promise<Store> {
  await ensureSchema(db);

  return {
    async recordRound(round) {
      await db.insert(matches).values(round);
    },

    async leaderboard(limit) {
      // Each game counts once for the winner and once for the loser. Names are
      // grouped case-insensitively so "Ada" and "ada" are the same player.
      const result = await db.execute(sql`
        SELECT
          max(name) AS username,
          count(*) FILTER (WHERE won)::int AS wins,
          count(*) FILTER (WHERE NOT won)::int AS losses,
          count(*)::int AS games
        FROM (
          SELECT lower(winner) AS key, winner AS name, TRUE AS won
            FROM matches WHERE NOT vs_computer
          UNION ALL
          SELECT lower(loser), loser, FALSE
            FROM matches WHERE NOT vs_computer
        ) AS results
        GROUP BY key
        ORDER BY wins DESC, losses ASC, username ASC
        LIMIT ${limit}
      `);
      // node-postgres and PGlite both return `{ rows }`.
      return (result as unknown as { rows: LeaderboardEntry[] }).rows;
    },

    close,
  };
}

/** Connect to Postgres using a standard connection string. */
export async function connectStore(connectionString: string): Promise<Store> {
  const pool = new Pool({
    connectionString,
    // Needed for external connection strings on hosts such as Render; internal ones don't use TLS.
    ssl: process.env.DATABASE_SSL === "true" ? { rejectUnauthorized: false } : undefined,
    max: 5,
  });
  // Fail fast if the database is unreachable.
  await pool.query("SELECT 1");
  return createStore(drizzle(pool), () => pool.end());
}
