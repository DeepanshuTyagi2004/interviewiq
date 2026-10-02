"use client";

import { useState } from "react";
import { CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ApiFetchError } from "@/lib/api-client/client";
import { cn } from "@/lib/utils/cn";
import { useSubmitExperience } from "@/features/experiences";

const LEVELS = [
  { value: "fresher", label: "Fresher" },
  { value: "sde1", label: "SDE-1" },
  { value: "sde2", label: "SDE-2" },
  { value: "sde3", label: "SDE-3" },
];

export const MIN_CONTENT = 20;

/** Company, level and a free-text write-up, posted to the experiences endpoint. */
export function ExperienceForm() {
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

  const length = content.trim().length;
  const disabled = submit.isPending || !company.trim() || length < MIN_CONTENT;
  // Confirm inline until the user starts on the next write-up.
  const justSubmitted = submit.isSuccess && !company && !content;

  return (
    <section
      aria-labelledby="experience-form-title"
      className="min-w-0 overflow-hidden rounded-[14px] border border-line-2 bg-card"
    >
      <div className="border-b border-line px-4 py-4 sm:px-5">
        <h2 id="experience-form-title" className="m-0 text-sm font-normal">
          Your experience
        </h2>
      </div>

      <form onSubmit={onSubmit} className="flex flex-col">
        <div className="flex flex-col gap-6 px-4 py-5 sm:px-5">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="company" className="text-[13px] font-normal text-muted-foreground">
              Company
            </Label>
            <Input
              id="company"
              value={company}
              onChange={(e) => setCompany(e.target.value)}
              placeholder="e.g. Google"
              autoComplete="off"
              className="h-10"
            />
          </div>

          <fieldset className="m-0 flex min-w-0 flex-col gap-2 border-0 p-0">
            <legend className="mb-2 p-0 text-[13px] text-muted-foreground">Level</legend>
            <div className="grid grid-cols-4 gap-1.5 sm:flex sm:flex-wrap">
              {LEVELS.map((l) => {
                const selected = level === l.value;
                return (
                  <label
                    key={l.value}
                    className={cn(
                      "inline-flex h-9 cursor-pointer items-center justify-center rounded-full border px-2 text-[13px] sm:px-3.5 transition-colors duration-200 has-[:focus-visible]:ring-1 has-[:focus-visible]:ring-ring has-[:focus-visible]:ring-offset-1 has-[:focus-visible]:ring-offset-background",
                      selected
                        ? "border-foreground bg-primary text-primary-foreground"
                        : "border-line-3 bg-card text-foreground hover:border-faint-2",
                    )}
                  >
                    <input
                      type="radio"
                      name="level"
                      value={l.value}
                      checked={selected}
                      onChange={() => setLevel(l.value)}
                      className="sr-only"
                    />
                    {l.label}
                  </label>
                );
              })}
            </div>
          </fieldset>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="content" className="text-[13px] font-normal text-muted-foreground">
              What happened?
            </Label>
            <Textarea
              id="content"
              value={content}
              onChange={(e) => setContent(e.target.value)}
              rows={10}
              aria-describedby="content-hint"
              placeholder="Walk through each round: format (DSA / system design / behavioural), topics, problems asked, difficulty, whether hints were given, and the outcome if you know it."
              className="min-h-[220px] leading-[1.55]"
            />
            <div id="content-hint" className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 text-xs">
              <span className="text-faint">
                Minimum {MIN_CONTENT} characters. The more detail per round, the more useful the signal.
              </span>
              <span className={cn("font-mono tabular-nums", length >= MIN_CONTENT ? "text-muted-foreground" : "text-faint")}>
                {length.toLocaleString()} {length === 1 ? "character" : "characters"}
              </span>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line bg-panel/60 px-4 py-3.5 sm:px-5">
          {justSubmitted ? (
            <p role="status" className="m-0 flex items-center gap-2 text-[13px]">
              <CheckCircle2 aria-hidden className="h-4 w-4" />
              Submitted. Thanks for sharing.
            </p>
          ) : (
            <p className="m-0 text-[13px] text-muted-foreground">Descriptive only: no names or confidential material.</p>
          )}
          <Button type="submit" disabled={disabled} className="ml-auto h-10 px-4">
            {submit.isPending ? "Submitting…" : "Submit experience"}
          </Button>
        </div>
      </form>
    </section>
  );
}
