#!/usr/bin/env bun
import { mkdirSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

import { ID } from './manifest.ts'

/**
 * Tell a host on this machine where this app answers.
 *
 *   bun run register            # or: PORT=7890 bun run register
 *
 * A separate program from `run.sh` on purpose. Registration writes into
 * somebody's home directory and says "frame this", which is a decision a person
 * makes once; a start script that did it quietly would be making that decision
 * on their behalf every time they pressed start.
 *
 * ## The filename is the module id
 *
 * Not a field inside the file — the NAME. A host sweeps the directory and takes
 * the id from the filename, so `roadmap.diff.json` is what makes this
 * `roadmap.diff`. Two files naming the same port under different names are two
 * modules as far as a host is concerned.
 *
 * ## `dir` as well as `url`
 *
 * The directory is what lets a host OFFER to start this — it is where `run.sh`
 * is. A registration with only a url is a module a host can frame when somebody
 * else has already started it, which is a worse experience for no gain, so both
 * are written.
 *
 * ## Where a host looks
 *
 * This line must say exactly what a host's own registry sweep says, and it is
 * copied rather than imported because this directory is meant to stand alone.
 * Writing to the wrong directory is the worst failure a module can have: the
 * host finds nothing, and finds it silently.
 */
const registryDir = process.env.ROADMAP_MODULES_DIR ?? join(homedir(), '.roadmap', 'modules')

const port = Number(process.env.PORT ?? 7890)
const origin = `http://127.0.0.1:${port}`

mkdirSync(registryDir, { recursive: true })
const file = join(registryDir, `${ID}.json`)
writeFileSync(file, `${JSON.stringify({ url: origin, dir: import.meta.dirname }, null, 2)}\n`)
console.log(`registered: ${file} -> ${origin}`)
console.log('Start the app with ./run.sh, then reload the host; it sweeps the directory on every read.')
