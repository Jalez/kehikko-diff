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

export type Answer = { ok: true; patch: Patch } | { ok: false; error: string }

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

  let response: Response
  try {
    response = await fetch(`api/diff?url=${encodeURIComponent(url)}&sha=${encodeURIComponent(sha)}`, {
      /* Never cached by the browser. The server's own cache is keyed on the head
         sha and is the one that should be answering; an HTTP cache layered over
         it would be a third copy keyed on a URL, going stale on rules nobody
         here chose. */
      cache: 'no-store',
    })
  } catch {
    /* A fetch to this page's own origin failing means the server that served this
       page is not answering — it was stopped, or it crashed. Naming that is more
       use than "network error", because the remedy is different: nothing about
       GitHub is involved. */
    return { ok: false, error: 'This app’s own server did not answer. It may have been stopped since this page loaded.' }
  }

  let body: unknown
  try {
    body = await response.json()
  } catch {
    return { ok: false, error: `This app’s own server answered ${response.status} with something that is not JSON.` }
  }

  if (typeof body !== 'object' || body === null) {
    return { ok: false, error: 'This app’s own server answered with something that is not a reply.' }
  }
  const reply = body as Record<string, unknown>
  if (reply.ok !== true) {
    return {
      ok: false,
      error: typeof reply.error === 'string' && reply.error ? reply.error : 'The diff could not be read, and nothing said why.',
    }
  }

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
