#!/usr/bin/env bash
#
# The one name every module ships this under, so a host that offers to start one
# has a script to run rather than a command line to build.
#
#   - No arguments. A registration names a directory and one script inside it,
#     never a command line: a string a host handed to a shell would make a
#     registration file a place to write shell. That argument is made at length
#     in `patch/fetch.ts` about a subprocess, and it is the same argument here.
#   - $PORT from the environment. Whoever starts this chose the port; a script
#     that picked its own would answer somewhere nobody is looking. 7890 is the
#     default and it is the number in the registration too — 7820, 7830, 7840,
#     7850 and 7860 belong to References, Atlas, Journeys, the orchestrator and
#     Checklist on this machine.
#   - `exec`, and the foreground. A script that forks and returns leaves whoever
#     started it holding a pid that stops nothing, and Stop is only ever offered
#     for what a host started.
#   - `cd` to this script's own directory, so `index.html` and the manifest are
#     found however the script was invoked.
#
# It does NOT register. Registration is a deliberate act by a person — see
# `register.ts` — and a start script that quietly wrote into somebody's home
# directory would be doing it on their behalf.
#
# ## What this process needs that other modules do not
#
# `gh`, and `glab` if there is a GitLab. This app holds no token: the login lives
# in those two programs and this shells out to them. A server started somewhere
# they are not on the PATH comes up perfectly and then says, on the first diff,
# that the binary is not there — which is the honest failure and is still worth
# knowing about before you go looking for a bug in the page.
#
# ## There is no build here, and no `dist`
#
# Vite serves the page. The argument for building and serving off disk is that
# starting should be starting — a start that shells out to a build is a start
# that fails when the network is down. The argument is fine and the shape is
# still wrong, because this program is not deployed: it runs on the machine of
# the person editing it. What `dist` actually buys is a STALE page served with a
# 200, every symptom of a working app and none of the changes, and that failure
# has cost this codebase whole afternoons three separate times in three different
# programs. A missing build announces itself. A stale one does not.
set -euo pipefail
cd "$(dirname "$0")"

if [ ! -d node_modules ]; then
  echo "installing…" >&2
  bun install >&2
fi

exec bunx vite --host 127.0.0.1 --port "${PORT:-7890}" --strictPort
