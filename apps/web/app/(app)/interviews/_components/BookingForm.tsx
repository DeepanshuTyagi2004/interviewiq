"use client";
import { isEngineeringLevel } from "@/lib/constants/engineering-levels";

import { useState } from "react";
import { CalendarIcon, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { InterviewAccessNote } from "@/components/auth/InterviewAccessNote";
import { Card } from "@/components/ds";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { CustomSelect } from "@/components/ui/custom-select";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useCurrentUser } from "@/lib/hooks/useCurrentUser";
import { cn } from "@/lib/utils/cn";
import { ROUND_OPTIONS } from "@/lib/constants/interview";
import { useJds, type JdSummary } from "@/features/jobs";
import { useLoops } from "@/features/loops";
import { useCreateSession, type CreateInterviewSessionRequest, type RoundType } from "@/features/interview";
import { levelLabel, roundLabel } from "@/features/interview/presentation";
import { bookingError } from "@/features/loops/errors";

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
/** 0 = one of the candidate's tracks, 1 = a researched role, 2 = a practice template. */
function rank(jd: JdSummary, trackJdIds: Set<string | null>): number {
  return trackJdIds.has(jd.id) ? 0 : jd.practiceTemplate ? 2 : 1;
}

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

/** Chip styling shared by the day, time and round pickers: ink fill when chosen, a ringed pill on the stone card otherwise. */
function chipClass(selected: boolean) {
  return cn(
    "rounded-full font-sans outline-none transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-stone disabled:cursor-not-allowed disabled:opacity-40",
    selected ? "bg-ink text-background" : "bg-background text-foreground shadow-ring enabled:hover:bg-surface",
  );
}

function FieldLabel({ children, hint, id }: { children: React.ReactNode; hint?: string; id?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span id={id} className="text-[13px] font-medium text-ink">
        {children}
      </span>
      {hint ? <span className="text-[12.5px] text-ink-3">{hint}</span> : null}
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
  const loops = useLoops();
  const create = useCreateSession();
  const { canInterview, interviewBlocked } = useCurrentUser();

  const [mode, setMode] = useState<BookingMode>("now");
  // Hundreds of practice templates would bury the researched roles: they are opt-in in the list.
  const [withTemplates, setWithTemplates] = useState(Boolean(initialJobDescriptionId));
  const [jobDescriptionId, setJobDescriptionId] = useState(initialJobDescriptionId ?? "");
  const [roundType, setRoundType] = useState<RoundType | null>(initialRoundType ?? null);
  const [date, setDate] = useState<Date | undefined>(undefined);
  const [hour, setHour] = useState<number | null>(null);
  const [dateOpen, setDateOpen] = useState(false);

  // Roles in the order a candidate reaches for them: their live tracks, researched roles, practice templates.
  const trackJdIds = new Set((loops.data ?? []).filter((l) => l.status === "active" && l.jdId).map((l) => l.jdId));
  const roleOptions = [...(jds ?? [])]
    .filter((jd) => withTemplates || !jd.practiceTemplate || trackJdIds.has(jd.id) || jd.id === jobDescriptionId)
    .sort((a, b) => rank(a, trackJdIds) - rank(b, trackJdIds) || a.companyName.localeCompare(b.companyName))
    .map((jd) => ({ value: jd.id, label: `${trackJdIds.has(jd.id) ? "Your track · " : ""}${jdOptionLabel(jd)}${jd.practiceTemplate ? " · Practice template" : ""}` }));

  // Only a JD that's really in the list counts — a stale or foreign `?jd=` is ignored.
  const selectedJd = (jds ?? []).find((jd) => jd.id === jobDescriptionId);
  const jdId = selectedJd && isEngineeringLevel(selectedJd.level) ? selectedJd.id : "";

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
    if (!jdId || !isEngineeringLevel(selectedJd?.level)) return;
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
      onError: (err) => toast.error(bookingError(err, "Couldn't book that interview. Please try again.")),
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
    <Card
      tone="stone"
      title="Book a round"
      meta={
        <span
          className="block truncate"
          title={selectedJd ? `${selectedJd.companyName} · ${selectedJd.title}` : undefined}
        >
          {selectedJd
            ? `${selectedJd.companyName} · ${selectedJd.title}${roundType ? ` · ${roundLabel(roundType)}` : ""}`
            : "Pick a role, then start now or choose a slot"}
        </span>
      }
      className="gap-[18px] p-5 sm:p-[26px]"
      headerClassName="mb-0"
    >

      <ToggleGroup
        type="single"
        value={mode}
        onValueChange={(value) => {
          if (value) setMode(value as BookingMode);
        }}
        aria-label="When"
        className="grid grid-cols-2 gap-[3px] rounded-full bg-background p-[3px] shadow-ring"
      >
        <ToggleGroupItem
          value="now"
          className="h-8 rounded-full text-[13px] font-medium hover:bg-surface-2 hover:text-ink data-[state=on]:bg-ink data-[state=on]:text-background"
        >
          Start now
        </ToggleGroupItem>
        <ToggleGroupItem
          value="schedule"
          className="h-8 rounded-full text-[13px] font-medium hover:bg-surface-2 hover:text-ink data-[state=on]:bg-ink data-[state=on]:text-background"
        >
          Schedule for later
        </ToggleGroupItem>
      </ToggleGroup>

      <label className="flex flex-col gap-2">
        <FieldLabel>Role</FieldLabel>
        <CustomSelect
          id="booking-job-description"
          label="Job description"
          className="h-10 w-full rounded-full bg-background px-4 text-[13.5px] text-foreground shadow-ring transition-colors duration-150 hover:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-stone"
          value={jdId}
          disabled={create.isPending || jdsLoading}
          onValueChange={setJobDescriptionId}
          options={[{ value: "", label: jdsLoading ? "Loading roles…" : "Select a role" }, ...roleOptions]}
        />
        <label className="flex w-fit max-w-full cursor-pointer items-start gap-2 text-[12.5px] leading-[1.45] text-ink-2">
          <Checkbox className="mt-px" checked={withTemplates} onCheckedChange={(v) => setWithTemplates(v === true)} />
          <span>Include practice templates (simulated processes that never count towards readiness)</span>
        </label>
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
                className={cn(chipClass(selected), "h-8 px-3.5 text-[12.5px] font-medium")}
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
                    <span className="block text-xs uppercase opacity-70">
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
                    <span className="block text-xs uppercase opacity-70">
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
                    className={cn(chipClass(selected), "h-[38px] text-[12.5px] tabular-nums")}
                  >
                    {hourLabel(h)}
                  </button>
                );
              })}
            </div>
          </div>
        </>
      ) : (
        <p className="m-0 text-[13px] leading-[1.5] text-ink-3">
          We start preparing your interviewer straight away. Join from Upcoming once it reads Ready.
        </p>
      )}

      {interviewBlocked ? <InterviewAccessNote /> : null}
      <Button
        disabled={!canSubmit || !canInterview}
        title={!interviewBlocked ? undefined : "Ask an admin for interview access"}
        onClick={mode === "now" ? submitNow : submitSchedule}
        size="lg" className="w-full text-[14px]"
      >
        {create.isPending ? <Loader2 aria-hidden data-motion className="animate-spin" /> : null}
        {mode === "now"
          ? "Start now"
          : date && hour !== null && hourValid
            ? `Book ${slotLabel(date, hour)}`
            : "Book interview"}
      </Button>
    </Card>
  );
}
