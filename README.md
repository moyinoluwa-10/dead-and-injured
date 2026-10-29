# Dead and Injured

A two-player, real-time number guessing game. Each player picks a secret number with four different digits and takes turns guessing the other's.

- **Dead**: a correct digit in the correct place.
- **Injured**: a correct digit in the wrong place.

First to get 4 dead wins.

## Stack

- **Server**: Node, Express, Socket.io, TypeScript (`server/`)
- **Client**: React, Vite, Tailwind CSS v4, TypeScript (`client/`)
- **Shared**: game rules and the typed socket protocol, used by both sides (`shared/`)

The server is authoritative. Secret numbers never leave it: clients only ever receive their own guesses, the opponent's guesses against them, and the scored results. See [shared/protocol.ts](shared/protocol.ts) for the full event list and [server/match.ts](server/match.ts) for the game rules.

## Development

```sh
npm install
npm run dev      # server on :3000, client on :5173 (proxies Socket.io)
npm test         # game rules and match logic
npm run typecheck
```

Open http://localhost:5173 in two tabs to play against yourself.

## Production

```sh
npm run build    # builds client/dist and dist/server
npm start        # serves the client and the socket server on $PORT (default 3000)
```

## Deploying to Render

The repo includes a [render.yaml](render.yaml) blueprint: create a new Blueprint on Render pointing at this repo.

The game keeps lobby and match state in memory, so run **a single instance**. It needs a host that supports long-lived WebSocket connections (so not serverless platforms such as Vercel). On Render's free tier the service sleeps after a period of inactivity, and the first visit afterwards is slow.
