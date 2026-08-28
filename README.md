# Diff

The diff of whichever change is selected on the canvas, file by file.

An app: its own page, its own port, its own cache. A roadmap may frame it, and
then it knows which change to look at.

```
./run.sh                 # or: PORT=7890 ./run.sh
bun run register         # tell a host on this machine where it answers
bun test && bun run typecheck
```

## What it is

One pane. Something else on the canvas — References, Journeys, anything — picks
a reference; this shows its patch. Per file, collapsible, added and removed
lines coloured and marked, line numbers in a gutter on both sides.

It holds no token. The patch is read by running `gh pr diff` or `glab mr diff`
on this machine, from this app's own server, because those two programs already
own the login and know about enterprise hosts, SSO and proxies. A module that
read a token out of a config file to make its own HTTPS call would be a second,
worse copy of authentication that breaks the first time somebody uses a device
flow.

## The problem it exists to solve, which is not "render a diff"

A selection carries **refs and nothing else**. `context.selection` is
`['gh#105']`, and the protocol is explicit about why: a host can vouch that
these are the refs somebody picked, and cannot vouch for what they ARE, because
whichever module set the selection was believed rather than checked.

`gh#105` is therefore unreadable on its own. GitHub numbers issues and pull
requests in one sequence and spells both `gh#`, so nothing about the string will
ever say which it is — and it does not say which repository it belongs to, or
which commit is at its head, either.

All three come out of one `live.get`:

| what | where it is read | why it cannot come from anywhere else |
| --- | --- | --- |
| issue or change | which **bag** the host filed it in — `issues`, `mrs`, `ghIssues`, `ghPrs` | the refresh knew, and filing is how it told us. Parsing the ref would be guessing at a fact we were handed |
| which repository | the `url` on the entry | a ref is not an address |
| which commit | the `sha` on the entry | it is the cache key, and it is the one honest caveat this pane has |

`src/live/lookup.ts` is that reading, and it is the same reading References and
Checklist do, in the same order, for the same reason.

**A selected reference that is an ISSUE has no diff.** That is an ordinary state
with its own sentence — "gh#131 is an issue rather than a change, so there is no
diff to show. Nothing went wrong: the roadmap filed it under issues, and an
issue has no commits of its own" — and never an error.

## Several references selected

Every one of them is drawn, in the order the host sent them, each as its own
section. **Exactly one is fetched**: the first that is a change with an address
and a head. The rest carry a control that says "Show the diff of gh#103".

The alternatives and why they lost:

- **Show only the first change and drop the rest.** Refused. A selected
  reference that produces nothing on screen is indistinguishable from a
  selection that never happened.
- **Fetch all of them.** Refused, and this is the one that would have felt
  generous. Every fetch is a subprocess against somebody's rate limit; the
  protocol caps a selection at 32 refs, so "all of them" has a worst case of 32
  concurrent `gh` invocations started by one click in another module. And at 220
  pixels a reader is looking at one diff.
- **Fetch none.** Refused. The overwhelming case is one change selected, and
  making somebody press a button to see the thing they just selected is a pane
  that does not do its job.

## The cache, and when it is wrong

Two caches, both keyed by **ref plus the head sha the reading gives**:

- the server holds the raw patch (`patch/fetch.ts`), which is what stops a
  subprocess running twice;
- the page holds the parsed one (`src/diff/ask.ts`), which stops a round trip
  and a megabyte re-parse when a reader flicks between two changes.

Keying on the sha means a change that gets a new commit gets a new key, misses,
and is fetched again — no invalidation, no TTL, no staleness to reason about,
because the identity of the entry includes the identity of the content.

**It is wrong exactly when the sha is wrong**, and the sha comes from a host's
reading, which is a snapshot from whenever somebody last refreshed that epic. A
pull request pushed to since then has a new head this app has never been told
about, and both caches will confidently answer for the old one. Nothing here can
detect that; detecting it would mean asking the forge, which is the call the
cache exists to avoid.

So the sha travels to the screen. Every rendered patch says "This is 48d720233,
the head the roadmap's last reading saw. A commit pushed since that reading
would not be in it." A cache that could not be wrong would not need that line.

## Big diffs

A change that regenerates a lockfile is forty thousand lines, and forty thousand
DOM nodes in a 300-pixel pane is a locked tab in the middle of somebody's
canvas. The fix must not become the worse failure, which is truncating silently:
a diff that quietly stopped at file eleven of thirty is worse than one that
locked the pane, because the reader believes it.

So **every file is always listed** — path, status, and the counts each way — and
only content is budgeted (`src/diff/budget.ts`):

