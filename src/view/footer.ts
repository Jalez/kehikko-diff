import { LIMITS, footerItemsSchema, type FooterItem } from 'kehikot-module-protocol'

import { totals } from '@/diff/parse.ts'
import type { Ask } from '@/view/change.tsx'

/**
 * Diff's footer, in a host that draws one (`kehikot.footer`, protocol 2.38.0): what is selected
 * and how big its diff is, so a container folded to its header and footer still says it. It is
 * the line the page drew above the changes ("One reference is selected; Kehikot last read this
 * epic at …") and the host's answer to a pointed line, in one row the host draws. Diff has no
 * header: what it shows is the canvas's selection, never a choice made here. Nothing in the
 * footer is pressable.
 *
 * - what is selected: the ref, or how many; when the epic was last read, in the tooltip;
 * - the shown diff's size (files, lines added and removed), or that it is being read, or why not;
 * - what the host said when it did not take a pointed line.
 *
 * Pure: the page declares it only when the greeting said the host draws it.
 */
export interface FooterState {
  refs: readonly string[]
  /** The first change whose diff was asked for, and how that went; null when none was. */
  shown: { ref: string; ask: Ask } | null
  /** When Kehikot last read the epic, as the page says it, or null. */
  taken: string | null
  /** What the host said when it did not take a pointed line, or null. */
  refused: string | null
}

const cut = (text: string, most: number) => (text.length > most ? `${text.slice(0, most - 1)}…` : text)

export function footerItems({ refs, shown, taken, refused }: FooterState): FooterItem[] {
  if (!refs.length) return footerItemsSchema.parse([{ kind: 'text', id: 'selected', text: 'Nothing selected' }])
  const items: unknown[] = []
  const selected = refs.length === 1 ? refs[0]! : `${refs.length} selected`
  const tip = `${refs.length === 1 ? 'One reference is' : `${refs.length} references are`} selected on the canvas${taken ? `; Kehikot last read this epic at ${taken}` : ''}.`
  items.push({ kind: 'text', id: 'selected', text: cut(selected, LIMITS.FOOTER_TEXT), tooltip: cut(tip, LIMITS.FOOTER_TOOLTIP) })
  if (shown) {
    const of = refs.length > 1 ? `${shown.ref}: ` : ''
    if (shown.ask.at === 'ok') {
      const sum = totals(shown.ask.patch.files)
      items.push({
        kind: 'text',
        id: 'size',
        text: cut(`${of}${sum.files === 1 ? '1 file' : `${sum.files} files`} · +${sum.added} −${sum.removed}`, LIMITS.FOOTER_TEXT),
        tooltip: cut(`The diff of ${shown.ref}: ${sum.files} files, ${sum.added} lines added and ${sum.removed} removed.`, LIMITS.FOOTER_TOOLTIP),
      })
    } else if (shown.ask.at === 'asking') {
      items.push({ kind: 'text', id: 'size', text: cut(`Reading the diff of ${shown.ref}…`, LIMITS.FOOTER_TEXT), optional: true })
    } else {
      items.push({ kind: 'text', id: 'size', text: cut(`${of}${shown.ask.error}`, LIMITS.FOOTER_TEXT), level: 'warn', tooltip: cut(shown.ask.error, LIMITS.FOOTER_TOOLTIP) })
    }
  }
  if (refused) items.push({ kind: 'text', id: 'refused', text: cut(refused, LIMITS.FOOTER_TEXT), level: 'warn', align: 'end', tooltip: cut(refused, LIMITS.FOOTER_TOOLTIP) })
  return footerItemsSchema.parse(items)
}
