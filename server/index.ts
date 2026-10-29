import { createGameServer } from "./app";

const PORT = Number(process.env.PORT) || 3000;

const { server } = createGameServer();

server.listen(PORT, () => {
  console.log(`server listening on ${PORT}`);
});
