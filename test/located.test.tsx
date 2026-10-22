import { afterEach, describe, expect, test } from 'bun:test'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { CodeLocation, SharedLocation } from 'kehikot-module-protocol'

import type { Patch } from '../src/diff/ask.ts'
import { locationAt, named, placeOf, reach, spotIn } from '../src/diff/located.ts'
import { parseDiff } from '../src/diff/parse.ts'
import { PatchView } from '../src/view/patch-view.tsx'

/**
 * A code location (protocol 2.13.0) in a patch: the file opened, the lines
 * marked on the gutter `side` names, scrolled to — and a line number or
 * "Comment on this line" pointing the canvas back.
 */

const TEXT = [
  'diff --git a/src/app.ts b/src/app.ts',
  '--- a/src/app.ts',
  '+++ b/src/app.ts',
  '@@ -10,4 +10,4 @@ function a()',
  ' keep ten',
  '-old eleven',
  '+new eleven',
  ' keep twelve',
  ' keep thirteen',
  'diff --git a/README.md b/README.md',
  '--- a/README.md',
  '+++ b/README.md',
  '@@ -1,1 +1,2 @@',
  ' # Title',
  '+a line',
  'diff --git a/old/name.ts b/new/name.ts',
  '--- a/old/name.ts',
  '+++ b/new/name.ts',
  '@@ -5,1 +5,1 @@',
  '-was',
  '+is',
  '',
].join('\n')
const HEAD = '48d720233c0a4d6900bf1b4967e12760ebc5fdda'
const patch: Patch = { files: parseDiff(TEXT), text: TEXT, truncated: false, sha: HEAD, from: 'cli' }
const [app, readme, renamed] = patch.files as [NonNullable<Patch['files'][number]>, NonNullable<Patch['files'][number]>, NonNullable<Patch['files'][number]>]
const at = (over: Partial<SharedLocation> = {}): SharedLocation => ({
  change: 'gh#105',
  path: 'src/app.ts',
  line: 11,
  side: 'new',
  intent: 'show',
  at: '2026-10-22T10:00:00.000Z',
  ...over,
})

describe('a location against a patch', () => {
  test('is about one file of one change, by its path on the side it counts', () => {
    expect(spotIn(at(), 'gh#105', app)).toEqual({ side: 'new', from: 11, to: 11, at: '2026-10-22T10:00:00.000Z' })
    expect(spotIn(at(), 'gh#106', app)).toBeNull()
    expect(spotIn(at(), 'gh#105', readme)).toBeNull()
    /* A renamed file: the new side by its new name, the old side by its old one. */
    expect(spotIn(at({ path: 'new/name.ts', line: 5 }), 'gh#105', renamed)).not.toBeNull()
    expect(spotIn(at({ path: 'old/name.ts', line: 5, side: 'old' }), 'gh#105', renamed)).not.toBeNull()
    expect(spotIn(at({ path: 'old/name.ts', line: 5, side: 'new' }), 'gh#105', renamed)).toBeNull()
  })
  test('side decides the gutter', () => {
    const lines = app.hunks[0]!.lines
    const newSpot = spotIn(at(), 'gh#105', app)
    const oldSpot = spotIn(at({ side: 'old' }), 'gh#105', app)
    expect(lines.filter((line) => named(line, newSpot)).map((line) => line.text)).toEqual(['new eleven'])
    expect(lines.filter((line) => named(line, oldSpot)).map((line) => line.text)).toEqual(['old eleven'])
    const range = spotIn(at({ line: 10, endLine: 12 }), 'gh#105', app)
    expect(lines.filter((line) => named(line, range)).map((line) => line.text)).toEqual(['keep ten', 'new eleven', 'keep twelve'])
  })
  test('reach: how far into the file the first named line is, or -1', () => {
    expect(reach(app, spotIn(at({ line: 12 }), 'gh#105', app))).toBe(3)
    expect(reach(app, spotIn(at({ line: 400 }), 'gh#105', app))).toBe(-1)
  })
  test('a press points at the line, on the right side, with the head commit only on the new side', () => {
    const [ten, eleventhOld, eleventhNew] = app.hunks[0]!.lines as [never, never, never]
    expect(placeOf(eleventhOld, 'comment')).toEqual({ side: 'old', line: 11 })
    expect(placeOf(eleventhNew, 'comment')).toEqual({ side: 'new', line: 11 })
    expect(placeOf(ten, 'old')).toEqual({ side: 'old', line: 10 })
    expect(placeOf(eleventhNew, 'old')).toBeNull()
    expect(locationAt('gh#105', app, { side: 'new', line: 11 }, HEAD)).toEqual({ change: 'gh#105', path: 'src/app.ts', line: 11, side: 'new', commit: HEAD })
    expect(locationAt('gh#105', renamed, { side: 'old', line: 5 }, HEAD)).toEqual({ change: 'gh#105', path: 'old/name.ts', line: 5, side: 'old' })
  })
})

