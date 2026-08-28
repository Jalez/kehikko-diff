import { useState, type CSSProperties } from 'react'

import { FILE_LINES } from '@/diff/budget.ts'
import type { DiffLine, FileDiff } from '@/diff/parse.ts'

/**
 * One file of a patch: a header that is always drawn, and a body that may not
 * be.
 *
 * ## The header is never conditional
 *
 * Path, status and the two counts are rendered for every file in the patch,
 * whether it is open, closed, binary, or empty. That is the rule this whole
 * module is written under: a reader is looking to find out what a change
 * touched, and a file that is absent from the list looks exactly like a file
 * that was never changed. Being closed is visible; being missing is not.
 *
 * ## `<details>` rather than a button and a boolean
 *
 * The browser already has a disclosure, it is keyboard-operable and
 * screen-reader-announced without anything here doing the work, and it survives
 * a re-render without state. `open` is still controlled, because the initial
 * value comes from the budget in `budget.ts` rather than from the element — but
 * `onToggle` is what drives it, so the browser's own affordances keep working.
 *
 * ## The mark is a character, not only a colour
 *
 * Every added line starts `+` and every removed one `-`, in the row, in the
 * text. The wash behind them is a second channel. A reader with the commonest
 * form of colour blindness loses nothing, and so does a reader who copies the
 * whole thing into a text editor — which is a real thing people do with diffs
 * and which a coloured-span-only rendering silently ruins.
 */

/** What a status reads as on screen. Words, because a coloured dot is not a sentence. */
const STATUS: Record<FileDiff['status'], string> = {
  added: 'added',
  removed: 'deleted',
  renamed: 'renamed',
  modified: 'changed',
}

function Line({ line }: { line: DiffLine }) {
  /*
   * A note — git's `\ No newline at end of file` — is neither side of the diff
   * and gets neither number and no wash. Drawing it as a context line would be
   * saying git's remark is a line of somebody's file.
   */
  const wash = line.kind === 'add' ? 'bg-add' : line.kind === 'del' ? 'bg-del' : ''
  const mark = line.kind === 'add' ? '+' : line.kind === 'del' ? '-' : line.kind === 'note' ? '\\' : ' '
  const markTone = line.kind === 'add' ? 'text-add-mark' : line.kind === 'del' ? 'text-del-mark' : 'text-gutter'
  return (
    <div className={`diff-row ${wash}`}>
      {/* Two gutters, both always present even when one is empty: a number that
          moves column depending on the kind of line is a number nobody can scan
          down. `select-none` so that dragging across the code to copy it does not
          pick up the line numbers, which is the thing that makes a copied diff
          useless.

          The width is `--gutter-ch`, set once per file from the widest number in
          it — see `FileSection`. A fixed width was measured wrong: a hunk at line
          2646 in a 220-pixel pane rendered "26462646" with the two columns
          touching, because four digits do not fit in three and a half characters
          and the overflow simply drew over the neighbour. Sizing to the content
          per ROW would fix the clipping and break the alignment, which is worse:
          the whole value of a gutter is that it is a column. */}
      <span className="w-[var(--gutter-ch)] shrink-0 select-none pr-1 text-right text-gutter">{line.old ?? ''}</span>
      <span className="w-[var(--gutter-ch)] shrink-0 select-none pr-1 text-right text-gutter">{line.new ?? ''}</span>
      <span className={`w-[1.5ch] shrink-0 select-none ${markTone}`}>{mark}</span>
      <span className="pr-2">{line.text}</span>
    </div>
  )
}

