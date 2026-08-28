import { describe, expect, test } from 'bun:test'

import { generatedAt, index } from '../src/live/lookup.ts'

/** A reading shaped exactly like `data/state/modes-are-modules.json` in the roadmap. */
const LIVE = {
  generated: '2026-08-26T20:40:27Z',
  issues: { '7': { state: 'opened', title: 'a gitlab issue', url: 'https://gitlab.com/g/p/-/issues/7' } },
  mrs: { '12': { state: 'merged', title: 'a merge request', url: 'https://gitlab.com/g/p/-/merge_requests/12', sha: 'abc123' } },
  ghIssues: {
    'gh#131': { state: 'opened', title: 'an issue', url: 'https://github.com/o/r/issues/131' },
  },
  ghPrs: {
    'gh#105': {
      state: 'merged',
      title: 'The settings dialog says which commit it is running',
      url: 'https://github.com/o/r/pull/105',
      sha: '48d720233c0a4d6900bf1b4967e12760ebc5fdda',
    },
  },
}

describe('index', () => {
  test('the bag is the only thing that says what a ref is', () => {
    /* `gh#131` and `gh#105` are the same shape of string out of the same
       sequence. Nothing but the bag can tell them apart, and this is the
       assertion that says so. */
    const found = index(LIVE)
    expect(found.get('gh#131')?.kind).toBe('work')
    expect(found.get('gh#105')?.kind).toBe('change')
  })

  test('GitLab’s bare-number keys are respelled the way people write them', () => {
    const found = index(LIVE)
    expect(found.get('#7')?.kind).toBe('work')
    expect(found.get('!12')?.kind).toBe('change')
    expect(found.get('!12')?.origin).toBe('gitlab')
  })

  test('the url and the head sha come out with it, because the ref carries neither', () => {
    const pr = index(LIVE).get('gh#105')!
    expect(pr.url).toBe('https://github.com/o/r/pull/105')
    expect(pr.sha).toBe('48d720233c0a4d6900bf1b4967e12760ebc5fdda')
  })

  test('a reference the reading has never heard of is simply absent', () => {
    expect(index(LIVE).get('gh#9999')).toBeUndefined()
  })

  test('a damaged entry keeps its kind and admits the rest is unreadable', () => {
    const found = index({ ghPrs: { 'gh#1': 'not an object' } })
    const one = found.get('gh#1')!
    expect(one.kind).toBe('change')
    expect(one.unreadable).toBe(true)
    expect(one.url).toBe('')
  })

  test('a bag key called constructor is a row about constructor, not a prototype', () => {
    /* `bag[ref]` with a ref off the wire answers with something inherited when
       the string is `constructor`. This enumerates instead, so the entry is
       whatever the tracker really filed and nothing from a prototype. */
    const found = index({ ghPrs: { constructor: { url: 'https://github.com/o/r/pull/2', sha: 'x' } } })
    expect(found.get('constructor')?.url).toBe('https://github.com/o/r/pull/2')
    expect(found.size).toBe(1)
  })

  test('nothing at all is an empty map rather than a throw', () => {
    expect(index(null).size).toBe(0)
    expect(index('nope').size).toBe(0)
    expect(index({ ghPrs: 'nope' }).size).toBe(0)
  })

  test('when the reading was taken, or null when it did not say', () => {
    expect(generatedAt(LIVE)).toBe('2026-08-26T20:40:27Z')
    expect(generatedAt({})).toBeNull()
    expect(generatedAt(null)).toBeNull()
  })
})
