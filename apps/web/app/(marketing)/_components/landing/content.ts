/**
 * Landing-page copy and illustration data — verbatim from the Claude Design file
 * (`InterviewIQ Landing Page/InterviewIQ Website v5.dc.html`). Keep edits here so the
 * section components stay presentational.
 */

export type ListItem = { icon: string; b: string; t: string };

/** Hero "connected sources" stack. */
export const SOURCE_STACK = [
  { icon: "CV", name: "Résumé", detail: "B.Tech CSE · 2 internships · parsed" },
  { icon: "GH", name: "GitHub", detail: "order-tracking-svc · Go · Kafka" },
  { icon: "LC", name: "LeetCode", detail: "412 solved · weak: sliding window" },
  { icon: "IN", name: "LinkedIn", detail: "Backend intern · logistics startup" },
  { icon: "PF", name: "Portfolio", detail: "3 projects · 1 deployed API" },
] as const;

export const COMPANIES = ["Meesho", "Flipkart", "Razorpay", "Swiggy", "CRED", "PhonePe", "Zepto", "Groww"];

/** Where the research engine reads interview experiences from. */
export const RESEARCH_SOURCES = ["r/", "LC", "GD", "YT"];

export type RoundState = "passed" | "next" | "locked";
export const RESEARCH_ROUNDS: { n: string; title: string; status: string; state: RoundState }[] = [
  { n: "01", title: "Online Assessment", status: "PASSED", state: "passed" },
  { n: "02", title: "Problem Solving", status: "OCT 04", state: "next" },
  { n: "03", title: "System Design (LLD)", status: "LOCKED", state: "locked" },
  { n: "04", title: "Hiring Manager", status: "LOCKED", state: "locked" },
];

export const LIST_RESEARCH: ListItem[] = [
  { icon: "◎", b: "Company research", t: "from experiences candidates share, filtered by country, level and role" },
  { icon: "↳", b: "Round-by-round roadmaps", t: "with topics, difficulty and interviewer style" },
  { icon: "⌘", b: "Source-linked insights", t: "so you know how much data is behind every page" },
];

export const LIST_INTERVIEW: ListItem[] = [
  { icon: "◐", b: "Voice interviewer", t: "that builds on your own résumé and projects" },
  { icon: "⌗", b: "Code editor and whiteboard", t: "read live as you work" },
  { icon: "↻", b: "Adaptive difficulty", t: "— hints when stuck, harder follow-ups when flying" },
];

export const LIST_DEBRIEF: ListItem[] = [
  { icon: "±", b: "Question breakdown", t: "with what you said next to a strong answer" },
  { icon: "◇", b: "Eight live signals", t: "including clarity, hesitation and filler words" },
  { icon: "→", b: "Pass to unlock", t: "the next round, or retake after 1–2 weeks" },
];

export const INTERVIEW_QUESTION = "“Three pods, 50k requests a second. Where does the rate-limit state live?”";
export const INTERVIEW_ANSWER =
  "Move it to a shared store like Redis — INCR the key with a TTL per window, so every pod sees the same count.";

/** Live signal tiles; values jitter a little each second in the demo. */
export const SIGNALS: [label: string, base: number][] = [
  ["Correct", 82],
  ["Approach", 76],
  ["Clarity", 88],
  ["Fillers", 38],
];

export type DiffKind = "ctx" | "del" | "add";
export const DEBRIEF_DIFF: [sign: string, text: string, kind: DiffKind][] = [
  [" ", "Q3 · Where does the state live?", "ctx"],
  ["−", "Keep the deque on each server…", "del"],
  ["−", "…and maybe sync them periodically?", "del"],
  ["+", "Move state to a shared store (Redis).", "add"],
  ["+", "INCR the key, EXPIRE with the window TTL.", "add"],
  ["+", "Call out: one network hop vs. correctness.", "add"],
  [" ", "Note: strong recovery after the hint.", "ctx"],
];

export const LEARN_NEXT = ["Distributed counters", "Token bucket", "Thinking aloud"];

