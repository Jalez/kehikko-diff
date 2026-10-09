import { useCallback, useMemo, useRef, useState } from 'react'

import { HostRefused, type HostEvents, type Refusal } from 'kehikot-module-protocol/client'
import { useHost } from 'kehikot-module-protocol/client/react'
import { LIMITS, type ModuleContext } from 'kehikot-module-protocol'

import { readHeads, type Head, type Heads } from '@/live/heads.ts'

/**
 * The bridge, as one React value: the protocol's `useHost`, and this module's own reading of what
 * a host knows about the open epic on top of it.
 *
 * `useHost` is the listener — the connection stored before it listens, the greeting's grace
 * (`listening`, then `unhosted` or `hosted`), the theme put on `<html>`, the page that reloads
 * itself when it is older than its server. None of that is typed out here any more.
 *
 * ## What stays here, and why
 *
 * This module's whole honesty rests on telling one absence from another — a page nothing is
 * framing, from a host that refused the question, from an epic nothing has ever read. `useHost`
 * knows the first; the rest are answers to two things this page ASKS the host, and the state
 * machine around those questions is this file:
 *
 * - `live.get`, once per epic (not once per context — see `standingOn`), which is `sight`;
 * - `tracker.get`, for the head commit of each selected change, which is `heads`.
 *
 * Both are driven from `onHello` and `onContext` rather than derived in an effect, because the
 * difference between a greeting and a context is load-bearing here (a greeting always re-asks) and
 * an effect over the context cannot see it.
 */

/**
 * What this page can currently see of a host's reading.
 *
 * Six states rather than a nullable reading, for the reason the whole module
 * exists: `unhosted`, `no-epic`, `refused` and `unread` are four different
 * absences with four different remedies, and collapsing them would put "the
 * tracker had nothing to say" on a screen belonging to a program that has never
 * spoken to a tracker.
 */
export type Sight =
  | { at: 'listening' }
  | { at: 'unhosted' }
  | { at: 'no-epic' }
  | { at: 'asking'; epic: string }
  | { at: 'refused'; epic: string; refusal: Refusal }
  | { at: 'unread'; epic: string }
  | { at: 'read'; epic: string; live: unknown }

export interface Roadmap {
  sight: Sight
  /**
   * What the canvas has picked out, as the host last said it.
   *
   * Never what this page asked for — this page never asks. It declares no
   * `selection:set`, has no control that would set one, and its entire job is to
   * answer a question about what somebody else picked. So this is a fact
   * arriving, in the same family as which epic is open, and the only place it
   * comes from is `kehikot.context`.
   */
  selection: readonly string[]
  /**
   * The head commit of each change this page asked the tracker about, or that
   * it is still being asked, or why there is none. See `live/heads.ts`.
   */
  heads: Heads
  /**
   * When the host's shared tracker reading last changed, as the context says.
   * It moving is the signal that a detail asked for earlier may have landed.
   */
  trackerAt: string | null
  /** Ask the host for the head commit of these changes. Safe to call again with the same refs. */
  askHeads: (refs: readonly string[]) => void
  /** Say how tall this page would like its frame to be. Silent when nothing is framing it. */
  resize: (height: number) => void
}

/**
 * What to do when the host says "go to this reference".
 *
 * Handed in rather than handled here, because the answer depends on what is on
 * screen, and that is the view's business. The contract is the protocol's:
 * `answer` must be called, and calling it late is the same as not calling it —
 * see `GOTO_BACKSTOP_MS` in the protocol's client.
 */
export type GotoHandler = NonNullable<HostEvents['onGoto']>

