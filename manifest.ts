import { MANIFEST_KIND, PROTOCOL, manifestSchema, type Manifest } from 'roadmap-module-protocol'

export const ID = 'roadmap.diff'
export const VERSION = '1.0.0'

/**
 * The port this app would rather have, said once and beside the name it goes
 * with.
 *
 * It used to be said twice — `--port "${PORT:-7890}"` on the last line of
 * `run.sh` and `Number(process.env.PORT ?? 7890)` in `register.ts` — with
 * nothing keeping the two in step, and a third copy of the number sitting in
 * `~/.roadmap/modules` from whenever somebody last ran the second. Moving this
 * app was two edits and a thing to remember.
 *
 * It is here rather than in `vite.config.ts` because `register.ts` needs it too,
 * and importing a Vite config to read one number would build the whole plugin
 * list on the way to finding out what to write down.
 *
 * It is a PREFERENCE and not a promise. 7820 through 7960 belong to the other
 * modules on this machine, and if something else holds 7890 when this starts
 * then `serves()` moves to the next free port and rewrites the registration to
 * match — see `roadmap-module-protocol/serve`. A host reads the registry, so the
 * registry is what has to be true; this number is only where to start looking.
 */
export const PREFERRED_PORT = 7890

/**
 * What this app says about itself when a host asks.
 *
 * The manifest is the smallest half of this program and the only half a host
 * ever reads before deciding whether to frame it. Read it as a description of
 * the ENRICHMENT rather than of the app: it says which tab to give the page and
 * which one question the app would like to ask if there is anybody there to ask.
 *
 * ## `live:read`, and nothing else
 *
 * One capability, and it is not the one a reader would guess. The obvious guess
 * is that a diff module needs to reach GitHub — it does, and there is no
 * capability for that and never will be: the tracker CLIs on this machine hold
 * the credentials, this app shells out to them from its own server, and a host
 * is not involved in that at all.
 *
 * What it needs a host for is smaller and completely load-bearing. A selection
 * carries refs and NOTHING else — `['gh#105']` — and the protocol's essay on
 * `selection` says exactly why: a host can vouch that these are the refs
 * somebody picked and cannot vouch for what they ARE, because whichever module
 * set the selection was believed rather than checked. So `gh#105` on its own
 * does not say whether it is an issue or a pull request, and GitHub numbers both
 * in one sequence, so nothing about the string will ever say. It also does not
 * say which repository it belongs to, or which commit is at its head.
 *
 * All three come out of one `live.get`. The bag a host's own refresh filed the
 * ref in is the only thing that says what it is; the `url` in that bag says
 * which repository; the `sha` says which commit the diff belongs to, which is
 * what this app's cache is keyed on. Without `live:read` this module has a list
 * of strings and no way to turn any of them into a command.
 *
 * Deliberately absent:
 *
 * - **`selection:set`.** This app REACTS to a selection and never makes one.
 *   Declaring it would be asking for permission to change what every other container
 *   on the canvas is looking at, from a module whose entire job is to answer a
 *   question about what is already picked.
 * - **`epics:read`.** References declares it so that a page with no epic can
 *   offer a picker. There is nothing for a picker to do here: even with an epic
 *   named, this page has nothing to draw until something is SELECTED, and no
 *   list of epics gets a reader closer to that. A capability asked for and never
 *   used is the fastest way to teach somebody to press yes without reading.
 * - **`steps:read`.** A step's prose is not a change and has no diff.
 * - **`stage:report`.** Saying where work stands belongs to whoever is doing it.
 *   A program that reads a patch has no standing to assert anything about it.
 * - **`state:keep`.** There is nothing worth remembering across a reload. What
 *   this page shows is decided entirely by the canvas's selection, which the
 *   host hands over in the greeting anyway; the only local state is which files
 *   a reader has collapsed, and restoring that against a diff that has since
 *   moved would be worse than starting open.
 * - **No `mcp`.** An agent that wants a diff already has `gh` and `glab`. A door
 *   here would be a second, slower, cache-shaped answer to a question the agent
 *   can ask directly, going stale on its own schedule.
 * - **No extensions.** Nothing here is worth emitting, and `consumes` is not
 *   implemented anywhere yet, so declaring it would be declaring an intention
 *   this app could not act on.
 *
 * And per the protocol's own README: a declaration is not a request and is not
 * answered. The host refuses whatever it likes at every call whatever is written
 * here, so the page is built to be refused — see the sightline in `app.tsx`.
 *
 * ## `prompt: false`, and the reasoning rather than the shrug
 *
 * The protocol offers a module a prompt: a paragraph a person writes on the
 * canvas, aimed at one container, delivered in every context. Declaring it makes a
 * host OFFER one, and offering one is a promise that what somebody types will be
 * used. So the question is not "could we find a use" but "is there work here
 * that has to be described before it can be done", and the answer is no.
 *
 * What this container shows is fully determined two ways over. WHICH diff comes from
 * the selection, which is a fact about the canvas and not a thing to be asked
 * for in prose. WHAT the diff says comes from `gh pr diff`, byte for byte —
 * this app renders a patch and does not summarise, judge, or choose what to
 * leave out, so there is no instruction a person could write that would change
 * a single line of it. A prompt here would be read and would change nothing on
 * screen, which is the specific dishonesty the field exists to avoid.
 *
 * The day this app grows something a person would sensibly write prose for —
 * "only the test files", "hide anything under vendor/" is the honest candidate,
 * and it is a filter rather than a prompt — this line becomes `true` and
 * `context.prompt` is read where that filtering is decided. Until then it stays
 * false and says why, because a capability declared "just in case" is
 * indistinguishable on screen from one that works.
 *
 * ## `storage: true`, which References would not need and this app does
 *
 * A host frames a module WITHOUT `allow-same-origin` unless its manifest
 * declares storage. That puts the page on an opaque origin, which costs it
 * nothing if it holds nothing — References and Atlas are right to declare
 * `false` — but it has one consequence that decides this manifest: an opaque
 * page's fetches to its OWN server are cross-origin, because its origin is
 * `null` and matches nothing. So the server would have to answer with a
 * permissive `Access-Control-Allow-Origin` or the page could not read its own
 * `/api/diff`.
 *
 * And `/api/diff` is not a static document. It is a door that spends this
 * machine's GitHub and GitLab credentials on request: hand it a repository and a
 * number and it runs `gh pr diff` under whoever is logged in, and hands back the
 * patch. With a permissive CORS header, any page in any tab in this browser can
 * call it and READ the answer — which means any website the person visits can
 * pull the source of every private repository their `gh` login can reach, off
 * loopback, with no prompt. Loopback is a fence around the machine and not
 * around the programs on it, and that is not a theoretical hole: Journeys had
 * the same shape and it was demonstrated with a one-line `curl` carrying
 * `Origin: https://evil.example`.
 *
 * Declaring storage closes it at the root rather than papering over it. With a
 * real origin this page's scripts and its `/api/diff` calls are ordinary
 * same-origin requests, no CORS header is sent at all, and a stranger's fetch
 * gets nothing back. The sandbox is weakened by exactly what that costs, which
 * is little: the origin this page regains is `127.0.0.1:7890` and the host is on
 * `127.0.0.1:4181`. Different ports are different origins, so the page still
 * cannot reach into the host — it can only reach itself, which is all it asked
 * for.
 *
 * The honest caveat, said here rather than left to be discovered: this closes
 * the BROWSER's door and not the socket. Anything already running as this user
 * can `curl` the port, and no header stops that. What CORS was ever protecting
 * against is a stranger's page using this browser as a proxy, and that is the
 * door that is now shut.
 *
 * There is also a cache behind that door, and it is worth being clear that it is
 * not the reason for this decision. The cache holds diffs this app fetched
 * itself, keyed by ref and head sha; it is derived material, it is in memory,
 * and it dies with the process. Nobody wrote it and nothing is lost if it goes.
 * A module that held only that would be free to declare `storage: false` and
 * take the opaque origin. It is the credentialed door beside it that is not.
 */
