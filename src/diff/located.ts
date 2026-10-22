import type { CodeLocation, SharedLocation } from 'kehikot-module-protocol'

import type { DiffLine, FileDiff } from './parse.ts'

/**
 * A code location (protocol 2.13.0) against a patch: which file it is in,
 * which of the patch's lines it names, and what a press on a line points at.
 *
 * `side` decides the gutter. A `new` location counts lines on the change's
 * head, the right-hand numbers — added and context lines. An `old` one counts
 * on its base, the left-hand numbers — removed and context lines. Pure, so
 * `test/located.test.ts` is a table.
 */

/** The lines a location names in one file, and when it was pointed (a repeat scrolls again). */
export interface Spot {
  side: 'new' | 'old'
  from: number
  to: number
  at: string | null
}

/** Whether a location is about this file of this change: its path on the side it counts. */
export function spotIn(location: SharedLocation | null, change: string, file: FileDiff): Spot | null {
  if (!location || location.change !== change) return null
  const name = location.side === 'old' ? (file.from ?? file.path) : file.path
  if (name !== location.path) return null
  return { side: location.side, from: location.line, to: location.endLine ?? location.line, at: location.at ?? null }
}

/** Whether a line of the patch is one the spot names, by the gutter its side reads. */
export function named(line: DiffLine, spot: Spot | null): boolean {
  if (!spot || line.kind === 'note') return false
  const at = spot.side === 'old' ? line.old : line.new
  return at !== null && at >= spot.from && at <= spot.to
}

/** How many of the file's lines come before the first one the spot names, or -1 when it names none in the patch. */
export function reach(file: FileDiff, spot: Spot | null): number {
  if (!spot) return -1
  let counted = 0
  for (const hunk of file.hunks) {
    for (const line of hunk.lines) {
      if (named(line, spot)) return counted
      counted += 1
    }
  }
  return -1
}

/**
 * Where a press on a line points. `comment` on the line itself — the new side
 * for an added or a context line, the old side for a removed one; `old` and
 * `new` on that gutter's number. Null for a note, or a gutter with no number.
 */
export function placeOf(line: DiffLine, which: 'comment' | 'old' | 'new'): { side: 'new' | 'old'; line: number } | null {
  if (line.kind === 'note') return null
  const side = which === 'comment' ? (line.kind === 'del' ? 'old' : 'new') : which
  const number = side === 'old' ? line.old : line.new
  return number === null ? null : { side, line: number }
}

/**
 * The location a press sends. The new side carries the head commit the patch
 * was read at; the old side carries none, because the base a patch is counted
 * on is not a commit this app was told.
 */
export function locationAt(change: string, file: FileDiff, place: { side: 'new' | 'old'; line: number }, head: string): CodeLocation {
  const path = place.side === 'old' ? (file.from ?? file.path) : file.path
  const commit = place.side === 'new' && /^[0-9a-f]{7,64}$/.test(head) ? { commit: head } : {}
  return { change, path, line: place.line, side: place.side, ...commit }
}
