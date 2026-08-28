import { ID, MANIFEST, VERSION } from './manifest.ts'
import { locate } from './patch/locate.ts'
import { held, patchFor } from './patch/fetch.ts'

/**
 * Every door this app answers on that is not the page itself.
 *
 * ## Why this is a file of functions rather than a server
 *
 * A module is ONE ORIGIN or it is nothing. The protocol refuses a manifest whose
 * `entry` points anywhere but the origin that served the manifest, and it is
 * right to — a program that could name somebody else's page would be a program
 * that could have the host frame somebody else. The page is Vite's, because a
 * `dist/` served off disk has cost this codebase whole afternoons of a stale
 * page answering 200 with every symptom of a working app and none of the
 * changes. So the manifest, the health check and this app's one credentialed
 * door have to be Vite's too: middleware in front of the same server, not a
 * second process on a second port however much tidier that would look.
 *
 * It reaches further here than it does for a module that only publishes a
 * manifest. The page fetches `/api/diff` as a RELATIVE path, which is what makes
 * it work inside a frame at whatever address the host wrote down; a store on
 * another port would make every one of those fetches cross-origin, which is to
 * say not at all.
 *
 * Hence: no listener here. `answer()` takes a method, a path and a query and
 * returns a status and a document, and `vite.config.ts` adapts a node request to
 * it in a dozen lines. Which also means the whole of what this app will say can
 * be tested by calling a function — see `test/doors.test.ts`.
 *
 * ## The one door that spends a credential
 *
 * `/api/diff` runs `gh` or `glab` as whoever started this server. That is the
 * reason this module declares `storage: true` and sets no CORS header — the long
 * version is in `manifest.ts`. The short version: with a permissive header, any
 * page in any tab could call this and read the source of every private
 * repository this machine's login can reach.
 *
 * What is left after that is the socket itself, and nothing here pretends
 * otherwise: anything already running as this user can call this port. So the
 * door is still written as if its caller were a stranger. Nothing is trusted,
 * every string is bounded before it is looked at, the URL is parsed by a
 * whitelist, and the subprocess is spawned from an array with no shell.
 */

/**
 * How long a URL may be before this stops reading it.
 *
 * A tracker's own URL is well under a hundred characters. This is a bound rather
 * than a budget: what it stops is a caller handing over a megabyte for `new URL`
 * to parse, which is work done on somebody else's say-so.
 */
const MAX_URL = 500

/**
 * And a sha.
 *
 * Not validated as hex, deliberately. It is never put on a command line — it is
 * a cache key and a piece of text on screen — and a tracker that starts writing
 * something other than a hex sha there should show up on the page as an odd
 * label rather than as a reference this app refuses to fetch. Length is the only
 * thing that has to be bounded, because the key is held in memory.
 */
const MAX_SHA = 80

export interface Reply {
  status: number
  body: unknown
}

const str = (value: string | null, max: number): string => (value ?? '').trim().slice(0, max)

/**
 * What this app answers, for one request.
 *
 * `null` means "not one of ours", and the caller passes the request on to Vite —
 * which is how the page, its modules and the hot-reload socket all keep working
 * through the same middleware stack.
 */
export async function answer(method: string, path: string, query: URLSearchParams): Promise<Reply | null> {
  if (path === '/healthz') {
    if (method !== 'GET') return { status: 405, body: { ok: false, error: 'this door only answers GET' } }
    /* `cached` is here because "is the cache doing anything" should be
       answerable without instrumenting the page. It is a count and not a
       listing: what is in it is somebody's source code, and a health check is
       the last place that should be readable. */
    return { status: 200, body: { ok: true, id: ID, version: VERSION, cached: held() } }
  }

  if (path === '/api/diff') {
    if (method !== 'GET') return { status: 405, body: { ok: false, error: 'this door only answers GET' } }

    const url = str(query.get('url'), MAX_URL)
    const sha = str(query.get('sha'), MAX_SHA)
    if (!url) return { status: 400, body: { ok: false, error: 'ask for a diff by the url the tracker wrote for it.' } }

    /*
     * The URL is turned into a target HERE rather than the caller sending a repo
     * and a number. That is not politeness about the interface: it means there is
     * exactly one place in this program where a string becomes a command line,
     * and it is a pure function with its own tests. A door that took `repo` and
     * `number` directly would be a door where the whitelist could be bypassed by
     * calling it, and the page would have a second copy of the parsing that could
     * drift from this one.
     */
    const target = locate(url)
    if (!target) {
      return {
        status: 200,
        body: {
          ok: false,
          error:
            'That address is not one this app knows how to read a diff from. It reads GitHub pull requests and GitLab merge requests, and nothing else.',
        },
      }
    }

    const got = await patchFor(target, sha)
    if (!got.ok) return { status: 200, body: { ok: false, error: got.error, target } }
    return { status: 200, body: { ok: true, target, ...got.patch } }
  }

  return null
}

/** Re-exported so `vite.config.ts` imports its two doors from one place. */
export { MANIFEST }
