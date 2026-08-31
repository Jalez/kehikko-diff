import { Slot } from '@radix-ui/react-slot'
import { cva, type VariantProps } from 'class-variance-authority'
import type * as React from 'react'

import { cn } from '@/lib/utils.ts'

/**
 * shadcn's button, with one size and one variant added for this app's normal
 * case.
 *
 * `container` is a target sized for a container 220 pixels wide, and it is a variant
 * rather than a set of overrides at each call site so that every press on this
 * page is the same height. The default `sm` is 32 pixels tall and fine on a
 * page; in a 340-pixel-tall container above a diff it eats the diff.
 *
 * `link` is the one that needs defending, because a boxed button would have
 * been the shadcn-ish answer. The presses in this app are all mid-sentence —
 * "…and 1,240 more lines in this file are not drawn yet. Draw 800 more" — and
 * the sentence is doing the explaining. A box around the last three words of a
 * paragraph breaks the paragraph in half and pushes the number that gives it
 * meaning onto its own line at 220 pixels. So the press stays inline and is
 * marked as a press by an underline, which is the affordance a reader already
 * knows from the link two lines above it. It is still a `<button>`: it does
 * something here rather than going somewhere, and `asChild` exists for the
 * cases where it genuinely is a link.
 */
const buttonVariants = cva(
  "inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground hover:opacity-90',
        outline: 'border bg-transparent hover:bg-accent hover:text-accent-foreground',
        ghost: 'hover:bg-accent hover:text-accent-foreground',
        link: 'cursor-pointer underline underline-offset-2 hover:opacity-80',
      },
      size: {
        default: 'h-9 px-4 py-2',
        sm: 'h-8 rounded-md px-3',
        container: 'h-6 rounded px-2 text-xs',
        /* No height and no padding: this one sits inside a running sentence and
           has to share its line box with the words around it. */
        inline: 'h-auto rounded-sm p-0 text-[0.7rem] leading-4 whitespace-normal',
        icon: 'size-8',
      },
    },
    defaultVariants: { variant: 'default', size: 'default' },
  },
)

function Button({
  className,
  variant,
  size,
  asChild = false,
  ...props
}: React.ComponentProps<'button'> & VariantProps<typeof buttonVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot : 'button'
  return <Comp data-slot="button" className={cn(buttonVariants({ variant, size, className }))} {...props} />
}

export { Button, buttonVariants }
