import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../session-auth.js', () => ({ liveEventSourceUrl: () => '/api/live' }))

class FakeEventSource extends EventTarget {
  static instances: FakeEventSource[] = []
  close = vi.fn()

  constructor(public url: string) {
    super()
    FakeEventSource.instances.push(this)
  }

  open() {
    this.dispatchEvent(new Event('open'))
  }

  emit(event: string, data: string) {
    this.dispatchEvent(new MessageEvent(event, { data }))
  }
}

let subscriptions: (() => void)[] = []

beforeEach(() => {
  vi.resetModules()
  FakeEventSource.instances = []
  subscriptions = []
  vi.stubGlobal('EventSource', FakeEventSource)
})

afterEach(() => {
  for (const unsubscribe of subscriptions) unsubscribe()
  vi.unstubAllGlobals()
})

describe('shared live channel reconnect', () => {
  it('ignores the first open and announces a later open exactly once', async () => {
    const { subscribeLive } = await import('../live')
    const reconnect = vi.fn()
    const change = vi.fn()
    subscriptions.push(subscribeLive('reconnect', reconnect), subscribeLive('change', change))
    expect(FakeEventSource.instances).toHaveLength(1)
    const source = FakeEventSource.instances[0]
    source.open()
    expect(reconnect).not.toHaveBeenCalled()
    source.emit('change', 'initial change')
    expect(change).toHaveBeenCalledExactlyOnceWith('initial change')
    source.open()
    expect(reconnect).toHaveBeenCalledOnce()
    change.mockClear()
    source.emit('change', 'after reconnect')
    expect(change).toHaveBeenCalledExactlyOnceWith('after reconnect')
  })

  it('closes only after the last unsubscribe and starts a fresh connection without a reconnect event', async () => {
    const { subscribeLive } = await import('../live')
    const reconnect = vi.fn()
    const change = vi.fn()
    const offReconnect = subscribeLive('reconnect', reconnect)
    const offChange = subscribeLive('change', change)
    subscriptions.push(offReconnect, offChange)
    const first = FakeEventSource.instances[0]
    first.open()
    first.open()
    expect(reconnect).toHaveBeenCalledOnce()
    offReconnect()
    expect(first.close).not.toHaveBeenCalled()
    offChange()
    expect(first.close).toHaveBeenCalledOnce()
    reconnect.mockClear()
    subscriptions.push(subscribeLive('reconnect', reconnect), subscribeLive('change', change))
    expect(FakeEventSource.instances).toHaveLength(2)
    const fresh = FakeEventSource.instances[1]
    fresh.open()
    expect(reconnect).not.toHaveBeenCalled()
    fresh.emit('change', 'fresh change')
    expect(change).toHaveBeenCalledExactlyOnceWith('fresh change')
  })
})
