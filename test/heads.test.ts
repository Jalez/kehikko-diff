import { describe, expect, test } from 'bun:test'

import { headFor, readHeads, type Heads } from '../src/live/heads.ts'

/**
 * The head commit, out of the host's shared tracker reading.
 *
 * What matters is the three ways an answer can fail to name one — not read
 * yet, read and absent, and never going to be there — because each is a
 * different sentence on screen and only the first is worth waiting for.
 */

const AT = '2026-10-07T09:00:00.000Z'
const LATER = '2026-10-07T09:00:05.000Z'

const row = (ref: string, detail?: Record<string, unknown>) => ({
  ref,
  tracker: 'gitlab',
  host: 'gitlab.com',
  repo: 'o/r',
  number: 3105,
  kind: 'change',
  state: 'open',
  title: 'A change',
  url: 'https://gitlab.com/o/r/-/merge_requests/3105',
  readAt: AT,
  ...(detail ? { detail: { readAt: AT, ...detail } } : {}),
})

const reading = (over: Record<string, unknown>) => ({ at: AT, refreshing: false, sources: [], rows: [], missing: [], ...over })

describe('readHeads', () => {
  test('a detail that names a head commit is the head', () => {
    const heads = readHeads(['!3105'], reading({ rows: [row('!3105', { headSha: 'f40de680' })] }), {})
    expect(heads).toEqual({ '!3105': { at: 'known', sha: 'f40de680' } })
  })

  test('a row with no detail yet, and a ref still pending, are being asked — not absent', () => {
    expect(readHeads(['!3105'], reading({ rows: [row('!3105')] }), {})).toEqual({ '!3105': { at: 'asking', since: AT } })
    expect(readHeads(['!9'], reading({ at: null, missing: [{ ref: '!9', reason: 'pending' }] }), {})).toEqual({ '!9': { at: 'asking', since: null } })
  })

  test('once a read has landed without it, asking stops and says so', () => {
    const was: Heads = { '!3105': { at: 'asking', since: AT } }
    /* Same reading as before: nothing has landed, keep waiting. */
    expect(readHeads(['!3105'], reading({ rows: [row('!3105')] }), was)['!3105']).toEqual({ at: 'asking', since: AT })
    /* A read is still running: keep waiting. */
    expect(readHeads(['!3105'], reading({ at: LATER, refreshing: true, rows: [row('!3105')] }), was)['!3105']?.at).toBe('asking')
    /* It landed, and the detail is not there. */
    expect(readHeads(['!3105'], reading({ at: LATER, rows: [row('!3105')] }), was)['!3105']).toEqual({
      at: 'none',
      why: 'the tracker was read and its head commit did not come back',
    })
  })

  test('a head already known is not forgotten by an answer that lacks the detail', () => {
    const was: Heads = { '!3105': { at: 'known', sha: 'f40de680' } }
    expect(readHeads(['!3105'], reading({ rows: [row('!3105')] }), was)['!3105']).toEqual({ at: 'known', sha: 'f40de680' })
    /* And it moves when the tracker says the head moved. */
    expect(readHeads(['!3105'], reading({ rows: [row('!3105', { headSha: 'aaaa1111' })] }), was)['!3105']).toEqual({ at: 'known', sha: 'aaaa1111' })
  })

  test.each([
    ['not-found', 'the tracker has nothing under that reference'],
    ['no-tracker', 'this project reads no tracker that reference could belong to'],
    ['failed', 'the last read of its tracker failed'],
  ])('a ref missing as %s is not worth waiting for, and says why', (reason, why) => {
    expect(readHeads(['!1'], reading({ missing: [{ ref: '!1', reason }] }), {})).toEqual({ '!1': { at: 'none', why } })
  })

  test('a detail with no head, an answer that skips the ref, and an answer that is not a reading', () => {
    expect(readHeads(['!1'], reading({ rows: [row('!1', {})] }), {})['!1']?.at).toBe('none')
    expect(readHeads(['!1'], reading({}), {})['!1']?.at).toBe('none')
    expect(readHeads(['!1'], 'nope', {})['!1']?.at).toBe('none')
    /* A stranger's string, looked up in an object. */
    expect(readHeads(['constructor'], reading({ rows: [row('constructor')] }), {})['constructor']?.at).toBe('asking')
  })
})

describe('headFor', () => {
  test('the tracker’s head wins over the one the epic’s reading carries', () => {
    expect(headFor('old00000', { at: 'known', sha: 'new11111' })).toBe('new11111')
  })

  test('nothing is fetched while the tracker is being asked, even with an older head in hand', () => {
    expect(headFor('old00000', { at: 'asking', since: null })).toBe('')
  })

  test('the reading’s own head is the fallback when the tracker has none, or was never asked', () => {
    expect(headFor('old00000', { at: 'none', why: 'x' })).toBe('old00000')
    expect(headFor('old00000', undefined)).toBe('old00000')
    expect(headFor('', { at: 'none', why: 'x' })).toBe('')
  })
})
