import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { content, search } from "./data";

export default defineConfig({
  plugins: [react(), {
    name: "synthetic-search-api",
    configureServer(server) {
      server.middlewares.use(async (request, response, next) => {
        const url = new URL(request.url ?? "/", "http://localhost");
        if (!url.pathname.startsWith("/api/")) return next();
        if (url.pathname === "/api/live") {
          response.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" });
          response.write(": ready\n\n");
          return;
        }
        response.setHeader("Content-Type", "application/json");
        if (url.pathname === "/api/search") {
          let body = "";
          for await (const chunk of request) body += chunk;
          response.end(JSON.stringify(search(JSON.parse(body))));
        } else if (url.pathname === "/api/file-text") {
          response.end(JSON.stringify({ content: content(url.searchParams.get("path") ?? "", url.searchParams.get("version") === "old") }));
        } else if (url.pathname === "/api/search/track") {
          response.end("{}");
        } else {
          response.writeHead(503);
          response.end(JSON.stringify({ error: "Unexpected search fixture API request" }));
        }
      });
    },
  }],
  resolve: { dedupe: ["react", "react-dom"] },
  server: { host: "127.0.0.1", port: 4187, strictPort: true },
});
