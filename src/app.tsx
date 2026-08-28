import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { ID } from '../manifest.ts'

import { askDiff } from '@/diff/ask.ts'
import { generatedAt, index, type Found } from '@/live/lookup.ts'
import { Change, type Ask } from '@/view/change.tsx'
import { useRoadmap, type GotoHandler, type Sight } from '@/wire/use-roadmap.ts'

/**
 * The page.
 *
 * ## What it shows
 *
 * The diff of whichever change is selected on the canvas. The selection arrives
 * as `context.selection` — refs and nothing else, deliberately — and everything
 * that turns `gh#105` into a patch comes from one `live.get`: the bag says it is
 * a change, the `url` says which repository, the `sha` says which commit. See
 * `live/lookup.ts` for why the bag is the only thing that can say the first of
 * those.
 *
 * ## Several references selected, and what this pane does about it
 *
 * It draws ALL of them, in the order the host sent them, each as its own
 * section, and it fetches exactly one: the first that is a change with an
 * address and a head. Everything else — including the second change — is drawn
 * with its header and a control that says "Show the diff of gh#103".
 *
 * The alternative designs and why they lost:
 *
 * - **Show only the first change, drop the rest.** Refuse. A selected reference
 *   that produces nothing on screen is indistinguishable from a selection that
 *   never happened, and this codebase has a standing rule about exactly that: a
 *   missing row looks exactly like a row that was never meant to be there. If
 *   somebody selects four things, four things appear.
 * - **Fetch all of them.** Refuse, and this is the one that would have felt
 *   generous. Every fetch is a subprocess against somebody's rate limit and, on
 *   a slow connection, several seconds of a pane doing nothing. The protocol
 *   caps a selection at 32 refs, so "all of them" has a worst case of 32
 *   concurrent `gh` invocations started by one click in another module. And it
 *   is work almost nobody wants: at 220 pixels a reader is looking at one diff.
 * - **Fetch none, make the reader press even for one.** Refuse. The overwhelming
 *   case is one change selected, and making somebody press a button to see the
 *   thing they just selected is a pane that does not do its job.
 *
 * So: one automatic fetch, every other diff one press away, and the press is
 * labelled with what it will do. The cost is stated on screen rather than
 * hidden — "it is not fetched yet, because reading it means running the
 * tracker's own command line" — because a control whose price is invisible is a
 * control people learn to distrust.
 *
 * ## Identity is printed only when nothing is framing this page
 *
 * A host prints the module's name in the pane header and hangs the manifest's
 * `summary` off it. A page that also printed "Diff" at the top of itself would
 * be saying the name twice and spending a fixed strip of a 340-pixel-tall pane
 * on the repetition. Unframed there is no pane header and nothing else would
 * ever say what this program is, so the heading stays. The test is
 * `window.parent !== window`, which is answerable before first paint and
 * therefore does not blink.
 */
const framed = typeof window !== 'undefined' && window.parent !== window

