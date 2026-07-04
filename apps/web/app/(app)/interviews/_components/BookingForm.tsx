"use client";

import { useState } from "react";
import { CalendarIcon, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Card, CardContent } from "@/components/ui/card";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { SectionLabel } from "@/components/patterns";
import { cn } from "@/lib/utils/cn";
import { useJds } from "@/features/jobs";
import { useCreateSession, type CreateInterviewSessionRequest } from "@/features/interview";

const selectClass =
  "h-9 w-full rounded-md border border-input bg-background px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";

// Bookable hourly slots (local time). Kept simple for V1 — a fixed daytime window.
const SLOT_HOURS = [9, 10, 11, 12, 13, 14, 15, 16, 17, 18];

function startOfToday(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

/** A slot is in the past (not bookable) if the chosen date + hour is at or before now. */
function isPastSlot(d: Date | undefined, h: number): boolean {
  if (!d) return false;
  const slot = new Date(d);
  slot.setHours(h, 0, 0, 0);
  return slot.getTime() <= Date.now();
}

export function BookingForm() {
  const { data: jds, isLoading: jdsLoading } = useJds();
  const create = useCreateSession();

  const [jobDescriptionId, setJobDescriptionId] = useState("");
  const [date, setDate] = useState<Date | undefined>(undefined);
  const [hour, setHour] = useState<number | null>(null);
  const [dateOpen, setDateOpen] = useState(false);

  const hourValid = hour !== null && !isPastSlot(date, hour);
  const canSubmit =
    Boolean(jobDescriptionId && date && hourValid) && !create.isPending;

  function reset() {
    setJobDescriptionId("");
    setDate(undefined);
    setHour(null);
  }

  function submit() {
    if (!date || hour === null) return;
    const slot = new Date(date);
    slot.setHours(hour, 0, 0, 0);
    // The candidate does not pick the round — the backend assigns it (currently the first round).
    const body: CreateInterviewSessionRequest = {
      jobDescriptionId,
      scheduledAt: slot.toISOString(),
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    };
    create.mutate(body, {
      onSuccess: () => {
        toast.success("Interview booked — we'll prepare it before your slot.");
        reset();
      },
      onError: () => toast.error("Couldn't book that interview. Please try again."),
    });
  }

  return (
    <Card>
      <CardContent className="space-y-5 p-6">
        <SectionLabel>Book a mock interview</SectionLabel>

        <label className="space-y-1.5 text-sm">
          <span className="text-muted-foreground">Role</span>
          <select
            aria-label="Job description"
            className={selectClass}
            value={jobDescriptionId}
            onChange={(e) => setJobDescriptionId(e.target.value)}
          >
            <option value="">{jdsLoading ? "Loading roles…" : "Select a role"}</option>
            {(jds ?? []).map((jd) => (
              <option key={jd.id} value={jd.id}>
                {jd.companyName} — {jd.title} ({jd.level})
              </option>
            ))}
          </select>
        </label>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5 text-sm">
            <span className="text-muted-foreground">Date</span>
            <Popover open={dateOpen} onOpenChange={setDateOpen}>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  className={cn("w-full justify-start font-normal", !date && "text-muted-foreground")}
                >
                  <CalendarIcon />
                  {date
                    ? date.toLocaleDateString(undefined, {
                        weekday: "short",
                        month: "short",
                        day: "numeric",
                      })
                    : "Pick a date"}
                </Button>
              </PopoverTrigger>
              <PopoverContent align="start" className="p-0">
                <Calendar
                  mode="single"
                  selected={date}
                  onSelect={(d) => {
                    setDate(d);
                    setDateOpen(false);
                  }}
                  disabled={{ before: startOfToday() }}
                  autoFocus
                />
              </PopoverContent>
            </Popover>
          </div>

          <div className="space-y-1.5 text-sm">
            <span className="text-muted-foreground">
              Time slot <span className="font-mono text-xs">(local time)</span>
            </span>
            <div className="grid grid-cols-5 gap-1.5">
              {SLOT_HOURS.map((h) => {
                const past = isPastSlot(date, h);
                const selected = hour === h && !past;
                return (
                  <button
                    key={h}
                    type="button"
                    disabled={past}
                    onClick={() => setHour(h)}
                    className={cn(
                      "h-8 rounded-md border text-xs transition-colors disabled:cursor-not-allowed disabled:opacity-40",
                      selected
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-input bg-background hover:bg-accent hover:text-accent-foreground",
                    )}
                  >
                    {String(h).padStart(2, "0")}:00
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        <div className="flex justify-end">
          <Button disabled={!canSubmit} onClick={submit}>
            {create.isPending ? <Loader2 className="animate-spin" /> : null}
            Book interview
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
