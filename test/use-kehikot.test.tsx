import { afterEach, describe, expect, test } from 'bun:test'
import { act, cleanup, fireEvent, render, renderHook, within } from '@testing-library/react'

import { MESSAGE, PROTOCOL } from 'kehikot-module-protocol'
import { mailbox, resetServerStanding } from 'kehikot-module-protocol/client'

import { App, NO_LIST } from '../src/app.tsx'
import { askDiff, forget } from '../src/diff/ask.ts'
import { useKehikot } from '../src/wire/use-kehikot.ts'

/**
 * A host, as a frame sees one: messages arriving on `window`, from a source that takes the replies.
 *
 * The hook is built on the protocol's `useHost` now, so there is no `connect` of this module's own
 * to stand a fake in for — the real client is listening, and this speaks the wire to it.
 */
type Context = Record<string, unknown>

let said: Record<string, unknown>[] = []
const source = { postMessage: (message: Record<string, unknown>) => void said.push(message) }
const post = (data: unknown) => {
  const event = new MessageEvent('message', { data, origin: 'http://localhost:7777' })
  Object.defineProperty(event, 'source', { value: source })
  window.dispatchEvent(event)
}
const requests = () => said.filter((message) => message.type === MESSAGE.REQUEST)

/** What the old fake exposed, in the same words, so the tests below read as they did. */
const events = {
  onHello: (context: Context, state: string | null) => post({ type: MESSAGE.HELLO, protocol: PROTOCOL, session: 's', context, state }),
  onContext: (context: Context) => post({ type: MESSAGE.CONTEXT, protocol: PROTOCOL, ...context }),
}
const asked = new Proxy([] as Array<{ method: string; params: unknown }>, {
  get: (_target, index) => {
    const request = requests()[Number(index)]
    return request ? { method: request.method, params: request.params } : undefined
  },
})
const answers = new Proxy([] as Array<(data: unknown) => void>, {
  get: (_target, index) => (data: unknown) => post({ type: MESSAGE.RESPONSE, id: requests()[Number(index)]?.id, ok: true, data }),
})

afterEach(() => {
  cleanup()
  mailbox.forget?.()
  resetServerStanding()
  said = []
})