export const LAYERS = [
  { key: "research", title: "Research", body: "The company’s real process for your role, round by round.", tags: ["Rounds", "Difficulty", "Red flags"] },
  { key: "interview", title: "Interview", body: "A spoken, proctored round that builds on your background.", tags: ["Voice", "Code", "Whiteboard"] },
  { key: "debrief", title: "Debrief", body: "Scores, strong answers and what to study next.", tags: ["Breakdown", "Signals", "Learn next"] },
] as const;

export const WEEKS = ["SEP 01", "SEP 08", "SEP 15", "SEP 22", "SEP 29", "OCT 06", "OCT 13", "OCT 20"];
/** Index of the current week in {@link WEEKS} — the vertical "today" line sits on it. */
export const CURRENT_WEEK = 5;

export type TrackTone = "ink" | "soft" | "panel" | "custom";
export const TRACKS: { role: string; level: string; left: string; width: string; done: number; label: string; tone: TrackTone }[] = [
  { role: "Meesho · SDE I", level: "Nearly ready", left: "2%", width: "70%", done: 3, label: "3 / 4", tone: "ink" },
  { role: "Flipkart · SDE I", level: "Progressing", left: "20%", width: "56%", done: 2, label: "2 / 5", tone: "soft" },
  { role: "Razorpay · Backend", level: "Getting started", left: "44%", width: "46%", done: 1, label: "0 / 4", tone: "panel" },
  { role: "Practice · DSA", level: "Doesn’t count", left: "8%", width: "84%", done: 0, label: "Custom", tone: "custom" },
];

export const FEATURES = [
  { icon: "◎", title: "Built on the real process", body: "Rounds, topics and difficulty researched from real candidate experiences." },
  { icon: "◐", title: "Personal by default", body: "Questions come from your résumé and projects — nothing to memorise." },
  { icon: "↻", title: "Adapts in real time", body: "Hints, harder follow-ups and course-correction, like a real interviewer." },
  { icon: "◇", title: "Readiness you can trust", body: "Pass marks, cooldowns and proctoring make every level mean something." },
];

export const UNIVERSITY_POINTS: [title: string, body: string][] = [
  ["Batch readiness at a glance", "See every student’s readiness level for the companies coming to campus, and where the batch needs help."],
  ["Aligned to your placement calendar", "Prioritise the processes of the companies visiting this season."],
  ["Fair and proctored", "Pass marks, cooldowns and full-screen proctoring mean readiness reflects real preparation."],
  ["Onboarding in a week", "Students sign up in one click with their résumé. We handle the rest."],
];

export const PERSONAS = [
  { role: "STUDENTS", mono: "ST", who: "Campus placements", body: "Rehearse the exact process of the companies coming to your campus.", status: "AVAILABLE NOW", featured: true },
  { role: "PLACEMENT CELLS", mono: "TPO", who: "Universities", body: "Unlimited realistic practice for the whole batch, with readiness at a glance.", status: "PILOT · FALL 2026", featured: false },
  { role: "PROFESSIONALS", mono: "PR", who: "Job switchers", body: "Focused, company-specific mock interviews that fit a working week.", status: "COMING SOON", featured: false },
  { role: "COMPANIES", mono: "CO", who: "Hiring teams", body: "A shortlist of candidates who have already cleared your process.", status: "LATER", featured: false },
  { role: "BOOTCAMPS", mono: "BC", who: "Training partners", body: "Give learners real interview rehearsal at the end of every track.", status: "LATER", featured: false },
];

export const FAQS: [q: string, a: string][] = [
  ["Is interview-ready a certification?", "No. It is always shown as readiness from mock interviews on InterviewIQ — never a certification or an endorsement by the company."],
  ["Which companies can I practise for?", "We launched with Meesho, and the research engine is building more companies and roles continuously. Each company page shows how much data is behind it."],
  ["What happens if I don’t pass a round?", "You get the full debrief, then retake after 1–2 weeks — enough time to act on the feedback."],
  ["Can I change the rounds?", "Yes. Edited rounds become standalone practice with full analysis, but don’t count towards readiness."],
  ["Do I need GitHub or LeetCode?", "No. A résumé is enough to start; connected sources just give the interviewer more of your own work to ask about."],
  ["How is it proctored?", "Interviews run full-screen. Leaving full-screen or switching tabs pauses the round until you return."],
];