- files open from the top until 1200 lines are spent; the rest are drawn closed
  and the pane says how many lines are behind them;
- one file renders 800 lines at a time, with an exact count and a control to
  draw the next 800 or all of them;
- and if the server's 8MB read cap cut the patch off mid-stream, the pane says
  so — that is the one case where "every file is listed" cannot be kept, and
  therefore the one that most needs saying out loud.

## Why this module declares `storage: true`

Because `/api/diff` spends this machine's credentials.

A host frames a module without `allow-same-origin` unless its manifest declares
storage. That costs nothing to a module that holds nothing — References and
Atlas are right to declare `false` — but an opaque page's fetches to its own
server are cross-origin, so the server would have to answer with a permissive
`Access-Control-Allow-Origin` or the page could not read its own `/api/diff`.

And with that header, any page in any tab could call it and read the answer:
every private repository this login can reach, exfiltrated through the person's
own browser with no prompt. Journeys had the same shape and it was demonstrated
rather than theorised, with a one-line `curl` carrying
`Origin: https://evil.example`.

Declaring storage closes it at the root. With a real origin the page's scripts
and its `/api/diff` calls are ordinary same-origin requests, no CORS is involved
at all, and `server.cors: false` in `vite.config.ts` says so explicitly — Vite's
default is not "off", it answers CORS for any loopback origin, which was
measured here.

The honest caveat: this shuts the browser's door and not the socket. Anything
already running as this user can `curl` the port, and no header stops that. What
CORS was protecting against is a stranger's page using this browser as a proxy,
and that is what is now shut.

## `prompt: false`

Declaring a prompt makes a host offer one, and offering one is a promise that
what somebody types will be used. What this pane shows is fully determined twice
over: WHICH diff comes from the selection, and WHAT it says comes from
`gh pr diff` byte for byte. There is no instruction a person could write that
would change a line of it. `manifest.ts` has the long version, and the condition
under which this becomes `true`.

## Running a command with data in it

The repository path and the number come from a URL, which came from a tracker,
which came from a refresh, which came from a host. Every hop is trusted today
and none is verified here.

- `patch/locate.ts` whitelists the shape: a path segment is letters, digits, dot,
  dash and underscore, never starting with a dash; a number is digits. Not a
  blacklist — a blacklist is a guess about the attacks somebody thought of.
- `patch/fetch.ts` builds an **array** and spawns with `shell: false`. There is
  no parser between it and `execve`, so a repository named `a;curl evil` is a
  repository `gh` cannot find rather than a second command.

The array is the defence; the whitelist is what makes it hold if somebody later
"simplifies" the array away. `test/command.test.ts` asserts the argument list
without running anything, because a security property nobody can see is a
property nobody can check.

## Layout

Panes here are 220 to 400 pixels wide on a monitor two thousand across, so every
responsive class is a **container query** and the only thing any of them measures
is the pane.

The page never scrolls sideways; the diff does. Other modules wrap their long
strings, because a wrapped ref is still a readable ref — a wrapped line of code
is not. So the code does not wrap and every file's body is its own
`overflow-x: auto` container, held there by `min-width: 0` on the flex children.
Measured at 220, 280, 320 and 400 pixels against a real 26-file patch:
`document.scrollWidth === window.innerWidth` at every one.

## The wire

`src/wire/` is the bridge and knows nothing about diffs.

- `mailbox.ts` records every message and replays the backlog to each subscriber.
  A host greets on the frame's `load` event, which is strictly before React's
  effects run; without this the greeting arrives at a page that is not listening
  yet and nothing ever retries.
- `use-roadmap.ts` stores the connection **before** acting on the greeting,
  because the mailbox replays synchronously inside `connect()` — in References
  that order left a page reading "Asking about…" for ever, with no question sent
  and no timeout.
- and it refetches on the epic CHANGING rather than on a context arriving. A
  context now carries the selection, so the host sends one after every selection
  change anywhere on the canvas; refetching on each would blank this pane
  precisely when it was being asked to say something.

## Files

```
manifest.ts          what this app says about itself, and why it declares what it does
doors.ts             /healthz and /api/diff, as functions; no socket
vite.config.ts       the page, the manifest, and server.cors: false
patch/locate.ts      a tracker URL -> a forge, a repository and a number. Pure.
patch/fetch.ts       the subprocess, the byte cap, and the sha-keyed cache
src/live/lookup.ts   one reading -> what each ref IS, where it lives, its head
src/diff/parse.ts    a unified diff -> files, hunks, numbered lines
src/diff/budget.ts   what is drawn before the reader has to ask for more
src/diff/ask.ts      the page's side of /api/diff, and the parsed cache
src/view/            one file, one patch, one selected reference
```
