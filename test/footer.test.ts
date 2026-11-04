import { describe, expect, test } from 'bun:test'

import { parseDiff } from '../src/diff/parse.ts'
import { footerItems } from '../src/view/footer.ts'

const text = ['diff --git a/a.ts b/a.ts', '--- a/a.ts', '+++ b/a.ts', '@@ -1,2 +1,2 @@', '-old', '+new', '+more', ' same'].join('\n')
const patch = { files: parseDiff(text), text, truncated: false, sha: 'abc', from: 'cli' as const }

describe('the footer', () => {
  test('nothing selected says so', () => {
    expect(footerItems({ refs: [], shown: null, taken: null, refused: null })).toEqual([expect.objectContaining({ id: 'selected', text: 'Nothing selected' })])
  })

  test('one change: its ref, and its diff in files and lines; when it was read, in the tooltip; nothing pressable', () => {
    const items = footerItems({ refs: ['gh#105'], shown: { ref: 'gh#105', ask: { at: 'ok', patch } }, taken: '10:42', refused: null })
    expect(items[0]).toMatchObject({ kind: 'text', id: 'selected', text: 'gh#105' })
    expect(items[0]!.tooltip).toContain('last read this epic at 10:42')
    expect(items[1]).toMatchObject({ kind: 'text', id: 'size', text: '1 file · +2 −1' })
    expect(items.every((i) => i.kind === 'text')).toBe(true)
  })

  test('several: how many, and whose diff the size is; reading and failing say so', () => {
    expect(footerItems({ refs: ['gh#1', 'gh#2'], shown: { ref: 'gh#1', ask: { at: 'ok', patch } }, taken: null, refused: null })[1]).toMatchObject({ text: 'gh#1: 1 file · +2 −1' })
    expect(footerItems({ refs: ['gh#1', 'gh#2'], shown: { ref: 'gh#1', ask: { at: 'asking' } }, taken: null, refused: null })[0]).toMatchObject({ text: '2 selected' })
    expect(footerItems({ refs: ['gh#1'], shown: { ref: 'gh#1', ask: { at: 'error', error: 'gh is not signed in.' } }, taken: null, refused: null })[1]).toMatchObject({ level: 'warn', text: 'gh is not signed in.' })
  })

  test('what the host said to a pointed line is a warning', () => {
    const items = footerItems({ refs: ['gh#1'], shown: null, taken: null, refused: 'Kehikot did not take that.' })
    expect(items.at(-1)).toMatchObject({ id: 'refused', level: 'warn', align: 'end' })
  })
})
