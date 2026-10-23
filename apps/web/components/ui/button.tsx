import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils/cn"

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-full text-sm font-medium transition-colors duration-150 ease-iq focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        /** Primary CTA: an ink pill. */
        default: "iq-brand-glass",
        /** Same ink pill, kept as an alias for existing call sites. */
        ink: "bg-ink text-background shadow-[inset_0_1px_0_rgb(255_255_255/.18)] hover:bg-ink-2",
        destructive:
          "bg-destructive text-destructive-foreground hover:bg-destructive/90",
        outline: "iq-glass-btn",
        /** Alias of outline, kept for existing call sites. */
        strong: "iq-glass-btn",
        /** A stone pill with the ring. */
        secondary: "iq-glass-btn",
        ghost: "text-foreground hover:bg-surface-2",
        link: "rounded-md text-foreground underline-offset-4 hover:underline",
      },
      size: {
        default: "h-10 px-[18px]",
        sm: "h-8 px-3.5 text-[13px]",
        lg: "h-12 px-6 text-[15px]",
        icon: "h-9 w-9 p-0",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button"
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    )
  }
)
Button.displayName = "Button"

export { Button, buttonVariants }
