"use client";

import { useState } from "react";
import { toast } from "sonner";
import { PageHeader } from "@/components/patterns";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ApiFetchError } from "@/lib/api-client/client";
import { useSubmitExperience } from "@/features/experiences";

const LEVELS = [
  { value: "fresher", label: "Fresher" },
  { value: "sde1", label: "SDE-1" },
  { value: "sde2", label: "SDE-2" },
  { value: "sde3", label: "SDE-3" },
];

const MIN_CONTENT = 20;

export default function ShareExperiencePage() {
  const [company, setCompany] = useState("");
  const [level, setLevel] = useState("fresher");
  const [content, setContent] = useState("");
  const submit = useSubmitExperience();

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    submit.mutate(
      { company: company.trim(), level, content: content.trim() },
      {
        onSuccess: () => {
          toast.success("Thanks! Your experience was submitted for processing.");
          setCompany("");
          setContent("");
        },
        onError: (err) =>
          toast.error(
            err instanceof ApiFetchError ? err.message : "Could not submit your experience.",
          ),
      },
    );
  }

  const disabled =
    submit.isPending || !company.trim() || content.trim().length < MIN_CONTENT;

  return (
    <div className="flex-1 space-y-8 p-6">
      <PageHeader
        title="Share an interview experience"
        description="Just interviewed somewhere? Share what happened — it helps build company-specific interview intelligence for everyone. Descriptive only; no names or confidential material."
      />

      <form onSubmit={onSubmit} className="max-w-2xl space-y-5">
        <div className="space-y-2">
          <Label htmlFor="company">Company</Label>
          <Input
            id="company"
            value={company}
            onChange={(e) => setCompany(e.target.value)}
            placeholder="e.g. Google"
            autoComplete="off"
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="level">Level</Label>
          <select
            id="level"
            value={level}
            onChange={(e) => setLevel(e.target.value)}
            className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          >
            {LEVELS.map((l) => (
              <option key={l.value} value={l.value}>
                {l.label}
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-2">
          <Label htmlFor="content">What happened?</Label>
          <Textarea
            id="content"
            value={content}
            onChange={(e) => setContent(e.target.value)}
            rows={10}
            placeholder="Walk through each round: format (DSA / system design / behavioural), topics, problems asked, difficulty, whether hints were given, and the outcome if you know it."
          />
          <p className="text-xs text-muted-foreground">
            Minimum {MIN_CONTENT} characters. The more detail per round, the more useful the signal.
          </p>
        </div>

        <Button type="submit" disabled={disabled}>
          {submit.isPending ? "Submitting…" : "Submit experience"}
        </Button>
      </form>
    </div>
  );
}