describe('the patch, drawn with a location', () => {
  afterEach(cleanup)

  test('the file is opened, the named lines are marked and the first is scrolled to', () => {
    const scrolled: string[] = []
    const was = Element.prototype.scrollIntoView
    Element.prototype.scrollIntoView = function (this: Element) {
      scrolled.push((this as HTMLElement).dataset.lineNew ?? (this as HTMLElement).dataset.file ?? '')
    }
    try {
      const { container, rerender } = render(<PatchView patch={patch} change="gh#105" location={at({ path: 'README.md', line: 2 })} />)
      const file = container.querySelector('[data-file="README.md"]') as HTMLDetailsElement
      expect(file.open).toBe(true)
      const marked = [...container.querySelectorAll('[data-located="yes"].diff-row')] as HTMLElement[]
      expect(marked.map((row) => row.textContent?.includes('a line'))).toEqual([true])
      expect(scrolled.at(-1)).toBe('2')
      /* Pointed at again: scrolled again. */
      const before = scrolled.length
      rerender(<PatchView patch={patch} change="gh#105" location={at({ path: 'README.md', line: 2, at: 'later' })} />)
      expect(scrolled.length).toBeGreaterThan(before)
    } finally {
      Element.prototype.scrollIntoView = was
    }
  })

  test('another change’s location marks nothing here', () => {
    const { container } = render(<PatchView patch={patch} change="gh#9" location={at()} />)
    expect(container.querySelector('[data-located="yes"]')).toBeNull()
  })

  test('a line the patch does not print is said, and the file still opens', () => {
    const { container } = render(<PatchView patch={patch} change="gh#105" location={at({ line: 400 })} />)
    expect(screen.getByTestId('not-in-patch').textContent).toContain('Line 400 is not in what the patch prints for this file')
    expect((container.querySelector('[data-file="src/app.ts"]') as HTMLDetailsElement).open).toBe(true)
  })

  test('every line offers "Comment on this line", and a line number shows that line', async () => {
    const sent: { location: CodeLocation; intent: string }[] = []
    render(<PatchView patch={patch} change="gh#105" onLocate={(location, intent) => sent.push({ location, intent })} />)
    const buttons = screen.getAllByRole('button', { name: 'Comment on this line' })
    /* Every line of every open file: five, two and two. */
    expect(buttons).toHaveLength(9)
    await act(async () => void fireEvent.click(buttons[1]!))
    expect(sent.at(-1)).toEqual({ location: { change: 'gh#105', path: 'src/app.ts', line: 11, side: 'old' }, intent: 'comment' })
    await act(async () => void fireEvent.click(screen.getByRole('button', { name: 'Show new line 12' })))
    expect(sent.at(-1)).toEqual({ location: { change: 'gh#105', path: 'src/app.ts', line: 12, side: 'new', commit: HEAD }, intent: 'show' })
  })

  test('without a change to point into, no line is a button', () => {
    render(<PatchView patch={patch} />)
    expect(screen.queryAllByRole('button', { name: 'Comment on this line' })).toHaveLength(0)
    expect(screen.queryByRole('button', { name: /Show new line/ })).toBeNull()
  })
})
