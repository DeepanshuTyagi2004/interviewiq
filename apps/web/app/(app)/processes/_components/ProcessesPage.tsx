"use client";

import { useState } from "react";
import { Plus, Search } from "lucide-react";
import { PageHeader } from "@/components/ds";
import { Button } from "@/components/ui/button";
import { CreateProcessDialog } from "./CreateProcessDialog";
import { ProcessList } from "./ProcessList";

/** `/processes`: create interview processes and manage the ones you've saved. */
export function ProcessesPage() {
  const [creating, setCreating] = useState(false);

  return (
    <div>
      <PageHeader
        eyebrow="Interview processes"
        title="Custom processes"
        description="Build an interview process for any level: add, remove and connect rounds, then start a track from it. Custom processes are standalone practice and never count towards readiness."
        actions={
          <Button onClick={() => setCreating(true)}>
            <Plus aria-hidden />New process
          </Button>
        }
      />
      <ProcessesPanel creating={creating} onCreatingChange={setCreating} className="mt-8" />
    </div>
  );
}

/**
 * Search, the saved processes and the create dialog: the body of /processes and of the Custom
 * processes tab on My tracks.
 */
export function ProcessesPanel({
  creating,
  onCreatingChange,
  className,
}: {
  creating: boolean;
  onCreatingChange: (open: boolean) => void;
  className?: string;
}) {
  const [query, setQuery] = useState("");

  return (
    <div className={className}>
      <label className="flex h-11 min-w-0 items-center gap-2.5 rounded-full bg-background px-4 shadow-ring transition-shadow focus-within:ring-2 focus-within:ring-brand focus-within:ring-offset-2 focus-within:ring-offset-background">
        <Search aria-hidden className="h-4 w-4 flex-none text-ink-3" />
        <input
          type="search"
          aria-label="Search processes"
          placeholder="Search by name, level, company or role"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="h-full min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-placeholder"
        />
      </label>

      <div className="mt-6">
        <ProcessList query={query} onCreate={() => onCreatingChange(true)} />
      </div>

      <CreateProcessDialog open={creating} onOpenChange={onCreatingChange} />
    </div>
  );
}
