"use client";

import { useState } from "react";
import { Plus, Search } from "lucide-react";
import { PAGE_SCAFFOLD } from "@/components/layout/page";
import { Button } from "@/components/ui/button";
import { CreateProcessDialog } from "./CreateProcessDialog";
import { ProcessList } from "./ProcessList";

/** `/processes`: create interview processes and manage the ones you've saved. */
export function ProcessesPage() {
  const [creating, setCreating] = useState(false);
  const [query, setQuery] = useState("");

  return (
    <div className={PAGE_SCAFFOLD}>
      <div className="flex flex-wrap items-end justify-between gap-5">
        <div className="min-w-0">
          <p className="iq-eyebrow m-0">Interview processes</p>
          <h1 className="m-0 mt-1.5 text-[26px] font-normal leading-[1.1] tracking-[-0.04em] sm:text-[30px]">Your processes</h1>
          <p className="m-0 mt-1.5 max-w-[640px] text-[14px] leading-[1.5] text-muted-foreground">
            Build an interview process for any level: add, remove and connect rounds, then start a track from it. Custom
            processes are standalone practice and never count towards readiness.
          </p>
        </div>
        <Button className="h-10 px-4 text-[13.5px]" onClick={() => setCreating(true)}>
          <Plus aria-hidden />New process
        </Button>
      </div>

      <label className="mt-5 flex h-[42px] min-w-0 items-center gap-2.5 rounded-full border border-line-3 bg-card px-3.5 transition-colors focus-within:border-faint">
        <Search aria-hidden className="h-4 w-4 flex-none text-faint" />
        <input
          type="search"
          aria-label="Search processes"
          placeholder="Search by name, level, company or role"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="h-full min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-faint"
        />
      </label>

      <div className="mt-5">
        <ProcessList query={query} onCreate={() => setCreating(true)} />
      </div>

      <CreateProcessDialog open={creating} onOpenChange={setCreating} />
    </div>
  );
}
