import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { createStore, type Store } from "./store";

/** A real Postgres (in-memory, via PGlite) for tests; excluded from the production build. */
export async function createMemoryStore(): Promise<Store> {
  const client = new PGlite();
  return createStore(drizzle(client), () => client.close());
}
