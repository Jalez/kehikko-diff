import { trackerReadingResult } from 'kehikot-module-protocol'

/**
 * Which commit is at the head of a change, as the tracker last said.
 *
 * ## Why this is not read off `live.get`
 *
 * `live.get` is the reading that says what a ref IS and where it lives, and
 * for a long time it was also where this app took the head commit from. It
 * carries one only for an epic that has an imported state file, and that file
 * is a snapshot: a change pushed to since is still listed at its old head. An
 * epic without the file names no head at all, so nothing in it ever had a diff.
 *
 * The host keeps a second, shared reading of the trackers themselves, and the
 * head commit is in a ref's DETAIL there — which the host reads only for refs
 * somebody asked the detail of. So this app asks: `tracker.get` with
 * `detail: 'detail'` for the changes that are selected, and nothing else.
 *
 * ## Asking is not waiting
 *
 * `tracker.get` answers at once from what the host holds. A detail it has not
 * read comes back as a row without one, or under `missing` as `pending`, and
 * the host starts the read; `context.tracker.at` moves when it lands, and the
 * question is asked again then. So a head is `asking` until an answer names it
 * or a completed read has come back without it.
 */
export type Head =
  /** `since` is the reading's `at` when this was first asked; a later `at` means a read has landed since. */
  | { at: 'asking'; since: string | null | undefined }
  | { at: 'known'; sha: string }
  | { at: 'none'; why: string }

export type Heads = Readonly<Record<string, Head>>

const NONE = {
  'not-found': 'the tracker has nothing under that reference',
  'no-tracker': 'this project reads no tracker that reference could belong to',
  failed: 'the last read of its tracker failed',
} as const

/**
 * What one `tracker.get` answer says about each ref that was asked.
 *
 * `was` is what was believed before, and it matters twice: a head already
 * known is not un-known by an answer that merely lacks the detail, and a ref
 * that was already being asked gives up once a read has landed without it —
 * otherwise a detail the tracker would not give is a sentence that says
 * "asking" for ever.
 */
export function readHeads(refs: readonly string[], answer: unknown, was: Heads): Record<string, Head> {
  const parsed = trackerReadingResult.safeParse(answer)
  const out: Record<string, Head> = {}
  if (!parsed.success) {
    for (const ref of refs) out[ref] = { at: 'none', why: 'the host answered with something that is not a tracker reading' }
    return out
  }
  const reading = parsed.data
  for (const ref of refs) {
    const before = Object.hasOwn(was, ref) ? was[ref] : undefined
    const row = reading.rows.find((one) => one.ref === ref)
    if (row?.detail?.headSha) {
      out[ref] = { at: 'known', sha: row.detail.headSha }
      continue
    }
    if (row?.detail) {
      out[ref] = { at: 'none', why: 'the tracker was read and names no head commit for it' }
      continue
    }
    const missing = reading.missing.find((one) => one.ref === ref)
    if (missing && missing.reason !== 'pending') {
      out[ref] = { at: 'none', why: NONE[missing.reason] }
      continue
    }
    if (!row && !missing) {
      out[ref] = { at: 'none', why: 'the host did not answer for that reference' }
      continue
    }
    /* Not read yet. Keep what was known; otherwise wait — unless a read has
       landed since this was first asked and nothing is running now. */
    if (before?.at === 'known') {
      out[ref] = before
      continue
    }
    const since = before?.at === 'asking' && before.since !== undefined ? before.since : reading.at
    const landed = before?.at === 'asking' && before.since !== undefined && reading.at !== before.since
    out[ref] =
      landed && !reading.refreshing
        ? { at: 'none', why: 'the tracker was read and its head commit did not come back' }
        : { at: 'asking', since }
  }
  return out
}

/**
 * The commit a diff of this change should be fetched at: the tracker's, when
 * it has said; nothing while it is being asked; and only otherwise the one the
 * epic's own reading carries, which may be older than the change.
 */
export function headFor(readingSha: string, head: Head | undefined): string {
  if (head?.at === 'known') return head.sha
  if (head?.at === 'asking') return ''
  return readingSha
}
