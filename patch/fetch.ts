import { spawn } from 'node:child_process'

import type { Target } from './locate.ts'

/**
 * Getting one patch, by running the CLI that already has the credentials.
 *
 * ## Why a subprocess and not an API call
 *
 * This app holds no token and must not. The person running it is already logged
 * in to `gh` and, where there is a GitLab, to `glab`; those two programs own the
 * credential, refresh it, and know about enterprise hosts, SSO and proxies. A
 * module that read a token out of a config file to make its own HTTPS call would
 * be a second, worse copy of authentication that breaks the first time somebody
 * uses a device flow. The roadmap this was extracted from shells out for exactly
 * this reason — see `src/trackers/exec.ts` there — and so does this.
 *
 * ## The argument list is an array, and there is no shell
 *
 * `spawn(cmd, [args], { shell: false })`. This matters more here than almost
 * anywhere else in the workspace, because two of the arguments come from data: a
 * repository path and a number, both read out of a URL that a tracker wrote into
 * a file that a host read and handed over. Every one of those hops is trusted
 * today and none of them is verified by this program.
 *
 * With `shell: true`, or with a command assembled into a string, `--repo` would
 * be a place to write shell: a repository named `a;curl evil` is a second
 * command, and the person who could name it that is anybody who can get a URL
 * into a reading. With an array and no shell there is no parser between here and
 * `execve`, so the worst a hostile repository name can do is make `gh` say it
 * cannot find that repository. `patch/locate.ts` whitelists the shape as well,
 * and that belt-and-braces is deliberate — the array is the defence, the
 * whitelist is what makes it hold if somebody later "simplifies" the array away.
 *
 * ## Bounded three ways
 *
 * Time, bytes, and the fact that only two commands can ever be run. A CLI
 * waiting on a network that is not there would otherwise hang a request until
 * the page's own timeout, and a diff of a vendored dependency tree is genuinely
 * tens of megabytes — read whole into memory, that is the module falling over on
 * a legitimate change rather than a hostile one. Past the cap the patch is
 * returned TRUNCATED and says so, because half a diff plus a sentence is more
 * use than an error, and because silence about it is the failure this whole
 * module is written against.
 */

/** How long either CLI gets before this gives up on it. */
const RUN_TIMEOUT_MS = 25_000

/**
 * How much of one patch is read into memory.
 *
 * Eight megabytes is far past any diff a person is going to read and far short
 * of what would trouble this process. What it stops is the pathological case: a
 * change that regenerates a lockfile, vendors a dependency, or commits a
 * binary the forge decides to render as text.
 */
const MAX_PATCH_BYTES = 8_000_000

export interface Patch {
  /** The unified diff, exactly as the CLI printed it. */
  text: string
  /** Whether `MAX_PATCH_BYTES` cut it short. The page says so; it never hides it. */
  truncated: boolean
  /** The head sha this was fetched for, carried back so the caller can key on it. */
  sha: string
  /** Where it came from this time: a fresh run, or the cache. Reported, not inferred. */
  from: 'cli' | 'cache'
}

export type Fetched = { ok: true; patch: Patch } | { ok: false; error: string }

/**
 * What was fetched, keyed by the reference AND the commit it was fetched at.
 *
 * ## The key is the whole design
 *
 * `gh#105@48d7202` and `gh#105@9ab13f4` are different documents that share a
 * name. Keying on the ref alone is the bug this workspace keeps rediscovering in
 * new places: something is cached under a name, the thing behind the name moves,
 * and the cache goes on answering confidently with the old bytes. Including the
 * head sha means a change that gets a new commit gets a new key, misses, and is
 * fetched again — no invalidation logic, no TTL, no staleness to reason about,
 * because the identity of the entry includes the identity of the content.
 *
 * ## When this cache is wrong, stated plainly
 *
 * It is wrong exactly when the sha it was given is wrong, and the sha comes from
 * a host's reading, which is a snapshot from whenever somebody last refreshed
 * that epic. So: a pull request that has been pushed to since the last refresh
 * has a NEW head, this app has never been told, and it will answer from the
 * entry filed under the OLD sha — a real patch, correctly fetched, for a commit
 * that is no longer at the head of that branch. Nothing here can detect that;
 * detecting it would mean asking the forge, which is the call the cache exists
 * to avoid.
 *
 * That is why the sha travels all the way to the screen instead of staying in
 * this file. The page prints the short sha beside the change and says the
 * reading it came from is a snapshot, so a reader looking at a diff that does
 * not match what they just pushed has the one fact that explains it. A cache
 * that could not be wrong would not need that line; this one can, so it does.
 *
 * Note also what is NOT in the key: `truncated` is a property of the fetch and
 * the cap is a constant, so a cached entry and a fresh one agree about it. If
 * the cap ever becomes configurable at runtime it belongs in the key.
 *
 * In memory, per process, bounded. It dies with the server, which is correct for
 * derived material: nothing is lost, and the alternative is a directory of
 * patches on somebody's disk that outlives its own truth.
 */
