import * as React from "react"

import { cn } from "@/lib/utils/cn"

const Input = React.forwardRef<HTMLInputElement, React.ComponentProps<"input">>(
  ({ className, type, ...props }, ref) => {
    return (
      <input
        type={type}
        className={cn(
          "flex h-10 w-full rounded-full bg-background px-4 py-1 text-base shadow-ring transition-[box-shadow] duration-150 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-ink-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
          className
        )}
        ref={ref}
        {...props}
      />
    )
  }
)
Input.displayName = "Input"

export { Input }
