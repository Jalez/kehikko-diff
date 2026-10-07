import { describe, expect, mock, test } from 'bun:test'
import { act, renderHook } from '@testing-library/react'

import type { HostEvents } from 'kehikot-module-protocol/client'

/**
 * The hook against a host that answers when the test says so.
 *
 * `connect` is replaced, because the point is the order in which answers arrive
 * relative to contexts, and a real window cannot be made to answer late on cue.
 */
type Context = Parameters<NonNullable<HostEvents['onContext']>>[0]

let events: HostEvents
let answers: Array<(data: unknown) => void> = []

mock.module('kehikot-module-protocol/client', () => ({
  HostRefused: class HostRefused extends Error {},
  connect: (_id: string, handlers: HostEvents) => {
    events = handlers
    return {
      listen: () => {},
      stop: () => {},
      resize: () => {},
      request: () => new Promise((resolve) => answers.push(resolve)),
    }
  },
}))

const { useKehikot } = await import('../src/wire/use-kehikot.ts')

const context = (epic: string | null): Context => ({ epic, theme: 'light', selection: [] }) as unknown as Context

describe('useKehikot', () => {
  test('a late reading for the epic that was closed does not replace "no epic is open"', async () => {
    answers = []
    const { result } = renderHook(() => useKehikot('diff', () => {}))
    act(() => events.onHello!(context('a')))
    expect(result.current.sight.at).toBe('asking')

    act(() => events.onContext!(context(null)))
    expect(result.current.sight.at).toBe('no-epic')

    await act(async () => answers[0]!({ refs: [] }))
    expect(result.current.sight.at).toBe('no-epic')
  })
})