export function App() {
  const [got, setGot] = useState<Record<string, Ask>>({})

  /**
   * Which fetches have been started, keyed exactly as the answers are.
   *
   * A ref rather than state, because it is read inside the callback that starts
   * a fetch and must be current at that instant — a state read there would be
   * whatever it was at the last render, which is how a page ends up running the
   * same subprocess twice for one click.
   *
   * A key survives success and is dropped on failure, which is what makes "Try
   * again" a real retry and a second automatic pass a no-op. The key includes
   * the head sha, so a change that gets a new commit is a new key and is fetched
   * again with no invalidation logic anywhere — the same argument the two caches
   * are built on.
   */
  const started = useRef(new Set<string>())

  const onGoto = useCallback<GotoHandler>((message, answer) => {
    /* A `goto` may name an epic, a step, or a reference, and only the last is a
       thing this pane draws. Answering "not found" for the other two is honest
       rather than a failure: this page has no epic of its own to move to and no
       steps at all. Saying so quickly is what gets the reader the host's
       fallback link instead of a twelve-second wait. */
    const ref = message.ref
    if (!ref) {
      answer(false, 'This pane shows the diff of a selected change, so there is nothing here to walk to by epic or step.')
      return
    }
    const section = document.querySelector(`[data-ref="${CSS.escape(ref)}"]`)
    if (!section) {
      answer(false, 'This pane is showing what the canvas has selected, and that reference is not among them.')
      return
    }
    section.scrollIntoView({ block: 'start', behavior: 'smooth' })
    answer(true, '')
  }, [])

  const { sight, selection, resize } = useRoadmap(ID, onGoto)

  /**
   * The references to draw, memoised on their SPELLING rather than on the array.
   *
   * `selection` is a new array on every context even when it names the same
   * refs, and the host sends a context after every selection change anywhere on
   * the canvas. A memo keyed on array identity is no memo at all, and everything
   * downstream of this — including the automatic fetch — would fire on each one.
   * The joined key is the honest dependency: what this page cares about is which
   * references are picked, not which array carried them.
   */
  const key = selection.join(' ')
  const refs = useMemo(() => (key ? key.split(' ') : []), [key])

  /** Everything the open epic's reading says, by the spelling people write. */
  const reading = useMemo(() => (sight.at === 'read' ? index(sight.live) : new Map<string, Found>()), [sight])

  const entries = useMemo(() => refs.map((ref) => ({ ref, found: reading.get(ref) })), [refs, reading])

  const ask = useCallback((found: Found) => {
    const at = `${found.ref}|${found.sha}`
    if (started.current.has(at)) return
    started.current.add(at)
    setGot((was) => ({ ...was, [at]: { at: 'asking' } }))
    void askDiff(found.url, found.sha).then((answer) => {
      if (!answer.ok) started.current.delete(at)
      setGot((was) => ({
        ...was,
        [at]: answer.ok ? { at: 'ok', patch: answer.patch } : { at: 'error', error: answer.error },
      }))
    })
  }, [])

  /**
   * The one automatic fetch.
   *
   * Keyed on the ref and the sha of the first fetchable change rather than on
   * the entries themselves, because `entries` is rebuilt whenever a context
   * arrives and this must not fire on a context that changed nothing this page
   * cares about. `ask` is idempotent on the same key anyway — belt and braces,
   * and the braces are the cheaper of the two to reason about.
   */
  const auto = useMemo(
    () => entries.find((e) => e.found && !e.found.unreadable && e.found.kind === 'change' && e.found.url && e.found.sha)?.found,
    [entries],
  )
  const autoRef = auto?.ref ?? ''
  const autoSha = auto?.sha ?? ''
  useEffect(() => {
    if (auto && autoRef && autoSha) ask(auto)
    /* `auto` itself is deliberately not a dependency: it is a fresh object every
       time the reading is rebuilt, and depending on it would make this effect
       fire on contexts that changed nothing. The two strings are the identity. */
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoRef, autoSha, ask])

  /** Say how tall we would like to be, whenever what is drawn changes size. */
  const shell = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    const node = shell.current
    if (!node || typeof ResizeObserver === 'undefined') return
    const watch = new ResizeObserver(() => resize(Math.ceil(node.getBoundingClientRect().height) + 16))
    watch.observe(node)
    return () => watch.disconnect()
  })

  const epic = sight.at === 'read' || sight.at === 'asking' || sight.at === 'unread' || sight.at === 'refused' ? sight.epic : null
  const taken = sight.at === 'read' ? generatedAt(sight.live) : null

  return (
    <div ref={shell} className="flex min-w-0 flex-col gap-2 p-2 text-foreground">
      {framed ? null : (
        <header>
          <h1 className="text-sm font-semibold">Diff</h1>
          <p className="text-[0.7rem] leading-4 text-muted-foreground">
            The diff of whichever change is selected on a canvas, file by file. The patch is read by running{' '}
            <code>gh pr diff</code> or <code>glab mr diff</code> on this machine — this app holds no token of its own —
            and which reference is a change, where it lives and which commit is at its head all come from a roadmap’s
            reading of the open epic. With nothing framing this page there is no selection and no reading, so there is
            nothing here to show.
          </p>
        </header>
      )}

      {entries.length ? (
        <>
          <p className="text-[0.7rem] leading-4 text-muted-foreground">
            {entries.length === 1 ? 'One reference is' : `${entries.length} references are`} selected on the canvas
            {taken ? `; the roadmap last read this epic at ${taken}` : ''}.
          </p>
          {entries.map((entry) => (
            <Change
              key={entry.ref}
              refName={entry.ref}
              found={entry.found}
              ask={entry.found ? got[`${entry.found.ref}|${entry.found.sha}`] : undefined}
              onAsk={() => entry.found && ask(entry.found)}
              epic={epic}
            />
          ))}
        </>
      ) : (
        <Sightline sight={sight} />
      )}
    </div>
  )
}

/**
 * What this page can currently see, in words, when nothing is selected.
 *
 * Seven sentences for seven states, and they are seven because they send a
 * reader to seven different places. "Nothing is framing this page" and "the host
 * refused the question" and "the host has no reading for this epic" are not
 * shades of one disappointment, and a single "no diff" over all of them would be
 * this app saying nothing at the exact moment it has something specific to say.
 *
 * None of them is a spinner. `listening` says what it is waiting for and lasts
 * under a second.
 *
 * The last one — a reading in hand and nothing picked — is the state this pane
 * spends most of its life in, and it is the one that has to explain the
 * mechanism, because a person looking at an empty pane has no way to guess that
 * the thing that fills it is a click somewhere else on the canvas.
 */
function Sightline({ sight }: { sight: Sight }) {
  const said =
    sight.at === 'listening'
      ? 'Waiting to hear whether anything is framing this page.'
      : sight.at === 'unhosted'
        ? 'Nothing is framing this page, so nothing has said which change to show. This app has no list of its own to fall back on: what it shows is decided entirely by what a canvas has selected.'
        : sight.at === 'no-epic'
          ? 'A roadmap is here and no epic is open, so there is nothing to select a change out of.'
          : sight.at === 'asking'
            ? `Asking the roadmap what it last read about ${sight.epic}.`
            : sight.at === 'refused'
              ? `The roadmap was asked what it last read about ${sight.epic} and said no: ${sight.refusal.error} Without that reading this app cannot tell a pull request from an issue, or find out where either of them lives.`
              : sight.at === 'unread'
                ? `The roadmap has no reading for ${sight.epic} — nothing has been refreshed from a tracker for it. Refresh the epic and a selected change will have an address and a head commit to fetch by.`
                : 'Nothing is selected on the canvas. Pick a merge request or a pull request in another pane and its diff appears here.'
  return <p className="text-[0.7rem] leading-4 text-muted-foreground">{said}</p>
}
