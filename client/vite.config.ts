import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// In dev, Vite serves the client and proxies Socket.io to the Node server.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      "/socket.io": { target: "http://localhost:3000", ws: true },
      "/api": "http://localhost:3000",
    },
  },
});
