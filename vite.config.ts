import { resolve } from 'node:path'

import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { doors, serves } from 'kehikot-module-protocol/serve'
import { defineConfig } from 'vite'

import { BUILD, MANIFEST, answer } from './doors.ts'
import { ID, PREFERRED_PORT } from './manifest.ts'

/**
 * Every door this app answers on is the protocol's `doors()`, served by the one process that
 * serves the page: the manifest at both well-known paths, the page, `/healthz` and this app's
 * `/api/diff` through `answer` in `doors.ts`. See the protocol's docs/module-plumbing.md.
 *
 * A module is ONE ORIGIN or it is nothing: the protocol refuses a manifest whose `entry` points
 * anywhere but the origin that served the manifest, so none of these can be a second process on a
 * second port, however tidy that would be.
 *
 * ## The page is generated, and carries no ticket
 *
 * There was an `index.html` here; the document is `pageDocument` now, with no `ticket` in it,
 * because this app takes no writes — its one door of its own is a GET. What the generated page
 * adds is the build printed into it and the theme decided before the first paint. It is served at
 * `/`, which is this module's `entry`, and at `/app`.
 *
 * `doors()` also sends `frame-ancestors`. This module declares storage, so a host frames it WITH
 * `allow-same-origin` and it keeps its real origin, which is what makes that header mean
 * something: an origin that answers a credentialed door should not also be silently embeddable.
 * Whoever runs this decides who may frame it, through `KEHIKOT_ORIGINS`.
 */

/**
 * The build, and the one line in it that decides who may read this port.
 *
 * ## `server.cors: false`, and this module is the reason the rule has an exception
 *
 * References and Atlas set `cors: true` and have to. A host frames a module
 * WITHOUT `allow-same-origin` unless its manifest declares storage, which puts
 * the page on an opaque origin — and `<script type="module">` is ALWAYS fetched
 * in CORS mode, so with no permissive header not one script in the page runs.
 * The document loads, `load` fires, the host greets it, and nothing answers.
 * `curl` cannot see it, being unsubject to CORS; only the browser console can.
 * That has cost this codebase days, so the absence of the line here needs
 * saying rather than leaving to be discovered.
 *
 * This module goes the other way because of what is behind `/api/diff`: a door
 * that runs `gh pr diff` under this machine's login. A permissive
 * `Access-Control-Allow-Origin` would let any page in any tab call it and read
 * the answer — every private repository that login can reach, exfiltrated
 * through the person's own browser with no prompt. So the manifest declares
 * `storage: true`, this page keeps a real origin, its scripts and its fetches
 * are ordinary same-origin requests, no CORS is involved at all, and a
 * stranger's fetch gets nothing back. The full argument is in `manifest.ts`.
 *
 * `false` rather than simply omitted, and that word was earned by measurement.
 * Vite's default is not "off": it answers CORS for any loopback origin, which
 * was verified here — the host's own page at `127.0.0.1:4181` read `/healthz`
 * off this port cross-origin with a plain `fetch`, while the same request
 * carrying `Origin: https://evil.example` came back with no
 * `Access-Control-Allow-Origin` at all. So the remote-website hole was already
 * shut by Vite and the local one was not, and a door that runs `gh` under
 * somebody's login should not be readable by every other dev server they happen
 * to be running. Turning it off costs this page nothing, because everything it
 * fetches is its own origin.
 *
 * ## No alias for `kehikot-module-protocol`
 *
 * There is none, and there must not be. The package's `exports` are correct,
 * reaching past them is what made a whole class of bug possible, and a module
 * that resolved its contract differently from the host it talks to would be a
 * module testing something nobody ships. There is no tsconfig path for it
 * either, for the same reason.
 *
 * A note for whoever debugs this next, because it cost a day: Vite pre-bundles
 * that package into `node_modules/.vite/deps/`, the pre-bundle survives
 * reinstalls, and a stale one silently STRIPS schema fields it has never heard
 * of. The symptom is a host message that visibly carries `selection` and a page
 * that sees it missing, with nothing anywhere erroring.
 * `grep -c selection node_modules/.vite/deps/kehikot-module-protocol.js` says
 * whether the copy in play knows the field; `touch vite.config.ts` makes Vite
 * re-optimise.
 *
 * ## `base: './'`
 *
 * This page is served at `/` here and framed by a host at whatever address that
 * host wrote down — behind a proxy, on another port, under a path nobody here
 * chose. Absolute asset paths are correct in the first case and a guess in the
 * second; relative ones are a fact in both, because the browser resolves them
 * against the document it just fetched.
 *
 * ## `server` says `cors: false` and deliberately says no port
 *
 * 7890 used to be written on the `bunx vite` line in `run.sh` and again in
 * `register.ts`, and true in neither the moment something else held the port:
 * `--strictPort` meant this app printed `Error: Port 7890 is already in use` and
 * exited 1, so a program with no interest in diffs could stop the diffs from
 * opening. It is `PREFERRED_PORT` in `manifest.ts` now, said once beside the id
 * and read from there by this file and `register.ts` both.
 *
 * `serves()` is FIRST in the plugin list because it has to claim a port before
 * anything else in this config asks for one, and it sets `strictPort: false`
 * itself so Vite's own fallback is a second net rather than the absence of one.
 * A free 7890 is taken in silence; this module already answering there ends the
 * start cleanly rather than making a second copy; anything else is a loud move
 * to the next free port with the registration rewritten to the port the server
 * ACTUALLY bound, read off `httpServer.address()` after `listening` rather than
 * off what was asked for.
 */
export default defineConfig({
  base: './',
  plugins: [
    serves({ id: ID, prefer: PREFERRED_PORT }),
    doors({ manifest: MANIFEST, answer, build: BUILD, page: { title: 'Diff' } }),
    react(),
    tailwindcss(),
  ],
  resolve: { alias: { '@': resolve(import.meta.dirname, 'src') } },
  server: { cors: false },
})
