"use client";

import * as React from "react";
import { toast } from "sonner";
import { HudCard } from "@/components/hud";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ApiFetchError } from "@/lib/api-client/client";
import { useCreateCompany } from "@/features/research";

/** "TCS, Tata CS" → ["TCS", "Tata CS"]. The API trims, dedupes and validates. */
export function parseAliasInput(raw: string): string[] {
  return raw.split(",").map((a) => a.trim()).filter(Boolean);
}

/** Add a company to the curated research list. The next run (or "Research now") picks it up. */
export function AddCompanyForm() {
  const create = useCreateCompany();
  const [name, setName] = React.useState("");
  const [website, setWebsite] = React.useState("");
  const [aliases, setAliases] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      const company = await create.mutateAsync({ name, website: website.trim() || null, aliases: parseAliasInput(aliases) });
      toast.success(`${company.name} added · the next research run picks it up`);
      setName("");
      setWebsite("");
      setAliases("");
    } catch (err) {
      setError(err instanceof ApiFetchError ? err.message : "Could not add the company.");
    }
  }

  return (
    <HudCard title="Add a company" spotlight={false}>
      <form
        onSubmit={onSubmit}
        aria-label="Add a company"
        className="grid gap-3 sm:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-end"
      >
        <div className="grid gap-1.5">
          <Label htmlFor="company-name">Name</Label>
          <Input id="company-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Meesho" required maxLength={255} />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="company-website">Website (optional)</Label>
          <Input id="company-website" value={website} onChange={(e) => setWebsite(e.target.value)} placeholder="meesho.com" />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="company-aliases">Aliases (optional, comma-separated)</Label>
          <Input id="company-aliases" value={aliases} onChange={(e) => setAliases(e.target.value)} placeholder="Fashnear Technologies" />
        </div>
        <Button type="submit" disabled={create.isPending || !name.trim()}>
          {create.isPending ? "Adding…" : "Add company"}
        </Button>
      </form>
      {error ? <p role="alert" className="m-0 mt-3 text-[13px] text-destructive">{error}</p> : null}
    </HudCard>
  );
}
