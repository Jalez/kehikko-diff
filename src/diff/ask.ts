import { NOT_A_REPLY, ask, type AskFailure } from 'kehikot-module-protocol/client'

import { parseDiff, type FileDiff } from './parse.ts'

/**
 * Asking this app's own server for one patch.
 *
 * ## A relative path, and that is load-bearing
 *
 * `/api/diff` is fetched relative to whatever address this document was served
 * from. Inside a host's frame that is `http://127.0.0.1:7890`, and the request
 * is same-origin because this module declares storage and therefore keeps its
 * real origin. Written absolute it would work on this machine and nowhere else;
 * written against a second port it would be cross-origin and would need the
 * permissive CORS header that `manifest.ts` spends four paragraphs refusing.
 *
 * It goes through the protocol's `ask`, which never throws, asks with
 * `cache: 'no-store'` (the server's own cache is keyed on the head sha and is
 * the one that should be answering; an HTTP cache over it would be a third copy
 * keyed on a URL), and says which kind of failure a failure was: the door said
 * no (`refused` — including "not done, and why" at 200, which is how this door
 * hands on the CLI's own sentence), nothing answered (`down`), or this page is
 * older than its server (`stale`). The last two are drawn by the shared cover
 * in `app.tsx`, which is why `kind` rides along.
 *
 * ## The second cache, and why there are two
 *
 * The server holds patches keyed by ref and head sha; this holds PARSED ones,
 * keyed the same way. They are not redundant.
 *
 * The server's cache is what stops a subprocess running twice — the expensive,
 * rate-limited, credentialed thing. This one stops a round trip and, much more
 * to the point, stops re-parsing: a megabyte patch parsed on the main thread is
 * a visible stall, and a reader flicking between two selected changes to compare
 * them would pay it on every flick. Both are keyed by the head sha for the same
 * reason, spelled out at length in `patch/fetch.ts`: a change that gets a new
 * commit gets a new key, so there is no invalidation to get wrong.
 *
 * And the same caveat applies here, said again because this is the copy nearest
 * the screen: the sha comes from a host's reading, which is a snapshot from
 * whenever somebody last refreshed that epic. A change pushed to since then has
 * a head this app has never heard of, so both caches will confidently answer for
 * the OLD one. Nothing here can detect that. What the page does instead is print
 * the short sha, so a reader whose diff does not match what they just pushed has
 * the one fact that explains it.
 *
 * Bounded, and small: a reader moves between a handful of changes, and each
 * entry holds a whole parsed patch. Sixteen is comfortably more than anybody
 * switches between and far less than a page that quietly grows to hundreds of
 * megabytes over an afternoon.
 */
const KEEP = 16

export interface Patch {
  files: FileDiff[]
  /** The raw text, kept so "what did the tracker actually print" is answerable. */
  text: string
  /** Whether the server's byte cap cut it short. Always said on screen; never hidden. */
  truncated: boolean
  sha: string
  /** Where the server got it: a fresh run of the CLI, or its own cache. */
  from: 'cli' | 'cache'
}

export type Answer = { ok: true; patch: Patch } | { ok: false; error: string; kind: AskFailure }

const cache = new Map<string, Patch>()

/** Empty the parsed cache. For tests. */
export function forget(): void {
  cache.clear()
}

/**
 * The patch for one change, parsed.
 *
 * Every failure is an `{ ok: false, error }` with a sentence in it, and the
 * sentences are mostly the CLI's own — `gh` says "gh auth login" when a token
 * has expired, and that is worth a hundred times more to the person reading this
 * container than "the diff could not be fetched" would be. Nothing here throws, so no
 * caller has to remember to catch.
 */
export async function askDiff(url: string, sha: string): Promise<Answer> {
  const key = `${url}|${sha}`
  const had = cache.get(key)
  if (had) return { ok: true, patch: had }

  const asked = await ask<Record<string, unknown> | null>('api/diff', { query: { url, sha } })
  if (!asked.ok) {
    /* A refusal with no sentence of the door's own keeps this app's words rather than a status code. */
    const said = (asked.body as { error?: unknown } | null)?.error
    const silent = asked.kind === 'refused' && asked.status !== null && asked.status < 300 && asked.error !== NOT_A_REPLY && !(typeof said === 'string' && said)
    return { ok: false, error: silent ? 'The diff could not be read, and nothing said why.' : asked.error, kind: asked.kind }
  }
  const reply = asked.body
  if (typeof reply !== 'object' || reply === null) return { ok: false, error: NOT_A_REPLY, kind: 'refused' }

  const text = typeof reply.text === 'string' ? reply.text : ''
  const patch: Patch = {
    files: parseDiff(text),
    text,
    truncated: reply.truncated === true,
    sha: typeof reply.sha === 'string' ? reply.sha : sha,
    from: reply.from === 'cache' ? 'cache' : 'cli',
  }

  cache.set(key, patch)
  /* Oldest first. `Map` iterates in insertion order, so the first key is the
     first written and there is nothing to sort. */
  while (cache.size > KEEP) {
    const oldest = cache.keys().next()
    if (oldest.done) break
    cache.delete(oldest.value)
  }
  return { ok: true, patch }
}
