import { describe, expect, mock, test } from 'bun:test'
import { act, render, renderHook } from '@testing-library/react'

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
let asked: Array<{ method: string; params: unknown }> = []

mock.module('kehikot-module-protocol/client', () => ({
  HostRefused: class HostRefused extends Error {},
  connect: (_id: string, handlers: HostEvents) => {
    events = handlers
    return {
      listen: () => {},
      stop: () => {},
      resize: () => {},
      request: (method: string, params: unknown) => {
        asked.push({ method, params })
        return new Promise((resolve) => answers.push(resolve))
      },
    }
  },
}))

const { useKehikot } = await import('../src/wire/use-kehikot.ts')
const { App } = await import('../src/app.tsx')

const context = (epic: string | null, at: string | null = null): Context =>
  ({ epic, theme: 'light', selection: [], tracker: { at, refreshing: false } }) as unknown as Context

const AT = '2026-10-07T09:00:00.000Z'
const LATER = '2026-10-07T09:00:05.000Z'
const tracked = (at: string, headSha?: string) => ({
  at,
  refreshing: false,
  sources: [],
  missing: [],
  rows: [
    {
      ref: '!3105',
      tracker: 'gitlab',
      host: 'gitlab.com',
      repo: 'o/r',
      number: 3105,
      kind: 'change',
      state: 'open',
      title: 'A change',
      url: 'https://gitlab.com/o/r/-/merge_requests/3105',
      readAt: at,
      ...(headSha ? { detail: { readAt: at, headSha } } : {}),
    },
  ],
})

describe('useKehikot', () => {
  test('a late reading for the epic that was closed does not replace "no epic is open"', async () => {
    answers = []
    const { result } = renderHook(() => useKehikot('diff', () => {}))
    act(() => events.onHello!(context('a'), null))
    expect(result.current.sight.at).toBe('asking')

    act(() => events.onContext!(context(null)))
    expect(result.current.sight.at).toBe('no-epic')

    await act(async () => answers[0]!({ refs: [] }))
    expect(result.current.sight.at).toBe('no-epic')
  })

  test('the head commit is asked of the tracker reading, by ref and with detail', async () => {
    answers = []
    asked = []
    const { result } = renderHook(() => useKehikot('diff', () => {}))
    act(() => events.onHello!(context('a', AT), null))
    act(() => result.current.askHeads(['!3105']))
    expect(asked[1]).toEqual({ method: 'tracker.get', params: { refs: ['!3105'], detail: 'detail' } })
    /* Said at once, before any answer. */
    expect(result.current.heads['!3105']?.at).toBe('asking')

    /* Not read yet: the host has the row and no detail. */
    await act(async () => answers[1]!(tracked(AT)))
    expect(result.current.heads['!3105']).toEqual({ at: 'asking', since: AT })

    /* The read lands: the context says the reading moved, and asking again finds it. */
    act(() => events.onContext!(context('a', LATER)))
    expect(result.current.trackerAt).toBe(LATER)
    act(() => result.current.askHeads(['!3105']))
    await act(async () => answers[2]!(tracked(LATER, 'f40de680')))
    expect(result.current.heads['!3105']).toEqual({ at: 'known', sha: 'f40de680' })
  })

  test('a host that will not answer tracker.get leaves no head, rather than asking for ever', async () => {
    answers = []
    asked = []
    const { result } = renderHook(() => useKehikot('diff', () => {}))
    act(() => events.onHello!(context('a'), null))
    act(() => result.current.askHeads(['!3105']))
    await act(async () => answers[1]!('not a reading'))
    expect(result.current.heads['!3105']?.at).toBe('none')
  })

  test('a head asked for the epic that was left is not filed under the one that is open', async () => {
    answers = []
    asked = []
    const { result } = renderHook(() => useKehikot('diff', () => {}))
    act(() => events.onHello!(context('a', AT), null))
    act(() => result.current.askHeads(['!3105']))
    act(() => events.onContext!(context('b', AT)))
    expect(result.current.heads).toEqual({})
    await act(async () => answers[1]!(tracked(AT, 'f40de680')))
    expect(result.current.heads).toEqual({})
  })

  /*
   * The whole of the issue, through the real page: an open MR in an epic whose
   * reading carries an old head (or none) is fetched at the head the tracker
   * reports, and at nothing before the tracker has said.
   */
  test('a selected change is fetched at the tracker’s head, not the reading’s older one', async () => {
    answers = []
    asked = []
    const fetched: string[] = []
    const realFetch = globalThis.fetch
    globalThis.fetch = (async (url: string) => {
      fetched.push(String(url))
      return new Response('{}', { status: 500 })
    }) as unknown as typeof fetch
    try {
      const { container } = render(<App />)
      const picked = { ...context('a', AT), selection: ['!3105'] } as Context
      act(() => events.onHello!(picked, null))
      await act(async () =>
        answers[0]!({ mrs: { 3105: { url: 'https://gitlab.com/o/r/-/merge_requests/3105', sha: 'old00000', title: 'A change', state: 'opened' } } }),
      )
      expect(asked[1]).toEqual({ method: 'tracker.get', params: { refs: ['!3105'], detail: 'detail' } })
      expect(container.textContent).toContain('Asking the tracker for !3105’s head commit…')
      expect(fetched).toEqual([])

      await act(async () => answers[1]!(tracked(AT, 'f40de680')))
      expect(fetched).toHaveLength(1)
      expect(fetched[0]).toContain('sha=f40de680')
    } finally {
      globalThis.fetch = realFetch
    }
  })
})
