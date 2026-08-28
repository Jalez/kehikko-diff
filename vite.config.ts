import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { WELL_KNOWN } from 'roadmap-module-protocol'
import { defineConfig, type Plugin } from 'vite'

import { MANIFEST, answer } from './doors.ts'

/**
 * Every door this app answers on, served by the one process that serves the
 * page.
 *
 * A module is ONE ORIGIN or it is nothing: the protocol refuses a manifest whose
 * `entry` points anywhere but the origin that served the manifest. So the
 * manifest, the health check, this app's `/api/diff` and the page itself cannot
 * be split across two processes on two ports, however tidy that would be — they
 * are middleware in front of the same server that serves the page. The deciding
 * lives in `doors.ts`, which holds no socket; this adapts a node request to it.
 */
function doors(): Plugin {
  return {
    name: 'diff-doors',
    configureServer(server) {
      const index = resolve(import.meta.dirname, 'index.html')

      server.middlewares.use((request, response, next) => {
        const url = new URL(request.url ?? '/', 'http://127.0.0.1')
        const path = url.pathname
        const method = (request.method ?? 'GET').toUpperCase()

        const send = (status: number, body: unknown) => {
          response.statusCode = status
          response.setHeader('content-type', 'application/json; charset=utf-8')
          response.end(JSON.stringify(body, null, 2))
        }

        /* Spelled by the protocol package so that this app and every host cannot
           disagree about it by a character. */
        if (path === WELL_KNOWN) return send(200, MANIFEST)

        /*
         * The page, served here rather than left to Vite's own index handling,
         * for one header.
         *
         * This module declares storage, so a host frames it WITH
         * `allow-same-origin` and it keeps its real origin. Having an origin is
         * what makes `frame-ancestors` mean something: without this line any
         * page anywhere could frame this one, and while there is nothing here to
         * click that would hurt anybody, an origin that answers a credentialed
         * door should not also be silently embeddable. It is deliberately not a
         * list of one — whoever runs this decides, through `ROADMAP_ORIGIN`, and
         * the default is the address the host in this workspace actually serves
         * on. `'self'` is in it so that opening this page directly still works.
         *
         * The document still goes through `transformIndexHtml`, so Vite's client
         * and the module graph are injected exactly as they would be for an
         * ordinary index — this claims the response, not the build.
         */
        if (path === '/') {
          void server
            .transformIndexHtml(request.url ?? '/', readFileSync(index, 'utf8'), request.originalUrl)
            .then((html) => {
              response.statusCode = 200
              response.setHeader('content-type', 'text/html; charset=utf-8')
              response.setHeader(
                'content-security-policy',
                `frame-ancestors 'self' ${process.env.ROADMAP_ORIGIN ?? 'http://127.0.0.1:4181 http://localhost:4181'}`,
              )
              response.end(html)
            })
            .catch(next)
          return
        }

        if (path !== '/healthz' && !path.startsWith('/api/')) return next()

        void answer(method, path, url.searchParams)
          .then((reply) => {
            if (!reply) return next()
            send(reply.status, reply.body)
          })
          .catch(next)
      })
    },
  }
}

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
 * ## No alias for `roadmap-module-protocol`
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
 * `grep -c selection node_modules/.vite/deps/roadmap-module-protocol.js` says
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
 */
export default defineConfig({
  base: './',
  plugins: [doors(), react(), tailwindcss()],
  resolve: { alias: { '@': resolve(import.meta.dirname, 'src') } },
  server: { cors: false },
  build: { outDir: 'dist', emptyOutDir: true },
})
