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

## Stack

- **Server**: Node, Express, Socket.io, Zod, TypeScript (`server/`)
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

## Production

```sh
npm run build      # builds client/dist and dist/server
npm start          # serves the client and the socket server on $PORT (default 3000)
```

`GET /health` returns `{"ok":true}` for health checks.

## Deploying to Render

The repo includes a [render.yaml](render.yaml) blueprint: create a new Blueprint on Render pointing at this repo.

The game keeps lobby and match state in memory, so run **a single instance**, and note that a restart or redeploy ends active games. It needs a host that supports long-lived WebSocket connections (so not serverless platforms such as Vercel). On Render's free tier the service sleeps after a period of inactivity, and the first visit afterwards is slow.

## Server limits

Defined in `defaultOptions` in [server/app.ts](server/app.ts): 200 players, 80 events per socket per 10 seconds, 10 KB max message size, 60 s per turn, 45 s reconnect grace.

## CI

[.github/workflows/ci.yml](.github/workflows/ci.yml) runs the typecheck, tests and build on every push to `main` and on pull requests.
