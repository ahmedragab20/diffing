import { parseArgs } from "node:util";
import { startDurableReview } from "./lib/review-launch.js";

export async function runReviewCoreCommand(args: string[]): Promise<void> {
  const { values, positionals } = parseArgs({ args, allowPositionals: true, strict: true, options: {
    adopt: { type: "boolean" }, port: { type: "string" }, help: { type: "boolean", short: "h" },
  } });
  if (values.help) {
    console.log(`Usage: diffing review-core serve [--adopt] [--port <number>]

Start an experimental, loopback-only durable review API in this worktree.
First adoption requires --adopt and stopped classic/older diffing sessions.
Original comments, plans and viewed files are archived without rewriting them;
classic writers remain fenced after shutdown. This command has no browser UI.

Outputs paths to separate private human and agent connection files. Give an
integration only the agent file. Credentials expire after 24 hours or shutdown;
restart reconnects to the same durable review with new credentials.
Ctrl-C stops the server and removes its connection files.`);
    return;
  }
  if (positionals.length !== 1 || positionals[0] !== "serve") throw new Error("Usage: diffing review-core serve [--adopt] [--port <number>]");
  if (values.port !== undefined && !/^\d+$/.test(values.port)) throw new Error("--port must be an integer between 1 and 65535.");
  const launched = await startDurableReview({ adopt: values.adopt, port: values.port === undefined ? undefined : Number(values.port) });
  const { close, ...connectionPaths } = launched;
  await new Promise<void>((resolve, reject) => {
    let stopping = false;
    const stop = () => {
      if (stopping) return;
      stopping = true;
      process.off("SIGINT", stop);
      process.off("SIGTERM", stop);
      close().then(resolve, reject);
    };
    process.on("SIGINT", stop);
    process.on("SIGTERM", stop);
    console.log(JSON.stringify(connectionPaths));
  });
}
