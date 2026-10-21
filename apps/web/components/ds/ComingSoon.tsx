import Link from "next/link";
import { PAGE_SCAFFOLD } from "@/components/layout/page";
import { Button } from "@/components/ui/button";
import { Card } from "./Card";
import { EmptyState } from "./EmptyState";
import { PageHeader } from "./PageHeader";

export interface ComingSoonProps {
  title: string;
  hint?: string;
  /** Where the optional button goes. */
  href?: string;
  /** The button's label; the button shows only when both `href` and `cta` are given. */
  cta?: string;
}

/** A screen that is not built yet: the page title over an empty state, inside the page frame. */
export function ComingSoon({ title, hint, href, cta }: ComingSoonProps) {
  return (
    <div className={`${PAGE_SCAFFOLD} gap-6`}>
      <PageHeader title={title} />
      <Card tone="surface" as="section" aria-label={`${title}, coming soon`}>
        <EmptyState title="Coming soon" hint={hint ?? "This screen is on the way."}>
          {href && cta ? (
            <Button asChild variant="secondary">
              <Link href={href}>{cta}</Link>
            </Button>
          ) : null}
        </EmptyState>
      </Card>
    </div>
  );
}
