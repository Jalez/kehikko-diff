/**
 * Finding one reference inside a host's reading of an epic.
 *
 * ## The question this file exists to answer
 *
 * A selection carries refs and nothing else. `context.selection` is
 * `['gh#131', 'gh#105']` and the protocol is explicit about why it is only that:
 * the host can vouch that these are the refs somebody picked, and cannot vouch
 * for what they ARE, because whichever module set the selection was believed
 * rather than checked. So the kind does not travel, deliberately.
 *
 * The kind matters more here than in almost any other module, because it decides
 * whether there is anything to show at all. An issue has no diff — not an empty
 * one, none — and a program that ran `gh pr diff` against an issue number would
 * get a refusal out of GitHub and would then have to decide whether that
 * refusal meant "not a pull request" or "not logged in" or "no such repository".
 * That is guessing at a fact this app was already handed.
 *
 * GitHub numbers issues and pull requests in ONE sequence and spells both
 * `gh#`, so `gh#105` is unreadable on its own and always will be. The way out is
 * the one the protocol points at: ask the host for the epic's reading and read
 * the kind where References reads it — out of the BAG the refresh filed it in. A
 * refresh knew, and filing is how it told us.
 *
 * ## Three things come out of the bag, not one
 *
 * - **The kind**, from which bag it is in, as above.
 * - **The `url`**, which is the only place the repository is written down. A ref
 *   is `gh#105`; `https://github.com/jaakkorajalasol/roadmap/pull/105` is what
 *   can become a command line. `patch/locate.ts` does that reading.
 * - **The `sha`**, the head commit the tracker saw. It is what this app's cache
 *   is keyed on, and it is why switching between two selected changes does not
 *   shell out again. It is also the one honest caveat this page has: the reading
 *   is a snapshot, so a change pushed to since the last refresh has a head this
 *   app has never been told about. The sha goes all the way to the screen for
 *   that reason.
 *
 * ## Every bag, and the spellings are not ours to tidy
 *
 * GitLab's two bags are keyed by the bare number and GitHub's two by the ref as
 * written, which is how a host files them. The spellings are rebuilt here to
 * match how people say them out loud, and the asymmetry is not ours and is not
 * tidied — tidying it would mean this app and the host disagree about what a key
 * is, and the symptom would be a selected reference this page could not find and
 * drew as unknown for ever.
 *
 * ## A ref that is not in the reading is an ordinary state
 *
 * Not an error, and not a blank. Somebody may have picked a reference from a
 * container showing another epic, or one no refresh has ever read. It comes back
 * absent, the page says exactly that in its own sentence, and the reference is
 * still drawn. The one thing that must never happen is a selected ref silently
 * not appearing: a missing row looks exactly like a row that was never meant to
 * be there.
 *
 * ## Enumerated, never looked up
 *
 * `bag[ref]` with a `ref` that arrived from the wire answers with something
 * inherited when the string is `constructor`, and this page would then try to
 * read a URL off `Function.prototype`. `Object.entries` returns own enumerable
 * properties and nothing from a prototype. The protocol package's essay on
 * `MODULE_ID` is about exactly this hazard one door over. The code LOOKS like
 * the hazardous shape and is not, which is why it is worth a paragraph.
 */

/** Whether a reference is a change against the work, or the work itself. */
export type Kind = 'change' | 'work'

export type Origin = 'github' | 'gitlab'

export interface Found {
  ref: string
  kind: Kind
  origin: Origin
  /** The tracker's own address for it, or '' when the reading did not say. */
  url: string
  /** The head commit as the reading saw it, or '' — never guessed at. */
  sha: string
  title: string
  /** `opened`, `closed`, `merged`, or '' when the reading did not say. */
  state: string
  /** True when the bag held something that was not an object: the reading was damaged, not absent. */
  unreadable: boolean
}

/** The four bags, and which one a thing is in is the only thing that says what it is. */
const BAGS = [
  { bag: 'issues', kind: 'work', origin: 'gitlab', spell: (k: string) => `#${k}` },
  { bag: 'mrs', kind: 'change', origin: 'gitlab', spell: (k: string) => `!${k}` },
  { bag: 'ghIssues', kind: 'work', origin: 'github', spell: (k: string) => k },
  { bag: 'ghPrs', kind: 'change', origin: 'github', spell: (k: string) => k },
] as const satisfies readonly { bag: string; kind: Kind; origin: Origin; spell: (k: string) => string }[]

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

/** A string field, or ''. Never `String(v)`, which turns `null` into the word "null" on screen. */
const str = (v: unknown): string => (typeof v === 'string' ? v : '')

/**
 * Every reference in one reading, by the spelling people write.
 *
 * A key whose value is not an object still becomes an entry, with its kind and
 * nothing else. The reading was damaged, not absent — and knowing that `gh#105`
 * is a pull request is worth having even when nothing else about it could be
 * read. It is the difference between "this is a change and its address could not
 * be read" and a shrug.
 */
export function index(live: unknown): Map<string, Found> {
  const out = new Map<string, Found>()
  if (!isObject(live)) return out
  for (const { bag, kind, origin, spell } of BAGS) {
    const held = live[bag]
    if (!isObject(held)) continue
    for (const [key, raw] of Object.entries(held)) {
      const o = isObject(raw) ? raw : {}
      out.set(spell(key), {
        ref: spell(key),
        kind,
        origin,
        url: str(o.url),
        sha: str(o.sha),
        title: str(o.title),
        state: str(o.state),
        unreadable: !isObject(raw),
      })
    }
  }
  return out
}

/** When the reading was taken, as the host wrote it, or null if it did not say. */
export function generatedAt(live: unknown): string | null {
  if (!isObject(live)) return null
  const at = str(live.generated)
  return at || null
}
