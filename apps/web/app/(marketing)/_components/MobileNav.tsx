"use client";

import Link from "next/link";
import { Menu } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { buttonVariants } from "@/components/ui/button";
import { Sheet, SheetClose, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Logo } from "@/components/layout/Logo";
import { ThemeToggle } from "@/components/layout/ThemeToggle";
import { ROUTES } from "@/lib/constants/shared";
import { HEADER_LINKS } from "./nav";

/** Menu sheet for phones and tablets: every header link plus the secondary actions. */
export function MobileNav({ className }: { className?: string }) {
  return (
    <Sheet>
      <SheetTrigger
        aria-label="Open menu"
        className={cn(
          "flex h-[34px] w-[34px] items-center justify-center rounded-[5px] border border-line-4 bg-card text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
          className,
        )}
      >
        <Menu className="h-4 w-4" aria-hidden />
      </SheetTrigger>
      <SheetContent side="right" className="flex w-[88%] max-w-sm flex-col gap-0 border-line-3 bg-frame p-0">
        <div className="flex h-[68px] items-center px-5">
          <SheetTitle asChild>
            <div>
              <Logo href={ROUTES.home} />
            </div>
          </SheetTitle>
        </div>
        <nav aria-label="Mobile" className="flex flex-col px-5 pt-4">
          {HEADER_LINKS.map((link) => (
            <SheetClose asChild key={link.label}>
              <Link
                href={link.href}
                className="border-b border-line-4 py-4 text-[22px] tracking-[-0.03em] text-foreground"
              >
                {link.label}
              </Link>
            </SheetClose>
          ))}
        </nav>
        <div className="mt-auto flex flex-col gap-2.5 p-5">
          <SheetClose asChild>
            <Link href={ROUTES.signup} className={cn(buttonVariants({ size: "lg" }), "w-full")}>
              Start free
            </Link>
          </SheetClose>
          <SheetClose asChild>
            <Link href="/#universities" className={cn(buttonVariants({ variant: "strong", size: "lg" }), "w-full")}>
              Book a demo
            </Link>
          </SheetClose>
          <div className="mt-2 flex items-center justify-between">
            <SheetClose asChild>
              <Link href={ROUTES.login} className="text-sm text-foreground">
                Log in
              </Link>
            </SheetClose>
            <ThemeToggle />
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
