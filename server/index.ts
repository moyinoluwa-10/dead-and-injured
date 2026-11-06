import { createGameServer } from "./app";
import { connectStore, type Store } from "./store";

const PORT = Number(process.env.PORT) || 3000;

async function main() {
  let store: Store | undefined;
  if (process.env.DATABASE_URL) {
    try {
      store = await connectStore(process.env.DATABASE_URL);
      console.log("connected to the database");
    } catch (err) {
      // The game works without a database; it just has no leaderboard.
      console.error("could not connect to the database, continuing without one", err);
    }
  } else {
    console.log("DATABASE_URL not set, leaderboard disabled");
  }

  const { server, close } = createGameServer({ store });
  server.listen(PORT, () => console.log(`server listening on ${PORT}`));

  const shutdown = async () => {
    await close();
    await store?.close();
    process.exit(0);
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}

void main();