const cache = new Map<string, Patch>()

/**
 * How many patches are kept.
 *
 * A reader moves between a handful of changes; the protocol caps a selection at
 * 32 refs. Sixty-four is comfortably more than one person switching around, and
 * the eviction is oldest-first because the newest is the one still being looked
 * at. Not an LRU: the extra bookkeeping buys nothing at this size, and pretending
 * otherwise would be complexity nobody could measure.
 */
const KEEP = 64

const keyOf = (target: Target, sha: string) => `${target.forge}|${target.host ?? ''}|${target.repo}|${target.number}|${sha}`

/** Empty the cache. For tests, and for nothing else — there is no door onto this. */
export function forget(): void {
  cache.clear()
}

/** How many patches are held. Reported on `/healthz`, so "is it caching" is answerable. */
export function held(): number {
  return cache.size
}

/**
 * The command, built once so that the test can assert on it without running it.
 *
 * Exported for exactly that reason: what this array contains is the security
 * property of this file, and a property nobody can see is a property nobody can
 * check. `test/fetchdiff.test.ts` asserts that a repository full of shell
 * metacharacters arrives as one argument.
 */
export function command(target: Target): { cmd: string; args: string[]; env: Record<string, string> } {
  if (target.forge === 'github') {
    return { cmd: 'gh', args: ['pr', 'diff', String(target.number), '--repo', target.repo], env: {} }
  }
  /*
   * `--raw` is not optional. Without it `glab` prints a diff dressed for a
   * terminal — its own headers, its own spacing — and the parser downstream reads
   * unified diff and nothing else. `--color=never` is the same argument about
   * escape codes: `glab` decides on colour by whether it thinks it is on a tty,
   * and a pipe is usually enough to turn it off, but "usually" is how a page ends
   * up rendering `ESC[32m` as text in front of somebody.
   */
  return {
    cmd: 'glab',
    args: ['mr', 'diff', String(target.number), '--repo', target.repo, '--raw', '--color=never'],
    env: target.host ? { GITLAB_HOST: target.host } : {},
  }
}

/**
 * Run one CLI and hand back what it printed.
 *
 * Never throws. Every way this can fail — a missing binary, a login that has
 * expired, a repository that is not there, a timeout — comes back as
 * `{ ok: false, error }` with the CLI's own words in it where there are any.
 * That is deliberate: `gh` says "gh auth login" when the token has gone, and
 * that sentence is worth a hundred times more to the person reading this pane
 * than "the diff could not be fetched" would be. The roadmap's own tracker layer
 * makes the same choice for the same reason.
 *
 * Not retried, unlike the roadmap's `json()`. That function retries because a
 * dropped read there would quietly SHRINK what an epic tracks — a wrong answer
 * nobody sees. Here a failure is a sentence on screen next to a button that says
 * try again, so the person is the retry, and they get to see that it failed at
 * all rather than waiting three times as long for a silent recovery.
 */
