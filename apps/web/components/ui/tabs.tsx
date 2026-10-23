"use client"

import * as React from "react"
import * as TabsPrimitive from "@radix-ui/react-tabs"

import { cn } from "@/lib/utils/cn"

type TabsVariant = "pill" | "underline"

/** Lets a trigger follow its list's variant without repeating the prop. */
const TabsVariantContext = React.createContext<TabsVariant>("pill")

const Tabs = TabsPrimitive.Root

type TabsListProps = React.ComponentPropsWithoutRef<typeof TabsPrimitive.List> & {
  /** `pill` (default) is a segmented surface-2 control; `underline` is the Explore tab style. */
  variant?: TabsVariant
}

const TabsList = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.List>,
  TabsListProps
>(({ className, variant = "pill", ...props }, ref) => (
  <TabsVariantContext.Provider value={variant}>
    <TabsPrimitive.List
      ref={ref}
      className={cn(
        variant === "pill"
          ? "inline-flex h-10 items-center justify-center rounded-full bg-surface-2 p-1 text-ink-2"
          : "inline-flex items-center gap-1 border-b border-line text-ink-3",
        className
      )}
      {...props}
    />
  </TabsVariantContext.Provider>
))
TabsList.displayName = TabsPrimitive.List.displayName

type TabsTriggerProps = React.ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger> & {
  variant?: TabsVariant
}

const TabsTrigger = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Trigger>,
  TabsTriggerProps
>(({ className, variant, ...props }, ref) => {
  const inherited = React.useContext(TabsVariantContext)
  const v = variant ?? inherited
  return (
    <TabsPrimitive.Trigger
      ref={ref}
      className={cn(
        "inline-flex items-center justify-center whitespace-nowrap text-sm font-medium transition-colors duration-150 ease-iq focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-50",
        v === "pill"
          ? "h-8 rounded-full px-4 data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-ring"
          : "-mb-px h-10 border-b-2 border-transparent px-3 hover:text-foreground data-[state=active]:border-ink data-[state=active]:text-foreground",
        className
      )}
      {...props}
    />
  )
})
TabsTrigger.displayName = TabsPrimitive.Trigger.displayName

const TabsContent = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Content>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Content
    ref={ref}
    className={cn(
      "mt-2 ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink focus-visible:ring-offset-2",
      className
    )}
    {...props}
  />
))
TabsContent.displayName = TabsPrimitive.Content.displayName

export { Tabs, TabsList, TabsTrigger, TabsContent }