export function FileSection({
  file,
  open,
  onToggle,
}: {
  file: FileDiff
  open: boolean
  onToggle: () => void
}) {
  /**
   * How much of this one file is rendered.
   *
   * Grows by `FILE_LINES` a press. Kept per-file and per-mount rather than
   * lifted, because it is a thing about looking rather than a thing about the
   * change: nothing else needs to know, and reopening a file at its first
   * screenful is the right default even for somebody who expanded it a minute
   * ago against a diff that has since been refetched.
   */
  const [shown, setShown] = useState(FILE_LINES)

  /*
   * How many digits the widest line number in this file needs.
   *
   * Read off the lines, which already carry the numbers, rather than from the
   * file's length — which this app does not have and would have to guess at.
   * Two is the floor so that a one-line file still has a gutter wide enough to
   * look like one.
   */
  let widest = 2
  for (const hunk of file.hunks) {
    for (const line of hunk.lines) {
      const most = Math.max(line.old ?? 0, line.new ?? 0)
      if (most > 0) widest = Math.max(widest, String(most).length)
    }
  }

  /*
   * The hunks flattened into one list, with the `@@` headers kept in place.
   *
   * Flattened because the cap is counted in LINES and the headers are not lines
   * — a file of forty one-line hunks should show forty hunks, not be cut short by
   * its own bookkeeping. Kept in place because a hunk header is the only thing
   * that says the file jumped, and a diff with the jumps removed reads as
   * contiguous code that is not contiguous at all.
   */
  const rows: ({ at: 'hunk'; header: string } | { at: 'line'; line: DiffLine })[] = []
  let counted = 0
  let cut = 0
  for (const hunk of file.hunks) {
    if (counted >= shown) {
      cut += hunk.lines.length
      continue
    }
    rows.push({ at: 'hunk', header: hunk.header })
    for (const line of hunk.lines) {
      if (counted >= shown) {
        cut += 1
        continue
      }
      rows.push({ at: 'line', line })
      counted += 1
    }
  }

  return (
    <details
      open={open}
      onToggle={(e) => {
        /* Guarded, because `<details>` fires `toggle` on the initial render when
           `open` is set from the budget, and an unguarded handler would
           immediately close every file the plan had decided to open. */
        if ((e.currentTarget as HTMLDetailsElement).open !== open) onToggle()
      }}
      className="min-w-0 rounded-md border"
      data-file={file.path}
      data-open={open ? 'yes' : 'no'}
    >
      <summary className="cursor-pointer list-none px-2 py-1 text-[0.7rem] leading-4 marker:content-['']">
        <span className="font-mono">{file.path}</span>
        {file.from && file.from !== file.path ? (
          <span className="text-muted-foreground"> ← {file.from}</span>
        ) : null}
        <span className="ml-1 whitespace-nowrap text-muted-foreground">
          {STATUS[file.status]}
          {file.binary ? ', binary' : ''}
          {file.added || file.removed ? (
            <>
              {' · '}
              <span className="text-add-mark">+{file.added}</span> <span className="text-del-mark">−{file.removed}</span>
            </>
          ) : null}
        </span>
      </summary>

      {file.binary ? (
        /* Not an omission and not a failure: git itself declined to print the
           content, and saying which is the difference between a reader who knows
           the file changed and one who thinks this app dropped it. */
        <p className="border-t px-2 py-1 text-[0.7rem] leading-4 text-muted-foreground">
          Git says this file is binary and printed no lines for it. It was {STATUS[file.status]}; what changed inside it is
          not something a patch can show.
        </p>
      ) : file.hunks.length === 0 ? (
        <p className="border-t px-2 py-1 text-[0.7rem] leading-4 text-muted-foreground">
          {file.status === 'renamed'
            ? 'Renamed, with no change to its contents — so there is nothing to show inside it.'
            : 'The patch names this file and prints no lines for it. That is usually a mode change or an empty file; either way nothing was left out here.'}
        </p>
      ) : (
        <div
          className="diff-scroll border-t font-mono text-[0.65rem] leading-[1.35]"
          /* One width for every gutter in this file, from its own largest line
             number plus a character of space. Per file rather than per patch
             because a change that touches a 12-line README and a 40,000-line
             generated file should not spend six columns of a 220-pixel pane on
             the README. */
          style={{ '--gutter-ch': `${widest + 1}ch` } as CSSProperties}
        >
          {rows.map((row, at) =>
            row.at === 'hunk' ? (
              <div key={at} className="diff-row bg-muted px-1 text-muted-foreground">
                {row.header}
              </div>
            ) : (
              <Line key={at} line={row.line} />
            ),
          )}
        </div>
      )}

      {cut > 0 ? (
        /* The count is exact and it is the point. "Showing part of this file"
           would be a truncation a reader has to take on trust; a number they can
           press is a truncation they can undo. */
        <div className="border-t px-2 py-1 text-[0.7rem] leading-4">
          <span className="text-muted-foreground">
            {cut} more {cut === 1 ? 'line' : 'lines'} in this file are not drawn yet.{' '}
          </span>
          <button
            type="button"
            className="cursor-pointer underline underline-offset-2"
            onClick={() => setShown((was) => was + FILE_LINES)}
          >
            Draw {Math.min(cut, FILE_LINES)} more
          </button>
          {cut > FILE_LINES ? (
            <>
              {' · '}
              <button
                type="button"
                className="cursor-pointer underline underline-offset-2"
                onClick={() => setShown(Number.MAX_SAFE_INTEGER)}
              >
                Draw all {cut}
              </button>
            </>
          ) : null}
        </div>
      ) : null}
    </details>
  )
}