function run(target: Target): Promise<{ ok: true; text: string; truncated: boolean } | { ok: false; error: string }> {
  const { cmd, args, env } = command(target)
  return new Promise((resolve) => {
    let child
    try {
      child = spawn(cmd, args, {
        /* Said out loud rather than left to the default, because it is the whole
           argument of this file and a default is not a statement. */
        shell: false,
        env: { ...process.env, ...env },
        stdio: ['ignore', 'pipe', 'pipe'],
      })
    } catch (e) {
      resolve({ ok: false, error: `${cmd} could not be started: ${e instanceof Error ? e.message : String(e)}` })
      return
    }

    const out: Buffer[] = []
    let size = 0
    let truncated = false
    let err = ''
    let done = false

    const finish = (result: { ok: true; text: string; truncated: boolean } | { ok: false; error: string }) => {
      if (done) return
      done = true
      clearTimeout(timer)
      resolve(result)
    }

    /* Killed rather than waited on. `spawn` does not throw on a missing binary —
       it hands back a child and fires `error` on a later tick — and it does not
       time out on its own either, so a CLI stuck on a network that is not there
       would hold this request until the page gave up on it, with no sentence
       saying why. */
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      finish({ ok: false, error: `${cmd} did not answer within ${Math.round(RUN_TIMEOUT_MS / 1000)} seconds.` })
    }, RUN_TIMEOUT_MS)

    child.stdout?.on('data', (chunk: Buffer) => {
      if (truncated) return
      size += chunk.length
      if (size > MAX_PATCH_BYTES) {
        /* Kept up to the cap rather than thrown away. A reader with the first
           eight megabytes and a sentence saying there is more has something; a
           reader with an error has nothing, and the change they are looking at
           is a legitimate one. */
        truncated = true
        out.push(chunk)
        child.kill('SIGKILL')
        return
      }
      out.push(chunk)
    })
    /* Bounded too, and much smaller: this is a sentence for a person, not a
       document. A CLI that printed a megabyte of warnings should not be able to
       put a megabyte on a pane. */
    child.stderr?.on('data', (chunk: Buffer) => {
      if (err.length < 4000) err += chunk.toString('utf8')
    })

    child.on('error', (e: Error) => {
      finish({
        ok: false,
        error:
          (e as NodeJS.ErrnoException).code === 'ENOENT'
            ? `\`${cmd}\` is not installed on this machine, or is not on this server's PATH. It is what holds the login, so nothing here can read a diff without it.`
            : `${cmd} could not be run: ${e.message}`,
      })
    })

    child.on('close', (code) => {
      const text = Buffer.concat(out).toString('utf8')
      /* A kill for truncation exits non-zero, and that is not a failure: we
         asked for it, and what came back before it is real. Checked before the
         exit code so the ordinary success path does not have to know about it. */
      if (truncated) {
        finish({ ok: true, text, truncated: true })
        return
      }
      if (code === 0) {
        finish({ ok: true, text, truncated: false })
        return
      }
      finish({ ok: false, error: err.trim().slice(0, 600) || `${cmd} exited ${code} without saying why.` })
    })
  })
}

/**
 * The patch for one change at one commit, from the cache if it is there.
 *
 * `sha` is required and is not defaulted. A caller with no sha has a reference
 * whose head this app has never been told, and the honest thing then is to say
 * so rather than to invent a key like `''` that every unrelated unshaed
 * reference would collide on — which is a cache that answers one change's diff
 * under another change's name, the single worst way this could go wrong.
 */
export async function patchFor(target: Target, sha: string): Promise<Fetched> {
  if (!sha) {
    return {
      ok: false,
      error:
        'The reading names no head commit for this change, so a diff fetched now could not be filed against anything. Refresh the epic and try again.',
    }
  }
  const key = keyOf(target, sha)
  const had = cache.get(key)
  if (had) return { ok: true, patch: { ...had, from: 'cache' } }

  const ran = await run(target)
  if (!ran.ok) return ran

  const patch: Patch = { text: ran.text, truncated: ran.truncated, sha, from: 'cli' }
  cache.set(key, patch)
  /* Oldest first. `Map` iterates in insertion order, so the first key is the
     first one written and there is nothing to sort. */
  while (cache.size > KEEP) {
    const oldest = cache.keys().next()
    if (oldest.done) break
    cache.delete(oldest.value)
  }
  return { ok: true, patch }
}
