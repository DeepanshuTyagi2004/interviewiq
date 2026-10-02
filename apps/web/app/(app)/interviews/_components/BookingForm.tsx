"use client";

import { useState } from "react";
import { CalendarIcon, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { cn } from "@/lib/utils/cn";
import { ROUND_OPTIONS } from "@/lib/constants/interview";
import { useJds, type JdSummary } from "@/features/jobs";
import { useCreateSession, type CreateInterviewSessionRequest, type RoundType } from "@/features/interview";
import { levelLabel, roundLabel } from "@/features/interview/presentation";

// Bookable hourly slots (local time). Kept simple for V1 — a fixed daytime window.
const SLOT_HOURS = [9, 10, 11, 12, 13, 14, 15, 16, 17, 18];

// Day chips cover the coming week; anything further out goes through the calendar.
const DAY_CHIPS = 7;

// "Start now" nudges scheduledAt a minute into the future so the backend's past-slot
// guard passes; prep kicks off on the session's next status poll. A dedicated
// prepare-now trigger is a deferred backend refinement (sub-project A).
const START_NOW_BUFFER_MS = 60_000;

type BookingMode = "now" | "schedule";

function startOfToday(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

function addDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

function sameDay(a: Date | undefined, b: Date): boolean {
  return !!a && a.toDateString() === b.toDateString();
}

/** A slot is in the past (not bookable) if the chosen date + hour is at or before now. */
function isPastSlot(d: Date | undefined, h: number): boolean {
  if (!d) return false;
  const slot = new Date(d);
  slot.setHours(h, 0, 0, 0);
  return slot.getTime() <= Date.now();
}

/** "Meesho · SDE I Backend", adding the level only when the title doesn't already say it. */
function jdOptionLabel(jd: JdSummary): string {
  const level = levelLabel(jd.level);
  const base = `${jd.companyName} · ${jd.title}`;
  return jd.title.toLowerCase().includes(level.toLowerCase()) ? base : `${base} (${level})`;
}

const hourLabel = (h: number) => `${String(h).padStart(2, "0")}:00`;

/** "Thu 1 Oct · 10:00" — the chosen slot, for the confirm button. */
function slotLabel(d: Date, h: number): string {
  const day = d.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });
  return `${day} · ${hourLabel(h)}`;
}

/** Chip styling shared by the day, time and round pickers: ink fill when chosen. */
function chipClass(selected: boolean) {
  return cn(
    "rounded-full border font-sans transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-40",
    selected
      ? "border-foreground bg-primary text-primary-foreground"
      : "border-line-3 bg-card text-foreground enabled:hover:border-faint-2",
  );
}

function FieldLabel({ children, hint, id }: { children: React.ReactNode; hint?: string; id?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span id={id} className="text-[13px] text-foreground">
        {children}
      </span>
      {hint ? <span className="text-xs text-faint">{hint}</span> : null}
    </div>
  );
}

export interface BookingFormProps {
  /** Pre-selects this JD once the role list has loaded — ignored if it isn't one of them. */
  initialJobDescriptionId?: string;
  /** Pre-selects this round (from the roadmap's "book this round" link). */
  initialRoundType?: RoundType;
}

/**
 * Books a mock interview, laid out like the design's schedule modal: role, an optional round, then
 * either "start now" or a day + time chosen from chip pickers. The backend assigns the round when
 * none is picked.
 */
