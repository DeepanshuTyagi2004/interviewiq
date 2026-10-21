"use client"

import { useTheme } from "next-themes"
import { Toaster as Sonner } from "sonner"

type ToasterProps = React.ComponentProps<typeof Sonner>

const Toaster = ({ ...props }: ToasterProps) => {
  const { theme = "system" } = useTheme()

  return (
    <Sonner
      theme={theme as ToasterProps["theme"]}
      className="toaster group"
      toastOptions={{
        classNames: {
          toast:
            "group toast group-[.toaster]:rounded-tile group-[.toaster]:border-0 group-[.toaster]:bg-background group-[.toaster]:text-foreground group-[.toaster]:shadow-float",
          description: "group-[.toast]:text-ink-3",
          actionButton:
            "group-[.toast]:rounded-full group-[.toast]:bg-ink group-[.toast]:text-background",
          cancelButton:
            "group-[.toast]:rounded-full group-[.toast]:bg-surface-2 group-[.toast]:text-ink-2",
        },
      }}
      {...props}
    />
  )
}

export { Toaster }
