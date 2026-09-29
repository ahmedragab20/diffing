import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { PrSession } from "./pr-session.js";

const execFileAsync = promisify(execFile);
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const MAX_REDIRECTS = 3;

async function readHostToken(host: string): Promise<string | undefined> {
  try {
    // Let gh select the host's active account and environment/keyring token.
    const { stdout } = await execFileAsync(
      "gh",
      ["auth", "token", "--hostname", host],
      { encoding: "utf-8", timeout: 5_000, maxBuffer: 16 * 1024 },
    );
    return stdout.trim() || undefined;
  } catch {
    // Public avatars still work without gh auth. Never expose CLI token output.
    return undefined;
  }
}

/** Fetch an avatar already allowlisted by the active PR session. */
export async function fetchPrAvatar(
  avatar: URL,
  session: Pick<PrSession, "url" | "host">,
): Promise<Response> {
  const prOrigin = new URL(session.url);
  if (session.host) prOrigin.host = session.host;
  const isolatedAvatarOrigin = new URL(prOrigin);
  isolatedAvatarOrigin.hostname = `avatars.${prOrigin.hostname}`;
  const allowedOrigins = new Set([
    avatar.origin,
    prOrigin.origin,
    isolatedAvatarOrigin.origin,
    "https://avatars.githubusercontent.com",
  ]);
  const signal = AbortSignal.timeout(15_000);
  let current = avatar;
  let token: Promise<string | undefined> | undefined;

  for (let redirects = 0; ; redirects++) {
    if (
      !["http:", "https:"].includes(current.protocol) ||
      current.username || current.password
    ) {
      throw new Error("Invalid avatar URL");
    }
    // Credentials belong only to the PR's HTTPS origin, never its avatar CDN
    // or an arbitrary host from an avatar URL or redirect.
    const authorization = current.protocol === "https:" && current.origin === prOrigin.origin
      ? await (token ??= readHostToken(prOrigin.host))
      : undefined;
    const response = await fetch(current, {
      redirect: "manual",
      signal,
      ...(authorization ? { headers: { Authorization: `Bearer ${authorization}` } } : {}),
    });
    if (!REDIRECT_STATUSES.has(response.status)) return response;
    await response.body?.cancel();
    const location = response.headers.get("location");
    if (!location || redirects >= MAX_REDIRECTS) {
      throw new Error("Avatar redirect could not be followed");
    }
    const next = new URL(location, current);
    if (
      !allowedOrigins.has(next.origin) ||
      (current.protocol === "https:" && next.protocol !== "https:")
    ) {
      throw new Error("Avatar redirect is not trusted");
    }
    current = next;
  }
}
