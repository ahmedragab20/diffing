import { randomUUID } from "node:crypto";
import { link, mkdir, open, readFile, unlink } from "node:fs/promises";
import { createServer, type Server } from "node:net";
import { dirname, join } from "node:path";
import { z } from "zod";

export class ReviewOwnershipError extends Error {
  constructor(readonly code: "owner_busy" | "invalid_owner" | "owner_closed") {
    super(code);
  }
}

const ownerSchema = z.object({ version: z.literal(1), port: z.number().int().min(1).max(65535) }).strict();

export async function syncDirectory(path: string): Promise<void> {
  const handle = await open(path, "r");
  try { await handle.sync(); } finally { await handle.close(); }
}

async function bind(port: number): Promise<Server> {
  const server = createServer((socket) => socket.destroy());
  await new Promise<void>((resolve, reject) => {
    const onError = (error: NodeJS.ErrnoException) => {
      reject(error.code === "EADDRINUSE" ? new ReviewOwnershipError("owner_busy") : error);
    };
    server.once("error", onError);
    server.listen({ host: "127.0.0.1", port, exclusive: true }, () => {
      server.removeListener("error", onError);
      resolve();
    });
  });
  return server;
}

/**
 * Local-host writer ownership held by the kernel for the writer's lifetime.
 * The immutable port record is published with an exclusive hard link. No stale
 * PID files, timeout takeover, or unlink-and-replace race is involved. A paused
 * owner retains its socket; a dead process cannot retain it or resume writing.
 * An unrelated process occupying the saved port causes a safe availability error.
 * This is for local storage on one host, not a distributed-filesystem lock.
 */
export class ReviewOwner {
  private closed = false;
  private constructor(private readonly server: Server) {
    server.on("error", () => { this.closed = true; });
    server.on("close", () => { this.closed = true; });
  }

  static async acquire(directory: string): Promise<ReviewOwner> {
    return this.acquireRecord(directory, true);
  }

  /** A process-lifetime exclusion lock, not a durable data acknowledgement.
   * If power loss removes its record, no pre-crash process can retain the port.
   * This avoids directory-fsync requirements for classic-store coordination. */
  static async acquireEphemeral(directory: string): Promise<ReviewOwner> {
    return this.acquireRecord(directory, false);
  }

  private static async acquireRecord(directory: string, durable: boolean): Promise<ReviewOwner> {
    const created = await mkdir(directory, { recursive: true });
    if (created && durable) {
      // Persist each new directory entry, including the review namespace itself.
      let parent = directory;
      for (;;) {
        await syncDirectory(parent);
        if (parent === dirname(created)) break;
        const next = dirname(parent);
        if (next === parent) break;
        parent = next;
      }
    }
    const record = join(directory, "owner.json");
    try {
      const parsed = ownerSchema.safeParse(JSON.parse(await readFile(record, "utf8")));
      if (!parsed.success) throw new ReviewOwnershipError("invalid_owner");
      return new ReviewOwner(await bind(parsed.data.port));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        if (error instanceof SyntaxError) throw new ReviewOwnershipError("invalid_owner");
        throw error;
      }
    }
    const server = await bind(0);
    const address = server.address();
    if (!address || typeof address === "string") throw new ReviewOwnershipError("invalid_owner");
    const temporary = join(directory, `.owner-${randomUUID()}`);
    try {
      const handle = await open(temporary, "wx", 0o600);
      try {
        await handle.writeFile(JSON.stringify({ version: 1, port: address.port }));
        await handle.sync();
      } finally { await handle.close(); }
      try {
        await link(temporary, record);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
        await new Promise<void>((resolve) => server.close(() => resolve()));
        return await ReviewOwner.acquireRecord(directory, durable);
      }
      if (durable) await syncDirectory(directory);
      return new ReviewOwner(server);
    } catch (error) {
      if (server.listening) await new Promise<void>((resolve) => server.close(() => resolve()));
      throw error;
    } finally {
      await unlink(temporary).catch(() => {});
    }
  }

  assertOwned(): void {
    if (this.closed || !this.server.listening) throw new ReviewOwnershipError("owner_closed");
  }

  async close(): Promise<void> {
    if (!this.server.listening) return;
    this.closed = true;
    await new Promise<void>((resolve, reject) => this.server.close((error) => error ? reject(error) : resolve()));
  }
}
