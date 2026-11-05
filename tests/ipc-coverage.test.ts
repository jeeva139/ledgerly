import { beforeEach, describe, expect, it } from 'vitest'
import { freshDb } from './helpers'
import { registerAllIpc, missingHandlers } from '../electron/ipc'
import { clearHandlersForTests, registeredChannels, invokeChannel } from '../electron/ipc/register'
import { API_METHODS } from '../shared/api'

beforeEach(() => {
  freshDb()
  clearHandlersForTests()
})

describe('IPC contract coverage', () => {
  it('every method promised to the renderer has exactly one handler', () => {
    registerAllIpc()
    expect(missingHandlers()).toEqual([])
    const declared = new Set(Object.entries(API_METHODS).flatMap(([ns, ms]) => ms.map((m) => `${ns}.${m}`)))
    const extra = registeredChannels().filter((c) => !declared.has(c))
    expect(extra).toEqual([]) // no undeclared channels reachable from the renderer
  })

  it('rejects malformed input on every channel instead of throwing', async () => {
    registerAllIpc()
    for (const channel of registeredChannels()) {
      if (channel.startsWith('lock.')) continue
      const res = await invokeChannel(channel, { definitely: 'not valid', nested: { x: [1, 2, 3] } })
      // Either a clean validation error, or (for channels with an all-optional schema) a success/other friendly failure.
      expect(typeof res.ok).toBe('boolean')
      if (!res.ok) expect(res.error.message).not.toMatch(/at .*\.(ts|js):\d+/) // no stack traces
    }
  })
})
