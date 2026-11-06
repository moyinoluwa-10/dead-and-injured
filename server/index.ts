import { createGameServer } from "./app";
import { connectStore, type Store } from "./store";

const PORT = Number(process.env.PORT) || 3000;

// Last-resort safety net. Handlers and timers are already guarded individually; this
// keeps one unforeseen error from ending every game in progress. The server stays up
// because its state is only in memory, so a restart would lose all of it.
process.on("uncaughtException", (err) => console.error("uncaught exception", err));
process.on("unhandledRejection", (reason) => console.error("unhandled rejection", reason));

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

  const clientIpHeader = process.env.CLIENT_IP_HEADER || undefined;
  if (clientIpHeader) console.log(`using the ${clientIpHeader} header for per-address limits`);

  const { server, close } = createGameServer({ store, clientIpHeader });
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
