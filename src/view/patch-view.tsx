import { useMemo, useState } from 'react'

import { Badge } from '@/components/ui/badge.tsx'
import type { Patch } from '@/diff/ask.ts'
import { plan } from '@/diff/budget.ts'
import { totals } from '@/diff/parse.ts'

import { FileSection } from './file-diff.tsx'

/**
 * One whole patch: what it touched, then every file it touched.
 *
 * ## The summary line is the thing a narrow container is actually for
 *
 * At 220 pixels nobody reads a diff line by line — they find out what moved and
 * then open the one file they care about. So the counts come first and the file
 * headers are all immediately present, and the content is what waits. That is
 * also why the budget in `budget.ts` closes FILES rather than trimming the list:
 * the list is the answer to the question most readers are asking.
 *
 * ## Two sentences that are never suppressed
 *
 * `truncated` means the server's byte cap cut the patch off mid-stream, so there
 * are files this page has never seen and cannot list. That is the one case where
 * the "every file is drawn" promise cannot be kept, and it is therefore the one
 * case that most needs saying out loud — a reader who is not told will read a
 * complete-looking list of eleven files and conclude the twelfth was untouched.
 *
 * `heldBack` is the ordinary, benign version: every file is listed, some are
 * closed, and the number of lines behind them is stated so nobody has to guess
 * whether closed means small.
 */
export function PatchView({ patch }: { patch: Patch }) {
  const sum = useMemo(() => totals(patch.files), [patch.files])
  const opening = useMemo(() => plan(patch.files), [patch.files])

  /**
   * Which files the reader has opened or closed since, over the top of the plan.
   *
   * Keyed by index, as the plan is, and for the reason given there: a malformed
   * patch can name the same path twice, and two `<details>` sharing a key would
   * open and close together.
   */
  const [moved, setMoved] = useState<Record<number, boolean>>({})

  if (!patch.files.length) {
    return (
      <p className="text-[0.7rem] leading-4 text-muted-foreground">
        {patch.text.trim()
          ? 'The tracker answered, and what it printed is not a unified diff this app can read. Nothing has been hidden — there was nothing here shaped like a patch.'
          : 'The tracker answered with an empty diff. That is what a change with no commits against its base looks like, and it is not an error.'}
      </p>
    )
  }

  return (
    <div className="flex min-w-0 flex-col gap-1">
      {/* The whole-patch totals in the same two badges the file headers use, so
          the arithmetic reads as the same claim at both scales. `flex-wrap`
          rather than `whitespace-nowrap`: at 220 pixels the sentence after them
          is long and has to be allowed to fall to its own line. */}
      <p className="flex flex-wrap items-center gap-1 text-[0.7rem] leading-4 text-muted-foreground">
        <span>
          {sum.files} {sum.files === 1 ? 'file' : 'files'}
        </span>
        <Badge variant="add">+{sum.added}</Badge>
        <Badge variant="del">−{sum.removed}</Badge>
        {opening.closed ? (
          <span className="min-w-0">
            {`${opening.closed} ${opening.closed === 1 ? 'file is' : 'files are'} closed to start with, holding ${opening.heldBack} lines. Open any of them below; nothing is missing from this list.`}
          </span>
        ) : null}
      </p>

      {patch.truncated ? (
        <p className="rounded-md border border-del-mark bg-del px-2 py-1 text-[0.7rem] leading-4">
          This patch was longer than this app will read into memory and was cut off part-way. Every file below is real, and
          there may be files after them that never arrived. Read it with <code>gh pr diff</code> or on the tracker itself
          if the end of it matters.
        </p>
      ) : null}

      {patch.files.map((file, at) => (
        <FileSection
          key={at}
          file={file}
          open={moved[at] ?? opening.open.has(at)}
          onToggle={() => setMoved((was) => ({ ...was, [at]: !(was[at] ?? opening.open.has(at)) }))}
        />
      ))}
    </div>
  )
}
