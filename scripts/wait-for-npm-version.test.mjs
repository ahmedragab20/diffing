import assert from 'node:assert/strict'
import { test } from 'node:test'
import { waitForNpmVersion } from './wait-for-npm-version.mjs'

const options = {
  packageName: 'diffing',
  version: '0.21.8',
  timeoutMs: 1_200_000,
  pollMs: 15_000,
  requestTimeoutMs: 20_000,
}
const ready = () => new Response(JSON.stringify({ versions: { '0.21.8': { version: '0.21.8' } } }))
const missing = () => new Response(JSON.stringify({ versions: {} }))

function harness(responses) {
  let time = 0
  const calls = []
  const sleeps = []
  const logs = []
  const deps = {
    fetch: async (url, init) => {
      calls.push({ url, init, at: time })
      const next = responses.shift()
      assert.notEqual(next, undefined, 'unexpected registry request')
      if (next instanceof Error) throw next
      return typeof next === 'function' ? next() : next
    },
    now: () => time,
    sleep: async (duration) => { sleeps.push(duration); time += duration },
    log: (...args) => logs.push(args),
  }
  return { deps, calls, sleeps, logs, now: () => time }
}

test('returns immediately when the exact version is available', async () => {
  const h = harness([ready])
  await waitForNpmVersion(options, h.deps)
  assert.equal(h.calls.length, 1)
  assert.equal(h.calls[0].url, 'https://registry.npmjs.org/diffing')
  const headers = new Headers(h.calls[0].init.headers)
  assert.equal(headers.get('accept'), 'application/vnd.npm.install-v1+json')
  assert.equal(headers.get('cache-control'), 'no-cache')
  assert.deepEqual(h.sleeps, [])
})

test('continues beyond the former 50-second window through missing versions and 404s', async () => {
  const h = harness([missing, () => new Response('', { status: 404 }), missing, missing, ready])
  await waitForNpmVersion(options, h.deps)
  assert.equal(h.now(), 60_000)
  assert.equal(h.calls.length, 5)
  assert.deepEqual(h.calls.map(({ at }) => at), [0, 15_000, 30_000, 45_000, 60_000])
  assert.deepEqual(h.sleeps, [15_000, 15_000, 15_000, 15_000])
})

test('retries transient HTTP responses and network failures', async () => {
  const h = harness([
    ...[408, 429, 500, 502, 503, 504].map((status) => () => new Response('', { status })),
    new TypeError('network unavailable'),
    new DOMException('request deadline exceeded', 'TimeoutError'),
    ready,
  ])
  await waitForNpmVersion(options, h.deps)
  assert.equal(h.calls.length, 9)
  assert.equal(h.now(), 120_000)
  assert.deepEqual(h.sleeps, Array(8).fill(15_000))
})

for (const status of [401, 403]) {
  test(`fails immediately for HTTP ${status}`, async () => {
    const h = harness([() => new Response('', { status })])
    await assert.rejects(waitForNpmVersion(options, h.deps), new RegExp(String(status)))
    assert.equal(h.calls.length, 1)
    assert.deepEqual(h.sleeps, [])
  })
}

test('clamps the final sleep and starts no request at the overall deadline', async () => {
  const h = harness([missing, missing, missing])
  await assert.rejects(waitForNpmVersion({ ...options, timeoutMs: 35_000 }, h.deps), /Timed out after 35s waiting for diffing@0\.21\.8/)
  assert.deepEqual(h.sleeps, [15_000, 15_000, 5_000])
  assert.equal(h.now(), 35_000)
  assert.deepEqual(h.calls.map(({ at }) => at), [0, 15_000, 30_000])
})

test('defaults to a twenty-minute overall deadline', async () => {
  const h = harness(Array(80).fill(missing))
  const { timeoutMs: _unused, ...withDefaultTimeout } = options
  await assert.rejects(waitForNpmVersion(withDefaultTimeout, h.deps), /Timed out after 1200s waiting for diffing@0\.21\.8/)
  assert.equal(h.now(), 1_200_000)
  assert.equal(h.calls.length, 80)
  assert.equal(h.calls.at(-1).at, 1_185_000)
})

test('fails immediately for malformed JSON', async () => {
  const h = harness([() => new Response('{ invalid')])
  await assert.rejects(waitForNpmVersion(options, h.deps), /json|unexpected|invalid|property name/i)
  assert.equal(h.calls.length, 1)
  assert.deepEqual(h.sleeps, [])
})

test('rejects a requested version entry whose metadata names another version', async () => {
  const h = harness([() => new Response(JSON.stringify({ versions: { '0.21.8': { version: '0.21.7' } } }))])
  await assert.rejects(waitForNpmVersion(options, h.deps), /Invalid npm registry metadata: version mismatch/)
  assert.equal(h.calls.length, 1)
  assert.deepEqual(h.sleeps, [])
})

test('passes an AbortSignal to every registry request', async () => {
  const h = harness([missing, ready])
  await waitForNpmVersion(options, h.deps)
  assert.equal(h.calls.length, 2)
  for (const { init } of h.calls) assert.ok(init.signal instanceof AbortSignal)
})

test('bounds each request timeout by the remaining overall deadline without real timers', async (t) => {
  const durations = []
  const signals = []
  t.mock.method(AbortSignal, 'timeout', (duration) => {
    durations.push(duration)
    const signal = new AbortController().signal
    signals.push(signal)
    return signal
  })
  const h = harness([missing, missing, missing])
  await assert.rejects(waitForNpmVersion({ ...options, timeoutMs: 35_000 }, h.deps), /timeout|timed out|deadline/i)
  assert.deepEqual(durations, [20_000, 20_000, 5_000])
  assert.deepEqual(h.calls.map(({ init }) => init.signal), signals)
})

for (const invalid of [
  { version: '' },
  { version: '   ' },
  { timeoutMs: 0 },
  { timeoutMs: -1 },
  { pollMs: 0 },
  { pollMs: -1 },
  { requestTimeoutMs: 0 },
  { requestTimeoutMs: -1 },
]) {
  test(`rejects invalid options before fetching: ${JSON.stringify(invalid)}`, async () => {
    const h = harness([])
    await assert.rejects(waitForNpmVersion({ ...options, ...invalid }, h.deps))
    assert.deepEqual(h.calls, [])
    assert.deepEqual(h.sleeps, [])
  })
}
