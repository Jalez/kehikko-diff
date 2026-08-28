import { describe, expect, test } from 'bun:test'

import { FILE_LINES, OPEN_LINES, plan } from '../src/diff/budget.ts'
import type { FileDiff } from '../src/diff/parse.ts'

const file = (path: string, lines: number): FileDiff => ({
  path,
  from: null,
  status: 'modified',
  binary: false,
  hunks: [],
  added: lines,
  removed: 0,
  lines,
})

describe('plan', () => {
  test('an ordinary change opens whole, with no controls to notice', () => {
    const files = [file('a', 40), file('b', 120), file('c', 12)]
    const made = plan(files)
    expect(made.open.size).toBe(3)
    expect(made.closed).toBe(0)
    expect(made.heldBack).toBe(0)
  })

  test('past the budget, files are CLOSED and never dropped', () => {
    /* The distinction the whole module turns on. A closed file is visible and
       one press away; a dropped file is indistinguishable from a file that was
       never changed. */
    const files = [file('a', OPEN_LINES), file('b', 500), file('c', 300)]
    const made = plan(files)
    expect(made.open.has(0)).toBe(true)
    expect(made.open.has(1)).toBe(false)
    expect(made.closed).toBe(2)
    expect(made.heldBack).toBe(800)
  })

  test('the first file opens whatever its size', () => {
    /* A pane whose every file is shut looks like a pane that failed. The
       per-file cap is what keeps that safe. */
    const made = plan([file('huge', 40_000), file('small', 3)])
    expect(made.open.has(0)).toBe(true)
    expect(made.closed).toBe(1)
  })

  test('the per-file cap is smaller than the whole-patch budget', () => {
    /* If it were not, one enormous open file would defeat the budget entirely
       and the pane would render it whole. */
    expect(FILE_LINES).toBeLessThan(OPEN_LINES)
  })

  test('no files is not an error', () => {
    expect(plan([])).toEqual({ open: new Set(), closed: 0, heldBack: 0 })
  })
})