export const MANIFEST: Manifest = manifestSchema.parse({
  kind: MANIFEST_KIND,
  /**
   * Parsed here, at module load, rather than shipped as a bare object.
   *
   * The protocol package is explicit that its schemas are a convenience and
   * never the host's check — the host runs its own copy over what arrives on the
   * wire. That cuts both ways: running it HERE is the cheapest way for this app
   * to learn it has written a manifest no host will accept, and to learn it when
   * this file is imported rather than from a host's refusal in somebody else's
   * log. A summary one character over `LIMITS.SUMMARY` should stop this process,
   * not that one.
   */
  protocol: PROTOCOL,
  id: ID,
  name: 'Diff',
  version: VERSION,
  summary: 'The diff of whichever change is selected on the canvas, file by file.',
  /**
   * What an agent should do about this module being here.
   *
   * Not what it shows — the summary says that. This says what its PRESENCE
   * OBLIGES, and a host composes it into the prompt every agent on the canvas
   * is handed, attributed to this module.
   */
  guidance:
    'The actual diff of the selected change is on this kehikko, so read it before saying anything ' +
    'about that change. A title, a description and a commit message are all claims about a diff; ' +
    'this is the diff. If they disagree, the diff is what happened and the disagreement is itself ' +
    'worth reporting. The selection is the scope: review what is selected rather than the whole ' +
    'branch, and if a file in it looks wrong for reasons outside the selection, write that down ' +
    'instead of widening what you touch.',
  entry: '/',
  modes: [{ id: 'diff', label: 'Diff', scope: 'epic' }],
  extensions: { emits: [], consumes: [] },
  declares: {
    protocol: `>=${PROTOCOL} <${PROTOCOL + 1}`,
    uses: ['live:read'],
    storage: true,
    prompt: false,
  },
  health: '/healthz',
})
