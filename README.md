# Dead and Injured

A two-player, real-time number guessing game. Each player picks a secret number with four different digits and takes turns guessing the other's.

- **Dead**: a correct digit in the correct place.
- **Injured**: a correct digit in the wrong place.

First to get 4 dead wins.

## Features

- Lobby with challenges, **private rooms** (share a code or an invite link like `/?room=ABCD`) and a **computer opponent**
- 60-second turn timer; running out of time forfeits the game
- **Reconnect support**: a dropped connection can resume the game within 45 seconds
- Series score across rematches, both numbers revealed at the end
- Turn alerts (sound, vibration, tab title), a digit notes pad, a how-to-play dialog
- Installable as a PWA
- Optional **leaderboard** backed by Postgres (wins and losses between people; games against the computer are not counted)

## Stack

- **Server**: Node, Express, Socket.io, Zod, TypeScript (`server/`)
- **Database** (optional): Postgres via Drizzle ORM (`server/store.ts`)
- **Client**: React, Vite, Tailwind CSS v4, TypeScript (`client/`)
- **Shared**: game rules, the computer's solver and the typed socket protocol, used by both sides (`shared/`)

The server is authoritative. Secret numbers never leave it until a game is over: clients only receive their own guesses, the opponent's guesses against them, and the scored results. See [shared/protocol.ts](shared/protocol.ts) for the full event list, [server/match.ts](server/match.ts) for the game rules and [server/app.ts](server/app.ts) for sessions, rooms and the lobby.

### How sessions work

Each browser tab keeps a private token in `sessionStorage` and sends it when connecting. The server maps the token to a player, so a reconnecting socket picks up the same player, game and room. Other players only ever see a separate public id. Two tabs in one browser are two players.

## Development

```sh
npm install
npm run dev        # server on :3000, client on :5173 (proxies Socket.io)
npm test           # unit tests plus end-to-end tests against a real server
npm run typecheck
```

Open http://localhost:5173 in two tabs to play against yourself.

## Database

The game runs without a database. Set `DATABASE_URL` to a Postgres connection string and every finished game is recorded in a `matches` table (created automatically on start), and a leaderboard appears in the lobby. Live state (lobby, matches, timers) always stays in memory.

```sh
DATABASE_URL=postgres://user:pass@localhost:5432/dead_and_injured npm run dev:server
```

Set `DATABASE_SSL=true` if your host requires TLS (for example an external Render connection string). Tests use PGlite, an in-memory Postgres, so they need no setup.

Players aren't authenticated, so leaderboard entries are by display name (case-insensitive). That's fine for a casual game, but anyone can play under any name. Real accounts would be the next step if that matters.

A database problem never interrupts a game: failed writes are logged and the leaderboard endpoint returns 503.

## Production

```sh
npm run build      # builds client/dist and dist/server
npm start          # serves the client and the socket server on $PORT (default 3000)
```

`GET /health` returns `{"ok":true}` for health checks.

## Deploying to Render

The repo includes a [render.yaml](render.yaml) blueprint: create a new Blueprint on Render pointing at this repo. For the leaderboard, create a Postgres database in Render, then set the `DATABASE_URL` environment variable on the web service to the database's **internal** connection string (Blueprints prompt for it; otherwise use the service's Environment tab). Use the external string only when connecting from your own machine, together with `DATABASE_SSL=true`. Skip it to deploy without a database. Check Render's current terms for how long free databases last.

The game keeps lobby and match state in memory, so run **a single instance**, and note that a restart or redeploy ends active games. It needs a host that supports long-lived WebSocket connections (so not serverless platforms such as Vercel). On Render's free tier the service sleeps after a period of inactivity, and the first visit afterwards is slow.

## Server limits

Defined in `defaultOptions` in [server/app.ts](server/app.ts): 200 players, 80 events per socket per 10 seconds, 10 KB max message size, 60 s per turn, 45 s reconnect grace.

## CI

[.github/workflows/ci.yml](.github/workflows/ci.yml) runs the typecheck, tests and build on every push to `main` and on pull requests.
