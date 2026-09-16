// @vitest-environment node
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { tmpdir } from "node:os"
import { spawn, type ChildProcess } from "node:child_process"
import { afterEach, describe, expect, it } from "vitest"
import { ReviewOwner, ReviewOwnershipError } from "../review-owner.js"

const directories = new Set<string>()
const children = new Set<ChildProcess>()
const owners = new Set<ReviewOwner>()
async function acquire(directory: string) {
  const owner = await ReviewOwner.acquire(directory)
  owners.add(owner)
  return owner
}

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "diffing-review-owner-"))
  directories.add(directory)
  return directory
}

async function expectOwnershipError(action: Promise<unknown>, code: ReviewOwnershipError["code"]): Promise<void> {
  await expect(action).rejects.toMatchObject({ code })
}

async function waitForReady(child: ChildProcess): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    let output = ""
    const onData = (chunk: Buffer | string) => {
      output += chunk.toString()
      if (output.split(/\r?\n/).includes("READY")) {
        cleanup()
        resolve()
      }
    }
    const onExit = (code: number | null, signal: NodeJS.Signals | null) => {
      cleanup()
      reject(new Error(`child exited before READY (code=${code}, signal=${signal}, output=${output})`))
    }
    const onError = (error: Error) => {
      cleanup()
      reject(error)
    }
    const timer = setTimeout(() => {
      cleanup()
      reject(new Error(`timed out waiting for READY (output=${output})`))
    }, 5_000)
    const cleanup = () => {
      clearTimeout(timer)
      child.stdout?.off("data", onData)
      child.off("exit", onExit)
      child.off("error", onError)
    }
    child.stdout?.on("data", onData)
    child.once("exit", onExit)
    child.once("error", onError)
  })
}

async function waitForExit(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Child did not exit within 5 seconds")), 5_000)
    child.once("exit", () => { clearTimeout(timer); resolve() })
    child.once("error", (error) => { clearTimeout(timer); reject(error) })
  })
}

afterEach(async () => {
  await Promise.all([...owners].map((owner) => owner.close()))
  owners.clear()
  for (const child of children) {
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL")
    await waitForExit(child).catch(() => {})
  }
  children.clear()
  await Promise.all([...directories].map((directory) => rm(directory, { recursive: true, force: true })))
  directories.clear()
})

describe("ReviewOwner", () => {
  it("rejects a second owner, permits independent directories, and reacquires after close", async () => {
    const firstDirectory = await temporaryDirectory()
    const secondDirectory = await temporaryDirectory()
    const first = await acquire(firstDirectory)
    const independent = await acquire(secondDirectory)

    await expectOwnershipError(ReviewOwner.acquire(firstDirectory), "owner_busy")

    await first.close()
    const reacquired = await acquire(firstDirectory)

    await independent.close()
    await reacquired.close()
  })

  it("throws owner_closed when asserting ownership after close", async () => {
    const directory = await temporaryDirectory()
    const owner = await acquire(directory)
    await owner.close()

    expect(() => owner.assertOwned()).toThrowError(new ReviewOwnershipError("owner_closed"))
  })

  it.each([
    ["corrupt JSON", Buffer.from("{not-json\n", "utf8")],
    ["unknown version", Buffer.from(JSON.stringify({ version: 99, port: 12345 }), "utf8")],
  ])("preserves %s owner records and rejects them", async (_name, bytes) => {
    const directory = await temporaryDirectory()
    const record = join(directory, "owner.json")
    await writeFile(record, bytes)

    await expectOwnershipError(ReviewOwner.acquire(directory), "invalid_owner")
    expect(await readFile(record)).toEqual(bytes)
  })

  it("holds ownership across processes and preserves the record after the owner dies", async () => {
    const directory = await temporaryDirectory()
    const moduleUrl = pathToFileURL(fileURLToPath(new URL("../review-owner.ts", import.meta.url))).href
    const code = `import { ReviewOwner } from ${JSON.stringify(moduleUrl)};
const owner = await ReviewOwner.acquire(process.argv[1]);
process.stdout.write("READY\\n");
await new Promise(() => {});`
    const child = spawn(process.execPath, ["--import", "tsx", "--input-type=module", "-e", code, directory], {
      stdio: ["ignore", "pipe", "pipe"],
    })
    children.add(child)
    await waitForReady(child)
    const bytesBefore = await readFile(join(directory, "owner.json"))

    await expectOwnershipError(ReviewOwner.acquire(directory), "owner_busy")
    child.kill("SIGKILL")
    await waitForExit(child)

    const owner = await acquire(directory)
    expect(await readFile(join(directory, "owner.json"))).toEqual(bytesBefore)
    await owner.close()
  })

  it.skipIf(process.platform === "win32")("does not steal a paused owner", async () => {
    const directory = await temporaryDirectory()
    const moduleUrl = pathToFileURL(fileURLToPath(new URL("../review-owner.ts", import.meta.url))).href
    const code = `import { ReviewOwner } from ${JSON.stringify(moduleUrl)};
await ReviewOwner.acquire(process.argv[1]);
process.stdout.write("READY\\n");
await new Promise(() => {});`
    const child = spawn(process.execPath, ["--import", "tsx", "--input-type=module", "-e", code, directory], {
      stdio: ["ignore", "pipe", "pipe"],
    })
    children.add(child)
    await waitForReady(child)
    child.kill("SIGSTOP")
    await expectOwnershipError(ReviewOwner.acquire(directory), "owner_busy")
    child.kill("SIGCONT")
    child.kill("SIGKILL")
    await waitForExit(child)
  })
})