export function BookingForm({ initialJobDescriptionId, initialRoundType }: BookingFormProps = {}) {
  const { data: jds, isLoading: jdsLoading } = useJds();
  const create = useCreateSession();

  const [mode, setMode] = useState<BookingMode>("now");
  const [jobDescriptionId, setJobDescriptionId] = useState(initialJobDescriptionId ?? "");
  const [roundType, setRoundType] = useState<RoundType | null>(initialRoundType ?? null);
  const [date, setDate] = useState<Date | undefined>(undefined);
  const [hour, setHour] = useState<number | null>(null);
  const [dateOpen, setDateOpen] = useState(false);

  // Only a JD that's really in the list counts — a stale or foreign `?jd=` is ignored.
  const selectedJd = (jds ?? []).find((jd) => jd.id === jobDescriptionId);
  const jdId = selectedJd?.id ?? "";

  const hourValid = hour !== null && !isPastSlot(date, hour);
  const canSubmit =
    mode === "now"
      ? Boolean(jdId) && !create.isPending
      : Boolean(jdId && date && hourValid) && !create.isPending;

  function reset() {
    setJobDescriptionId("");
    setRoundType(null);
    setDate(undefined);
    setHour(null);
  }

  function book(scheduledAt: string) {
    // The round is optional: without one the backend assigns it (currently the first round).
    const body: CreateInterviewSessionRequest = {
      jobDescriptionId: jdId,
      ...(roundType ? { roundType } : {}),
      scheduledAt,
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

  function submitNow() {
    book(new Date(Date.now() + START_NOW_BUFFER_MS).toISOString());
  }

  function submitSchedule() {
    if (!date || hour === null) return;
    const slot = new Date(date);
    slot.setHours(hour, 0, 0, 0);
    book(slot.toISOString());
  }

  // The schedule picker only renders after the user switches modes, so reading the clock and the
  // timezone here never runs during server rendering.
  const today = startOfToday();
  const days = Array.from({ length: DAY_CHIPS }, (_, i) => addDays(today, i));
  const laterDate = date && !days.some((d) => sameDay(date, d)) ? date : undefined;

  return (
    <section
      aria-labelledby="booking-title"
      className="flex min-w-0 flex-col gap-[18px] rounded-[16px] border border-line-2 bg-card p-5 sm:p-[26px]"
    >
      <div>
        <p className="iq-eyebrow m-0 truncate">
          {selectedJd ? `Book · ${selectedJd.companyName} · ${selectedJd.title}` : "Book a mock interview"}
        </p>
        <h2 id="booking-title" className="m-0 mt-1.5 text-[22px] font-normal leading-[1.15] tracking-[-0.03em]">
          {roundType ? roundLabel(roundType) : "Book an interview"}
        </h2>
      </div>

      <ToggleGroup
        type="single"
        value={mode}
        onValueChange={(value) => {
          if (value) setMode(value as BookingMode);
        }}
        aria-label="When"
        className="grid grid-cols-2 gap-[3px] rounded-full border border-line-3 p-[3px]"
      >
        <ToggleGroupItem
          value="now"
          className="h-8 rounded-full text-[13px] font-normal hover:bg-accent hover:text-foreground data-[state=on]:bg-primary data-[state=on]:text-primary-foreground"
        >
          Start now
        </ToggleGroupItem>
        <ToggleGroupItem
          value="schedule"
          className="h-8 rounded-full text-[13px] font-normal hover:bg-accent hover:text-foreground data-[state=on]:bg-primary data-[state=on]:text-primary-foreground"
        >
          Schedule for later
        </ToggleGroupItem>
      </ToggleGroup>

      <label className="flex flex-col gap-2">
        <FieldLabel>Role</FieldLabel>
        <select
          aria-label="Job description"
          className="h-10 w-full rounded-full border border-line-4 bg-card px-4 text-[13.5px] text-foreground transition-colors hover:border-faint-2 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          value={jdId}
          onChange={(e) => setJobDescriptionId(e.target.value)}
        >
          <option value="">{jdsLoading ? "Loading roles…" : "Select a role"}</option>
          {(jds ?? []).map((jd) => (
            <option key={jd.id} value={jd.id}>
              {jdOptionLabel(jd)}
            </option>
          ))}
        </select>
      </label>

      <div className="flex flex-col gap-2">
        <FieldLabel id="booking-round" hint="Optional · we pick if you skip">
          Round
        </FieldLabel>
        <div role="group" aria-labelledby="booking-round" className="flex flex-wrap gap-1.5">
          {ROUND_OPTIONS.map((r) => {
            const selected = roundType === r.value;
            return (
              <button
                key={r.value}
                type="button"
                aria-pressed={selected}
                onClick={() => setRoundType(selected ? null : r.value)}
                className={cn(chipClass(selected), "h-8 px-3 text-[12.5px]")}
              >
                {r.label}
              </button>
            );
          })}
        </div>
      </div>

      {mode === "schedule" ? (
        <>
          <div className="flex flex-col gap-2">
            <FieldLabel id="booking-day">Day</FieldLabel>
            <div role="group" aria-labelledby="booking-day" className="grid grid-cols-4 gap-1.5 sm:grid-cols-8">
              {days.map((d) => {
                const selected = sameDay(date, d);
                const noSlotsLeft = SLOT_HOURS.every((h) => isPastSlot(d, h));
                return (
                  <button
                    key={d.toDateString()}
                    type="button"
                    aria-pressed={selected}
                    aria-label={d.toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" })}
                    disabled={noSlotsLeft}
                    onClick={() => setDate(d)}
                    className={cn(chipClass(selected), "py-2")}
                  >
                    <span className="block text-[11px] uppercase opacity-70">
                      {d.toLocaleDateString(undefined, { weekday: "short" })}
                    </span>
                    <span className="block text-[17px] leading-tight tabular-nums">{d.getDate()}</span>
                  </button>
                );
              })}
              <Popover open={dateOpen} onOpenChange={setDateOpen}>
                <PopoverTrigger asChild>
                  <button
                    type="button"
                    aria-pressed={Boolean(laterDate)}
                    aria-label={
                      laterDate
                        ? `Later date: ${laterDate.toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" })}`
                        : "Pick a later date"
                    }
                    className={cn(chipClass(Boolean(laterDate)), "flex flex-col items-center justify-center py-2")}
                  >
                    <span className="block text-[11px] uppercase opacity-70">
                      {laterDate ? laterDate.toLocaleDateString(undefined, { month: "short" }) : "Later"}
                    </span>
                    {laterDate ? (
                      <span className="block text-[17px] leading-tight tabular-nums">{laterDate.getDate()}</span>
                    ) : (
                      <CalendarIcon aria-hidden className="mt-1 h-4 w-4" />
                    )}
                  </button>
                </PopoverTrigger>
                <PopoverContent align="end" className="w-auto p-0">
                  <Calendar
                    mode="single"
                    selected={date}
                    onSelect={(d) => {
                      setDate(d);
                      setDateOpen(false);
                    }}
                    disabled={{ before: today }}
                    autoFocus
                  />
                </PopoverContent>
              </Popover>
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <FieldLabel id="booking-time" hint={`Local time · ${Intl.DateTimeFormat().resolvedOptions().timeZone}`}>
              Time
            </FieldLabel>
            <div role="group" aria-labelledby="booking-time" className="grid grid-cols-5 gap-1.5">
              {SLOT_HOURS.map((h) => {
                const past = isPastSlot(date, h);
                const selected = hour === h && !past;
                return (
                  <button
                    key={h}
                    type="button"
                    aria-pressed={selected}
                    disabled={past}
                    onClick={() => setHour(h)}
                    className={cn(chipClass(selected), "h-[38px] font-mono text-[12.5px] tabular-nums")}
                  >
                    {hourLabel(h)}
                  </button>
                );
              })}
            </div>
          </div>
        </>
      ) : (
        <p className="m-0 text-[13px] leading-[1.5] text-muted-foreground">
          We start preparing your interviewer straight away. Join from Upcoming once it reads Ready.
        </p>
      )}

      <Button
        disabled={!canSubmit}
        onClick={mode === "now" ? submitNow : submitSchedule}
        className="h-[42px] w-full text-[13.5px]"
      >
        {create.isPending ? <Loader2 aria-hidden data-motion className="animate-spin" /> : null}
        {mode === "now"
          ? "Start now"
          : date && hour !== null && hourValid
            ? `Book ${slotLabel(date, hour)}`
            : "Book interview"}
      </Button>
    </section>
  );
}
