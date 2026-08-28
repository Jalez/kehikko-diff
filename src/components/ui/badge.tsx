import { cva, type VariantProps } from 'class-variance-authority'
import type * as React from 'react'

import { cn } from '@/lib/utils.ts'

/**
 * shadcn's badge, used here for the two numbers a reader of a diff looks for
 * first: how much was added to a file and how much was taken out of it.
 *
 * ## The sign is inside the badge, and it is not decoration
 *
 * `add` and `del` differ by hue, and hue is the second channel rather than the
 * only one. Every one of these badges carries a `+` or a `−` in its own text,
 * so a reader with the commonest form of colour blindness — red/green, which is
 * exactly the pair a diff is traditionally drawn in — reads the same two facts
 * off the characters that everybody else reads off the colours. The same rule
 * runs through the rows below: the marker column and the two line-number
 * gutters carry it there. Nothing in this app is knowable by colour alone.
 *
 * The wash behind the number is the same `--add` / `--del` the rows use, and the
 * text is the same `--add-mark` / `--del-mark`, so a badge in the header and a
 * line in the body are visibly the same claim. Both pairs are defined twice in
 * `index.css`, light and dark, because a low-chroma wash that reads as "green"
 * on white is invisible on near-black.
 *
 * `whitespace-nowrap` is deliberate at 220px: a badge that wraps to two lines
 * reads as two badges.
 */
const badgeVariants = cva(
  'inline-flex shrink-0 items-center rounded border px-1.5 py-px text-[0.65rem] font-medium leading-4 whitespace-nowrap tabular-nums',
  {
    variants: {
      variant: {
        default: 'bg-muted text-muted-foreground',
        outline: 'text-muted-foreground',
        add: 'border-add-mark/40 bg-add text-add-mark',
        del: 'border-del-mark/40 bg-del text-del-mark',
      },
    },
    defaultVariants: { variant: 'default' },
  },
)

function Badge({ className, variant, ...props }: React.ComponentProps<'span'> & VariantProps<typeof badgeVariants>) {
  return <span data-slot="badge" className={cn(badgeVariants({ variant }), className)} {...props} />
}

export { Badge, badgeVariants }
