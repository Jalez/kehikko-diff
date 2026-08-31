import type { FileDiff } from './parse.ts'

/**
 * How much of a diff is drawn before the reader has to ask for more.
 *
 * ## The failure this is against
 *
 * A pull request that regenerates a lockfile is forty thousand lines. Rendered
 * as forty thousand DOM nodes into a container three hundred pixels wide, the browser
 * stops answering — not slowly, not with a spinner, but a locked tab in the
 * middle of somebody's canvas with four other modules in it. The change that
 * does this is an ordinary change; nobody did anything wrong; and the module
 * looks broken rather than busy.
 *
 * ## And the failure the fix must not become
 *
 * Truncating silently. A diff that quietly stopped at file eleven of thirty is
 * worse than one that locked the container, because the reader believes it: they
 * looked, and the file they were worried about was not touched. That is the
 * `collect.ts` rule again — a missing row looks exactly like a row that was
 * never meant to be there — and it is the reason this file returns a `heldBack`
 * count rather than a shorter list.
 *
 * ## So: every file is always listed, and content is what is budgeted
 *
 * Two limits, and they do different jobs.
 *
 * - `OPEN_LINES` decides how many files start open. Files are opened from the
 *   top until the next one would take the total past it. The rest are still
 *   drawn — path, status, and how many lines each way — and open when pressed.
 *   So the list of what a change touched is ALWAYS complete and always immediate;
 *   what is deferred is only the content.
 * - `FILE_LINES` caps one file. Past it the file renders its first `FILE_LINES`
 *   lines and says how many are held back, with a control to render the next
 *   `FILE_LINES`. This is what stops a single enormous file from being the whole
 *   problem, which the first limit alone cannot: opening it is the reader's own
 *   choice and they should not be punished for it.
 *
 * The first file is opened whatever its size, because a container that opens nothing
 * is a container that looks like it failed. `FILE_LINES` is what keeps that safe.
 *
 * ## The numbers, and why these ones
 *
 * Measured against the shape of the changes in this workspace rather than
 * guessed: a typical change here is three to ten files and a few hundred lines,
 * which fits under `OPEN_LINES` entirely and is drawn whole with no controls
 * shown at all. That is the case worth optimising — the limits should be
 * invisible until a diff is genuinely large.
 */
export const OPEN_LINES = 1200

/** And one file's share. Roughly a long screenful in a narrow container, several times over. */
export const FILE_LINES = 800

export interface Plan {
  /** The indexes of the files that start open. */
  open: Set<number>
  /** How many files are drawn closed. Zero for almost every real change. */
  closed: number
  /** How many lines of content those closed files hold. Said out loud on the container. */
  heldBack: number
}

/**
 * Which files to open, given the whole list.
 *
 * Pure, and keyed on the parsed files rather than on anything about a browser,
 * so the decision is a thing a test can hold. It is deliberately not a
 * "virtualised list": virtualisation would let every file be open at once and is
 * genuinely better, and it is also a scroll container that lies about its own
 * height inside a container that is being resized by a host. A reader pressing a file
 * name is a smaller mechanism that cannot be subtly wrong.
 *
 * Indexes rather than paths, because a malformed patch can name the same path
 * twice: two entries sharing a name must open and close independently, and a
 * path-keyed answer would tie them together — a small wrongness whose cause
 * would take an hour to find.
 */
export function plan(files: FileDiff[]): Plan {
  const open = new Set<number>()
  let spent = 0
  let closed = 0
  let heldBack = 0

  for (const [at, file] of files.entries()) {
    /* The first file always opens. A container whose every file is shut looks like a
       container that failed to load one, and `FILE_LINES` already stops the one open
       file from being unbounded. */
    if (at === 0 || spent + file.lines <= OPEN_LINES) {
      open.add(at)
      spent += file.lines
    } else {
      closed += 1
      heldBack += file.lines
    }
  }

  return { open, closed, heldBack }
}
