import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Real application entry, real backend (see server.mjs) — no synthetic API.
export default defineConfig({
  plugins: [react()],
  resolve: { dedupe: ["react", "react-dom"] },
  server: {
    host: "127.0.0.1",
    port: 4193,
    strictPort: true,
    proxy: { "/api": "http://127.0.0.1:4194" },
  },
});