const context = (epic: string | null, at: string | null = null): Context => ({
  epic,
  project: 'p',
  projectPath: '/p',
  theme: 'light',
  selection: [],
  filters: {},
  tracker: { at, refreshing: false },
})

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
    const { result } = renderHook(() => useKehikot('diff', () => {}))
    act(() => events.onHello!(context('a'), null))
    expect(result.current.sight.at).toBe('asking')

    act(() => events.onContext!(context(null)))
    expect(result.current.sight.at).toBe('no-epic')

    await act(async () => answers[0]!({ refs: [] }))
    expect(result.current.sight.at).toBe('no-epic')
  })

  test('the head commit is asked of the tracker reading, by ref and with detail', async () => {
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
    const { result } = renderHook(() => useKehikot('diff', () => {}))
    act(() => events.onHello!(context('a'), null))
    act(() => result.current.askHeads(['!3105']))
    await act(async () => answers[1]!('not a reading'))
    expect(result.current.heads['!3105']?.at).toBe('none')
  })

  test('a head asked for the epic that was left is not filed under the one that is open', async () => {
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
    const fetched: string[] = []
    const realFetch = globalThis.fetch
    globalThis.fetch = (async (url: string) => {
      fetched.push(String(url))
      return new Response('{}', { status: 500 })
    }) as unknown as typeof fetch
    try {
      const { container } = render(<App />)
      const picked = { ...context('a', AT), selection: ['!3105'] } 
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

/*
 * The moments before there is a change to draw, each as the protocol's one shared cover, and this
 * app's own server behind the protocol's `ask()`. This app takes no writes, so there is no ticket
 * to carry: what is asserted is that a read carries none, what a refusal says, and what the page
 * draws when nothing answers.
 */
describe('the not-ready moments are the shared cover', () => {
  const realFetch = globalThis.fetch
  const cover = () => document.querySelector('[data-cover]')
  const settle = (ms: number) => act(async () => void (await new Promise((resolve) => setTimeout(resolve, ms))))
  const PATCH = 'diff --git a/one.txt b/one.txt\n--- a/one.txt\n+++ b/one.txt\n@@ -1 +1 @@\n-old\n+new\n'
  const READING = { mrs: { 3105: { url: 'https://gitlab.com/o/r/-/merge_requests/3105', sha: 'f40de680', title: 'A change', state: 'opened' } } }

  afterEach(() => {
    globalThis.fetch = realFetch
    forget()
    document.documentElement.className = ''
  })

  test('before anything has greeted the page it is waiting, and then nothing is framing it', async () => {
    render(<App />)
    await settle(30)
    expect(cover()?.getAttribute('data-cover')).toBe('waiting')
    expect(cover()?.textContent).toBe('Waiting for Kehikot…')
    await settle(800)
    expect(cover()?.getAttribute('data-cover')).toBe('unhosted')
    expect(cover()?.textContent).toContain('Nothing is framing this page — open Diff in Kehikot.')
    expect(cover()?.textContent).toContain(NO_LIST)
  })

  test('hosted with no epic: the no-epic cover; with one, the question out is said in this app’s own words', async () => {
    render(<App />)
    act(() => events.onHello(context(null), null))
    expect(cover()?.getAttribute('data-cover')).toBe('no-epic')
    expect(cover()?.textContent).toBe('No epic is open — open one in Kehikot.')
    expect(document.documentElement.classList.contains('light')).toBe(true)

    act(() => events.onContext({ ...context('a'), theme: 'dark' }))
    expect(cover()?.getAttribute('data-cover')).toBe('loading')
    expect(cover()?.textContent).toBe('Asking Kehikot what it last read about a.')
    expect(document.documentElement.classList.contains('dark')).toBe(true)

    await act(async () => answers[0]!({ refs: [] }))
    expect(cover()).toBeNull()
    expect(document.body.textContent).toContain('Nothing is selected')
  })

  test('a read carries no ticket, and a refusal — at 200 or not — is the door’s own sentence', async () => {
    const calls: { url: string; init: RequestInit | undefined }[] = []
    let reply = () => new Response(JSON.stringify({ ok: false, error: 'gh: To get started with GitHub CLI, please run: gh auth login' }), { status: 200 })
    globalThis.fetch = (async (url: string, init?: RequestInit) => {
      calls.push({ url: String(url), init })
      return reply()
    }) as unknown as typeof fetch
    expect(await askDiff('https://github.com/o/r/pull/1', 'abc')).toEqual({ ok: false, error: 'gh: To get started with GitHub CLI, please run: gh auth login', kind: 'refused' })
    expect(calls[0]?.url).toBe('api/diff?url=https%3A%2F%2Fgithub.com%2Fo%2Fr%2Fpull%2F1&sha=abc')
    expect(calls[0]?.init?.method).toBe('GET')
    expect((calls[0]?.init?.headers as Record<string, string>)['x-module-ticket']).toBeUndefined()
    reply = () => new Response(JSON.stringify({ ok: false, error: 'ask for a diff by the url the tracker wrote for it.' }), { status: 400 })
    expect(await askDiff('https://github.com/o/r/pull/2', 'abc')).toMatchObject({ ok: false, kind: 'refused', error: 'ask for a diff by the url the tracker wrote for it.' })
    reply = () => new Response('<html>', { status: 200 })
    expect(await askDiff('https://github.com/o/r/pull/3', 'abc')).toMatchObject({ ok: false, error: 'This app’s own server answered with something that is not a reply.' })
  })

  test('its own server not answering: the down cover over the mounted change, and Try again fetches what never arrived', async () => {
    let down = true
    const fetched: string[] = []
    globalThis.fetch = (async (url: string) => {
      fetched.push(String(url))
      if (down) throw new TypeError('Load failed')
      return new Response(JSON.stringify(String(url).startsWith('healthz') ? { ok: true } : { ok: true, text: PATCH, sha: 'f40de680', truncated: false, from: 'cli' }), { status: 200 })
    }) as unknown as typeof fetch

    const { container } = render(<App />)
    act(() => events.onHello({ ...context('a', AT), selection: ['!3105'] }, null))
    await act(async () => answers[0]!(READING))
    await act(async () => answers[1]!(tracked(AT, 'f40de680')))
    await settle(20)
    expect(fetched).toHaveLength(1)
    expect(cover()?.getAttribute('data-cover')).toBe('down')
    expect(cover()?.textContent).toContain('Diff’s own server is not answering.')
    /* Hidden, not gone. */
    const change = container.querySelector('[data-ref="!3105"]')
    expect(change?.closest('[hidden]')).not.toBeNull()

    await act(async () => {
      fireEvent.click(within(cover() as HTMLElement).getByRole('button', { name: 'Try again' }))
      await new Promise((resolve) => setTimeout(resolve, 30))
    })
    expect(cover()?.getAttribute('data-cover')).toBe('down')

    down = false
    await act(async () => {
      fireEvent.click(within(cover() as HTMLElement).getByRole('button', { name: 'Try again' }))
      await new Promise((resolve) => setTimeout(resolve, 30))
    })
    expect(cover()).toBeNull()
    expect(fetched.at(-1)).toContain('api/diff?')
    expect(container.querySelector('[data-ref="!3105"]')).toBe(change)
    expect(container.textContent).toContain('one.txt')
  })
})
