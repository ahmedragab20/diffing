import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { commits, fullPatch, headSha, patches, session } from "./data";

// Synthetic API, real application entry point. Never proxies GitHub or a live session.
export default defineConfig({
  plugins: [
    react(),
    {
      name: "pr-review-fixture",
      configureServer(server) {
        let uiState: Record<string, unknown> = {};
        let viewed: string[] = [];
        let localMode = false;
        server.middlewares.use(async (request, response, next) => {
          const url = new URL(request.url ?? "/", "http://localhost");
          if (!url.pathname.startsWith("/api/")) return next();
          if (url.pathname === "/api/live") {
            response.writeHead(200, {
              "Content-Type": "text/event-stream",
              "Cache-Control": "no-cache",
            });
            response.write(": ready\n\n");
            return;
          }
          response.setHeader("Content-Type", "application/json");
          const send = (data: unknown) => response.end(JSON.stringify(data));
          let body = "";
          for await (const chunk of request) body += chunk;
          const input = body ? JSON.parse(body) : {};
          if (url.pathname === "/api/test/reset") {
            uiState = {};
            viewed = [];
            localMode = Boolean(input.local);
            return send({});
          }
          if (url.pathname === "/api/ui-state") {
            if (request.method === "PUT") Object.assign(uiState, input);
            return send(uiState);
          }
          if (url.pathname === "/api/settings")
            return send({
              theme: "rose-pine",
              diffStyle: "unified",
              fontSize: 13,
              uiFont: "Inter",
              monoFont: "JetBrains Mono",
              haptics: false,
              sounds: false,
            });
          if (url.pathname === "/api/gh/session") return send(localMode ? {prMode:false} : session);
          if (url.pathname === "/api/diff") return send({ patch: fullPatch, prHeadSha: headSha, prMergeBaseSha: session.baseSha, layers: [{kind:"working",patch:fullPatch,source:{kind:"working"}}] });
          if (url.pathname === "/api/code-intel/capabilities") return send({configured:true,extensions:["ts","tsx"]});
          if (url.pathname === "/api/code-intel") {
            if (input.op === "hover") return send({available:true,op:"hover",hover:`Type information (${input.source?.kind ?? "default"} / ${input.side})`});
            if (input.op === "definition") return send({available:true,op:"definition",locations:[{path:input.path,line:1,character:0,endLine:1,endCharacter:6,inRepository:true}]});
            return send({available:true,op:input.op,signatures:[],highlights:[]});
          }
          if (url.pathname === "/api/code-intel/file") return send({content:"export function review() {\n  return session;\n}\n"});
          if (url.pathname === "/api/comments" || url.pathname === "/api/plans") return send([]);
          if (url.pathname === "/api/merge-status") return send({inMerge:false,conflicts:[]});
          if (url.pathname === "/api/review/status") return send({waiting:false});
          if (url.pathname === "/api/gh/commits")
            return send({ commits, headSha, total: 3, complete: true });
          const match = url.pathname.match(
            /^\/api\/gh\/commits\/([a-f0-9]+)\/diff$/
          );
          if (match)
            return send({ sha: match[1], headSha, patch: patches[match[1]] });
          if (url.pathname === "/api/gh/pr-session/comments") return send([]);
          if (url.pathname === "/api/gh/comments/sync")
            return send({ ok: true });
          if (url.pathname === "/api/gh/checks")
            return send({
              checks: [{ name: "Tests", state: "success" }],
              summary: { total: 1, success: 1, failure: 0, pending: 0 },
            });
          if (url.pathname === "/api/viewed") {
            if (request.method === "PUT")
              viewed = input.viewed
                ? [...new Set([...viewed, input.filePath])]
                : viewed.filter((path) => path !== input.filePath);
            return send(viewed);
          }
          if (url.pathname === "/api/ai/connections")
            return send({ connections: [] });
          if (url.pathname === "/api/ai/models") return send({ models: [] });
          response.statusCode = 503;
          send({ error: `Unexpected PR fixture API request: ${url.pathname}` });
        });
      },
    },
  ],
  resolve: { dedupe: ["react", "react-dom"] },
  server: { host: "127.0.0.1", port: 4188, strictPort: true },
});
