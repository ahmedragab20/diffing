#!/usr/bin/env node

import { setTimeout as sleep } from 'node:timers/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

// npm publish can succeed while its asynchronous processing still hides the
// version. Poll the same install metadata npm consumes, before testing install.
export async function waitForNpmVersion({
  packageName = 'diffing',
  version,
  timeoutMs = 20 * 60_000,
  pollMs = 15_000,
  requestTimeoutMs = 20_000,
}, dependencies = {}) {
  if (typeof version !== 'string' || !version.trim() ||
      typeof packageName !== 'string' || !packageName.trim()) {
    throw new Error('A package name and exact version are required')
  }
  for (const [name, value] of Object.entries({ timeoutMs, pollMs, requestTimeoutMs })) {
    if (!Number.isFinite(value) || value <= 0) throw new Error(`${name} must be positive`)
  }
  const request = dependencies.fetch ?? globalThis.fetch
  const now = dependencies.now ?? (() => performance.now())
  const pause = dependencies.sleep ?? sleep
  const log = dependencies.log ?? console.log
  const started = now()
  const deadline = started + timeoutMs
  const url = `https://registry.npmjs.org/${encodeURIComponent(packageName)}`
  let lastStatus = 'not requested'

  while (now() < deadline) {
    let response
    let metadata
    try {
      response = await request(url, {
        headers: {
          accept: 'application/vnd.npm.install-v1+json',
          'cache-control': 'no-cache',
        },
        signal: AbortSignal.timeout(Math.max(1, Math.ceil(Math.min(requestTimeoutMs, deadline - now())))),
      })
      if (response.ok) metadata = await response.json()
      else await response.body?.cancel()
    } catch (error) {
      if (!(error instanceof TypeError) && error?.name !== 'TimeoutError' && error?.name !== 'AbortError') throw error
      response = undefined
      lastStatus = `registry request failed: ${error.message}`
    }

    if (response?.ok) {
      if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata) ||
          !metadata.versions || typeof metadata.versions !== 'object' || Array.isArray(metadata.versions)) {
        throw new Error('Invalid npm registry metadata: expected versions')
      }
      const published = metadata.versions[version]
      if (published !== undefined) {
        if (published?.version !== version) throw new Error('Invalid npm registry metadata: version mismatch')
        log(`${packageName}@${version} is available after ${Math.round((now() - started) / 1000)}s`)
        return
      }
      lastStatus = 'version is not visible in install metadata yet'
    } else if (response) {
      lastStatus = `registry returned HTTP ${response.status}`
      if (response.status !== 404 && response.status !== 408 && response.status !== 429 && response.status < 500) {
        throw new Error(lastStatus)
      }
    }

    const remaining = deadline - now()
    if (remaining <= 0) break
    log(`Waiting for ${packageName}@${version}: ${lastStatus} (${Math.round(remaining / 1000)}s remaining)`)
    await pause(Math.min(pollMs, remaining))
  }
  throw new Error(`Timed out after ${Math.round(timeoutMs / 1000)}s waiting for ${packageName}@${version}: ${lastStatus}. Check npm processing before rerunning verification; do not republish this version.`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [version, ...extra] = process.argv.slice(2)
  if (!version || extra.length) {
    console.error('Usage: node scripts/wait-for-npm-version.mjs <version>')
    process.exitCode = 1
  } else {
    try {
      await waitForNpmVersion({ version })
    } catch (error) {
      console.error(error.message)
      process.exitCode = 1
    }
  }
}
