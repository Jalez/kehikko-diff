import type { Patch } from '@/diff/ask.ts'
import type { Found } from '@/live/lookup.ts'

import { PatchView } from './patch-view.tsx'

/**
 * One selected reference, whatever it turns out to be.
 *
 * ## Six outcomes, and five of them are not a diff
 *
 * The whole difficulty of this module is that "show the diff" has one happy
 * answer and several ordinary unhappy ones, and every one of the unhappy ones is
 * a different sentence sending the reader somewhere different:
 *
 * - The reference is an ISSUE. It has no diff — not an empty one, none. This is
 *   the state the brief calls out by name and it is deliberately not an error:
 *   somebody selected a thing, this pane read what kind of thing it is, and the
 *   honest answer is that this kind does not have what this pane shows.
 * - The reference is not in the reading at all. Somebody picked it from a pane
 *   showing another epic, or nothing has ever refreshed it.
 * - It is a change and the reading has no address for it, so nothing can be
 *   fetched.
 * - It is a change whose head commit the reading does not name, so a diff
 *   fetched now could not be filed against anything.
 * - The CLI said no — not logged in, no such repository, not installed.
 * - And it worked.
 *
 * A single "no diff available" over all six would be this pane telling a reader
 * nothing at the exact moment it has something specific to say.
 *
 * ## The header is drawn for every one of them
 *
 * Including the ones with nothing under it. A selected reference that produced
 * no visible row would be indistinguishable from a selection that never
 * happened, and that is the failure this codebase keeps writing rules against.
 */

export type Ask =
  | { at: 'asking' }
  | { at: 'ok'; patch: Patch }
  | { at: 'error'; error: string }

/** Enough of a sha to recognise, which is all a person ever reads. */
const short = (sha: string) => (sha.length > 9 ? sha.slice(0, 9) : sha)

export function Change({
  refName,
  found,
  ask,
  onAsk,
  epic,
}: {
  refName: string
  found: Found | undefined
  ask: Ask | undefined
  onAsk: () => void
  epic: string | null
}) {
  return (
    <section className="flex min-w-0 flex-col gap-1" data-ref={refName} data-kind={found?.kind ?? 'unknown'}>
      <h2 className="text-[0.75rem] leading-4 font-semibold">
        <span className="font-mono">{refName}</span>
        {found?.title ? <span className="font-normal"> {found.title}</span> : null}
      </h2>

      {found ? (
        <p className="text-[0.7rem] leading-4 text-muted-foreground">
          {found.kind === 'change' ? 'change' : 'issue'}
          {found.state ? ` · ${found.state}` : ''}
          {found.sha ? ` · ${short(found.sha)}` : ''}
          {found.url ? (
            <>
              {' · '}
              {/* `noreferrer` as well as `noopener`: this page may be running on
                  an opaque origin depending on how a host framed it, and a
                  referrer of "null" is no use to anybody while a real one leaks
                  which roadmap somebody is reading. */}
              <a className="underline underline-offset-2" href={found.url} target="_blank" rel="noopener noreferrer">
                open on the tracker
              </a>
            </>
          ) : null}
        </p>
      ) : null}

      <Body refName={refName} found={found} ask={ask} onAsk={onAsk} epic={epic} />
    </section>
  )
}

function Body({
  refName,
  found,
  ask,
  onAsk,
  epic,
}: {
  refName: string
  found: Found | undefined
  ask: Ask | undefined
  onAsk: () => void
  epic: string | null
}) {
  const note = (text: string) => <p className="text-[0.7rem] leading-4 text-muted-foreground">{text}</p>

  if (!found) {
    return note(
      epic
        ? `Nothing in the roadmap’s reading of ${epic} is filed under ${refName}, so this app cannot tell what kind of thing it is or where it lives. That happens when a reference is picked from a pane showing another epic, or when nothing has refreshed it yet.`
        : `No epic is open, so there is no reading to look ${refName} up in.`,
    )
  }

  if (found.unreadable) {
    return note(
      `The reading has an entry for ${refName} but what is under it is not a record this app can read — so the kind is known and nothing else is. There is no address to fetch a diff from.`,
    )
  }

  /*
   * The sentence the brief asks for by name, and the reasoning behind it is
   * worth keeping next to it. An issue has no diff, and the ONLY reason this
   * page can say so with confidence is that `live.get` filed this ref in
   * `ghIssues` rather than `ghPrs`. GitHub numbers both in one sequence and
   * spells both `gh#`, so nothing about the string `gh#131` will ever say which
   * it is. The bag said. That is a fact, not a guess, and it deserves to be
   * stated as one rather than dressed up as a failure to find a diff.
   */
  if (found.kind === 'work') {
    return note(
      `${refName} is an issue rather than a change, so there is no diff to show. Nothing went wrong: the roadmap filed it under issues, and an issue has no commits of its own.`,
    )
  }

  if (!found.url) {
    return note(
      `The reading knows ${refName} is a change and does not say where it lives, so there is no address to ask a tracker about. Refreshing the epic is what would fill that in.`,
    )
  }

  if (!found.sha) {
    /* Refused here rather than fetched anyway, and the reason is the cache. Every
       patch is filed under the head commit it belongs to; a fetch with no sha
       would have to be filed under nothing, which is a key every unshaed change
       would share — one change's diff answering under another change's name.
       That is the worst way this could go wrong, so it is not possible. */
    return note(
      `The reading names no head commit for ${refName}, so a diff fetched now could not be filed against anything and this app will not guess. Refresh the epic and it will be there.`,
    )
  }

  if (!ask) {
    return (
      <p className="text-[0.7rem] leading-4">
        <button type="button" className="cursor-pointer underline underline-offset-2" onClick={onAsk}>
          Show the diff of {refName}
        </button>
        <span className="text-muted-foreground">
          {' '}
          — it is not fetched yet, because reading it means running the tracker’s own command line.
        </span>
      </p>
    )
  }

  if (ask.at === 'asking') {
    /* An honest spinner: something IS coming, and the sentence says what. The
       command being named is not decoration — it is the difference between a
       reader who waits and one who wonders whether the pane is stuck. */
    return note(`Running ${found.origin === 'github' ? 'gh' : 'glab'} for the diff of ${refName}…`)
  }

  if (ask.at === 'error') {
    return (
      <div className="flex flex-col gap-1">
        {/* The CLI's own words, verbatim. `gh` says "gh auth login" when a token
            has expired, and that sentence is worth more to the person reading
            this than any paraphrase this app could write. */}
        <p className="text-[0.7rem] leading-4">{ask.error}</p>
        <p className="text-[0.7rem] leading-4">
          <button type="button" className="cursor-pointer underline underline-offset-2" onClick={onAsk}>
            Try again
          </button>
        </p>
      </div>
    )
  }

  return (
    <div className="flex min-w-0 flex-col gap-1">
      <PatchView patch={ask.patch} />
      {/*
        Where this came from, said every time.

        The sha is the cache key, and the cache's one honest failure is that the
        sha came from a reading that is a snapshot: a change pushed to since the
        last refresh has a head this app has never been told about, and both
        caches will answer confidently for the old one. Nothing here can detect
        that. Printing the commit the patch belongs to is what gives a reader
        whose diff does not match what they just pushed the fact that explains it.
      */}
      <p className="text-[0.7rem] leading-4 text-muted-foreground">
        This is {short(ask.patch.sha)}, the head the roadmap’s last reading saw
        {ask.patch.from === 'cache' ? ', answered from this app’s cache' : ''}. A commit pushed since that reading would
        not be in it.
      </p>
    </div>
  )
}