export function useKehikot(id: string, onGoto: GotoHandler): Roadmap {
  /* What the host's reading of the open epic is, once anything is framing this page. Before that,
     `sight` below is `useHost`'s `where`. */
  const [reading, setReading] = useState<Exclude<Sight, { at: 'listening' } | { at: 'unhosted' }>>({ at: 'no-epic' })
  const [heads, setHeads] = useState<Heads>({})


  /**
   * Which question is the current one.
   *
   * Epics switch faster than a slow host answers, and without this the answer to
   * the previous epic arrives after the answer to this one and quietly replaces
   * it — the right refs under the right title, about the wrong work. Every answer
   * checks that it is still the one being waited for before it is allowed to
   * become the page.
   */
  const asking = useRef(0)

  /**
   * The epic the last context put this page on.
   *
   * This is the field that keeps the page still, and it is the single most
   * important line in the file for a module that reacts to a selection.
   *
   * A context is no longer a message that only ever means "the reader moved". It
   * carries the canvas's selection, so the host sends one after every selection
   * change ANYWHERE on the canvas — a click in References, a click in Journeys,
   * a click in a module written next year. Re-asking `live.get` on each of those
   * would throw the reading away and put this page back into `asking` every time
   * somebody selected a row: the diff on screen would vanish, a paragraph would
   * say the question was out, and it would come back a moment later having lost
   * the reader's place halfway down a patch. The click that caused it would look
   * like a bug in whichever module was clicked.
   *
   * Worse here than in a list, because the selection is what this page draws, and
   * worse again because the answer to it is a subprocess. The refetch would be
   * triggered by exactly the event the page is supposed to be responding to, so
   * the page would blank itself precisely when it was being asked to say
   * something — and would shell out again for a patch it already had.
   *
   * So the fetch is keyed to the epic CHANGING rather than to a context
   * arriving. A repeated context about the same epic is a normal event, and the
   * correct response to it is to read the parts that did change — the theme and
   * the selection — and to leave the reading alone.
   *
   * The cost, stated plainly: this page no longer refetches when a host re-sends
   * the same epic to mean "you were hidden and are visible again". That was never
   * a promise the protocol made, and the fix if it is ever wanted is a context
   * field saying so, not a refetch on every selection.
   *
   * Three values and not two: a slug, `null` for "the host says no epic is
   * open", and `undefined` for "no context has been read yet". Collapsing the
   * last two would make the first context of a conversation that names no epic
   * look like a repeat of a state the page was already in.
   */
  const standingOn = useRef<string | null | undefined>(undefined)

  /* Assigned below; read through a ref so `look` and `askHeads` can be stable and still reach it. */
  const request = useRef<ReturnType<typeof useHost>['request'] | null>(null)

  const look = useCallback((epic: string) => {
    const mine = (asking.current += 1)
    standingOn.current = epic
    setReading({ at: 'asking', epic })
    const ask = request.current
    if (!ask) return
    void ask(
      /**
       * Both spellings of the same name.
       *
       * `methodParams['live.get']` takes `{ epic }` in the protocol as it stands.
       * The hosts this workspace was built beside read `params.slug` and refuse
       * anything else — the package renamed this material and the hosts have not
       * all caught up. Sending only the newer key would make this app correct and
       * useless; sending only the older one would make it wrong the day a host is
       * updated. So it sends both, which no host can be confused by: each reads
       * the key it knows and neither sees a conflicting value, because there is
       * one name here spelled twice. The second key comes out when no host in the
       * field reads it.
       */
      'live.get', { epic, slug: epic })
      .then((data) => {
        if (asking.current !== mine) return
        /* `null` is a host's own word for "there is no reading for this epic". It
           is not an error and it is not an empty reading, and the six-way `Sight`
           exists so that it does not become either. */
        if (data === null || data === undefined) setReading({ at: 'unread', epic })
        else setReading({ at: 'read', epic, live: data })
      })
      .catch((error: unknown) => {
        if (asking.current !== mine) return
        setReading({
          at: 'refused',
          epic,
          refusal:
            error instanceof HostRefused
              ? error.refusal
              : { reason: 'failed', error: 'This app failed while reading the host’s answer.' },
        })
      })
  }, [])

  /**
   * Ask the tracker reading for the head commit of some changes.
   *
   * `detail: 'detail'`, because the head commit is in a ref's detail and the
   * host reads a detail only for refs somebody asked it of — which is why a
   * page that only ever asked `live.get` never saw one. The host answers at
   * once from what it holds and starts a read for the rest; the view asks
   * again when `trackerAt` moves.
   *
   * A refusal is an answer too: a host that keeps no tracker reading, or one
   * that will not give this module `trackers:read`, leaves every ref with no
   * head from here, and the page falls back to the one the epic's own reading
   * carries. Nothing here retries.
   *
   * The same `asking` number as `look`: an answer about the epic that was just
   * left must not file its heads under the one that is open now.
   */
  const askHeads = useCallback((refs: readonly string[]) => {
    const ask = request.current
    if (!ask || !refs.length) return
    const asked = refs.slice(0, LIMITS.TRACKER_ASK)
    const mine = asking.current
    const fill = (made: (was: Heads) => Record<string, Head>) =>
      setHeads((was) => (asking.current === mine ? { ...was, ...made(was) } : was))
    /* Said at once, so the page reads "asking the tracker" rather than the
       sentence for a head nobody has. `since` is filled in by the answer. */
    fill((was) =>
      Object.fromEntries(asked.filter((ref) => !Object.hasOwn(was, ref)).map((ref) => [ref, { at: 'asking', since: undefined } as Head])),
    )
    void ask('tracker.get', { refs: asked, detail: 'detail' })
      .then((data) => fill((was) => readHeads(asked, data, was)))
      .catch((error: unknown) => {
        const why =
          error instanceof HostRefused ? `Kehikot would not say: ${error.refusal.error}` : 'this app failed while reading the host’s answer'
        /* A head already known survives a refusal; only the unanswered ones give up. */
        fill((was) => Object.fromEntries(asked.filter((ref) => was[ref]?.at !== 'known').map((ref) => [ref, { at: 'none', why } as Head])))
      })
  }, [])

  /**
   * What the greeting and every later context both do — about the READING. The theme, the
   * selection and the tracker's clock are `useHost`'s, read straight off the context it holds.
   */
  const arrived = (context: ModuleContext, greeting: boolean) => {
    /* A greeting always re-asks, because a greeting means the conversation is
       new: the host greets on every frame LOAD, so one arriving is a page that
       has just come into existence, or a frame that reloaded and has forgotten
       everything it knew. Answering that with "the epic has not changed, so
       there is nothing to do" would leave a page with no reading and no
       question outstanding, forever.

       `StrictMode` is the case that proves it in the smallest possible space.
       The listening effect in `useHost` is torn down and set up again on purpose in development;
       the teardown refuses every question still in flight, and the setup
       replays the greeting out of the mailbox. If the replayed greeting were
       deduplicated against the epic the refused question had been about, the
       page would settle on the refusal and stay there — in development only,
       which is the worst place for a bug to live. */
    if (greeting) standingOn.current = undefined

    const moved = context.epic !== standingOn.current
    standingOn.current = context.epic
    if (!moved) return

    /* The heads were asked for the epic that was open. A ref spelled the same
       in the next one is the next one's to ask about. */
    setHeads({})

    if (context.epic) look(context.epic)
    else {
      /* Moving to no epic is a move like any other: whatever `live.get` is
         still out was asked about the epic that was just closed. */
      asking.current += 1
      setReading({ at: 'no-epic' })
    }
  }

  const host = useHost(id, {
    onGoto,
    onHello: (context) => arrived(context, true),
    onContext: (context) => arrived(context, false),
  })
  request.current = host.request

  const sight = useMemo<Sight>(
    () => (host.where === 'hosted' ? reading : { at: host.where }),
    [host.where, reading],
  )
  /* Absent from a host older than the shared tracker reading, and then it never moves — which is
     right: such a host has no detail to wait for. */
  const trackerAt = host.context?.tracker?.at ?? null
  const { selection, resize } = host

  return useMemo(
    () => ({ sight, selection, heads, trackerAt, askHeads, resize }),
    [sight, selection, heads, trackerAt, askHeads, resize],
  )
}
