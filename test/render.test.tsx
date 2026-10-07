import { describe, expect, test } from 'bun:test'
import { render, screen } from '@testing-library/react'

import type { Patch } from '../src/diff/ask.ts'
import { parseDiff } from '../src/diff/parse.ts'
import type { Found } from '../src/live/lookup.ts'
import { Change } from '../src/view/change.tsx'

/**
 * The words on screen, asserted by rendering the real components.
 *
 * The words ARE the module: every state this container can be in has its own
 * sentence, and the whole argument against a single "no diff available" is that
 * the sentences send a reader to different places. A test that checked for a
 * component rather than for what it says would let all six collapse into one
 * without failing.
 */

const change = (over: Partial<Found> = {}): Found => ({
  ref: 'gh#105',
  kind: 'change',
  origin: 'github',
  url: 'https://github.com/o/r/pull/105',
  sha: '48d720233c0a4d6900bf1b4967e12760ebc5fdda',
  title: 'The settings dialog says which commit it is running',
  state: 'merged',
  unreadable: false,
  ...over,
})

const patch = (text: string): Patch => ({ files: parseDiff(text), text, truncated: false, sha: 'abc123def', from: 'cli' })

const nothing = () => {}

describe('Change', () => {
  test('an issue says it is an issue and why that means no diff', () => {
    /* The state the brief names. It is not an error and must never read as one:
       Kehikot filed it under issues, and an issue has no commits of its own. */
    render(
      <Change
        refName="gh#131"
        found={change({ ref: 'gh#131', kind: 'work', url: 'https://github.com/o/r/issues/131', sha: '' })}
        ask={undefined}
        onAsk={nothing}
        epic="modes-are-modules"
      />,
    )
    expect(screen.getByText(/is an issue rather than a change/)).toBeTruthy()
    expect(screen.queryByText(/Show the diff/)).toBeNull()
  })

  test('a reference the reading has never heard of is drawn anyway, with its own sentence', () => {
    /* Never dropped. A selected reference that produced nothing on screen is
       indistinguishable from a selection that never happened. */
    const { container } = render(
      <Change refName="gh#9999" found={undefined} ask={undefined} onAsk={nothing} epic="modes-are-modules" />,
    )
    expect(container.querySelector('[data-ref="gh#9999"]')).toBeTruthy()
    expect(screen.getByText(/is filed under gh#9999/)).toBeTruthy()
  })

  test('a change with no head commit is refused in words rather than fetched', () => {
    render(<Change refName="gh#105" found={change({ sha: '' })} ask={undefined} onAsk={nothing} epic="e" />)
    expect(screen.getByText(/Nobody has named a head commit for gh#105/)).toBeTruthy()
  })

  test('while the tracker is being asked for the head, it says that and not that there is none', () => {
    const { container } = render(
      <Change refName="!3105" found={change({ ref: '!3105', sha: '' })} head={{ at: 'asking', since: null }} ask={undefined} onAsk={nothing} epic="e" />,
    )
    expect(container.textContent).toContain('Asking the tracker for !3105’s head commit…')
    expect(container.textContent).not.toContain('Nobody has named')
  })

  test('with no head, it says why, and suggests a refresh only where one would help', () => {
    const failed = render(
      <Change refName="!1" found={change({ ref: '!1', sha: '' })} head={{ at: 'none', why: 'the last read of its tracker failed' }} ask={undefined} onAsk={nothing} epic="e" />,
    )
    expect(failed.container.textContent).toContain('the last read of its tracker failed')
    expect(failed.container.textContent).toContain('Refreshing the trackers may bring it.')
    const absent = render(
      <Change refName="!2" found={change({ ref: '!2', sha: '' })} head={{ at: 'none', why: 'the tracker has nothing under that reference' }} ask={undefined} onAsk={nothing} epic="e" />,
    )
    expect(absent.container.textContent).toContain('the tracker has nothing under that reference')
    expect(absent.container.textContent).not.toContain('Refresh')
  })

  test('a change that has not been asked for offers to ask, and says what that costs', () => {
    render(<Change refName="gh#105" found={change()} ask={undefined} onAsk={nothing} epic="e" />)
    expect(screen.getByText('Show the diff of gh#105')).toBeTruthy()
    expect(screen.getByText(/running the tracker’s own command line/)).toBeTruthy()
  })

  test('a refusal shows the CLI’s own words and offers to try again', () => {
    render(
      <Change
        refName="gh#105"
        found={change()}
        ask={{ at: 'error', error: 'gh: To get started with GitHub CLI, please run: gh auth login' }}
        onAsk={nothing}
        epic="e"
      />,
    )
    expect(screen.getByText(/gh auth login/)).toBeTruthy()
    expect(screen.getByText('Try again')).toBeTruthy()
  })

  test('a patch renders its files, its line numbers and the commit it belongs to', () => {
    const { container } = render(
      <Change
        refName="gh#105"
        found={change()}
        ask={{
          at: 'ok',
          patch: patch(`diff --git a/src/one.ts b/src/one.ts
--- a/src/one.ts
+++ b/src/one.ts
@@ -10,2 +10,2 @@
-was this
+is this
`),
        }}
        onAsk={nothing}
        epic="e"
      />,
    )
    expect(container.querySelector('[data-file="src/one.ts"]')).toBeTruthy()
    expect(screen.getByText('is this')).toBeTruthy()
    expect(screen.getByText('was this')).toBeTruthy()
    /* The sha is on screen because the cache's one honest failure is a reading
       that has gone stale, and this is the fact that explains it. */
    expect(screen.getByText(/abc123def/)).toBeTruthy()
  })

  test('a truncated patch says so rather than looking complete', () => {
    render(
      <Change
        refName="gh#105"
        found={change()}
        ask={{
          at: 'ok',
          patch: { ...patch('diff --git a/a b/a\n--- a/a\n+++ b/a\n@@ -1 +1 @@\n+x\n'), truncated: true },
        }}
        onAsk={nothing}
        epic="e"
      />,
    )
    expect(screen.getByText(/cut off part-way/)).toBeTruthy()
  })

  test('an empty diff is a state, not an error', () => {
    render(
      <Change refName="gh#105" found={change()} ask={{ at: 'ok', patch: patch('') }} onAsk={nothing} epic="e" />,
    )
    expect(screen.getByText(/change with no commits against its base/)).toBeTruthy()
  })

  /**
   * The two properties the house components must not quietly lose.
   *
   * Both are asserted on the RESULT rather than on the component: a badge that
   * stops carrying its sign, or a file body that stops being its own scroll
   * container, is a regression a reader sees and a type checker does not.
   */
  test('every count is signed, so the two of them are told apart by more than colour', () => {
    const { container } = render(
      <Change
        refName="gh#105"
        found={change()}
        ask={{
          at: 'ok',
          patch: patch(`diff --git a/src/one.ts b/src/one.ts
--- a/src/one.ts
+++ b/src/one.ts
@@ -10,2 +10,2 @@
-was this
+is this
`),
        }}
        onAsk={nothing}
        epic="e"
      />,
    )
    const badges = [...container.querySelectorAll('[data-slot="badge"]')].map((b) => b.textContent ?? '')
    /* Two for the file and two for the patch as a whole, and every one of them
       begins with a sign. Red and green are the pair the commonest colour
       blindness merges; a number with no sign in front of it would be readable
       only to whoever can separate the hues. */
    const counts = badges.filter((t) => /^[+−]/.test(t))
    expect(counts.length).toBeGreaterThanOrEqual(4)
    expect(counts).toContain('+1')
    expect(counts).toContain('−1')
  })

  test('a long line wraps inside its text column, beside gutters that do not give', () => {
    const { container } = render(
      <Change
        refName="gh#105"
        found={change()}
        ask={{
          at: 'ok',
          patch: patch(`diff --git a/src/one.ts b/src/one.ts
--- a/src/one.ts
+++ b/src/one.ts
@@ -10,2 +10,2 @@
-was this
+${'x'.repeat(4000)}
`),
        }}
        onAsk={nothing}
        epic="e"
      />,
    )
    const file = container.querySelector('[data-file="src/one.ts"]')
    expect(file).toBeTruthy()
    /* The classes are the contract with `index.css`, where the row is told to
       wrap. A happy-dom lays nothing out, so the pixel version of this claim is
       measured in a browser; what is asserted here is that the text is the
       part of the row allowed to give — `min-w-0` and `flex-1` — and that the
       gutters beside it are not. */
    const row = file?.querySelector('.diff-row:not(.bg-muted)')
    const cells = Array.from(row?.children ?? [])
    expect(cells.at(-1)?.className).toContain('min-w-0')
    expect(cells.at(-1)?.className).toContain('flex-1')
    for (const gutter of cells.slice(0, -1)) expect(gutter.className).toContain('shrink-0')
    expect(file?.querySelectorAll('.diff-row').length).toBeGreaterThan(0)
  })
})
