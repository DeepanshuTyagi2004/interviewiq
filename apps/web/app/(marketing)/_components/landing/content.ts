/**
 * Landing-page copy and illustration data — verbatim from the Claude Design file
 * (`InterviewIQ Landing Page/InterviewIQ Website v5.dc.html`, a local gitignored export). Keep edits here so the
 * section components stay presentational.
 */

export type ListItem = { icon: string; b: string; t: string };

/** Hero "connected sources" stack. */
export const SOURCE_STACK = [
  { icon: "CV", name: "Resume", detail: "B.Tech CSE · 2 internships · parsed" },
  { icon: "GH", name: "GitHub", detail: "order-tracking-svc · Go · Kafka" },
  { icon: "LC", name: "LeetCode", detail: "412 solved · weak: sliding window" },
  { icon: "IN", name: "LinkedIn", detail: "Backend intern · logistics startup" },
  { icon: "PF", name: "Portfolio", detail: "3 projects · 1 deployed API" },
] as const;

/** Companies in the live catalogue (apps/api/scripts/catalogue): only names a user can actually pick. */
export const COMPANIES = ["Google", "Amazon", "Microsoft", "Razorpay", "Swiggy", "CRED", "Zerodha", "Infosys"];

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
  { icon: "compass", b: "Real interview stories", t: "from candidates, by country, level and role" },
  { icon: "route", b: "Every round mapped", t: "with its topics, difficulty and interviewer style" },
  { icon: "link", b: "Sources shown", t: "so you know how much data is behind each page" },
];

export const LIST_INTERVIEW: ListItem[] = [
  { icon: "mic", b: "Spoken, like the real thing", t: "and built on your own resume and projects" },
  { icon: "code", b: "Code editor and whiteboard", t: "that the interviewer follows as you work" },
  { icon: "refresh", b: "Adjusts to you", t: "with hints when you're stuck and harder questions when you're not" },
];

export const LIST_DEBRIEF: ListItem[] = [
  { icon: "list", b: "Question by question", t: "your answer next to a strong one" },
  { icon: "gauge", b: "How you said it", t: "including clarity, hesitation and filler words" },
  { icon: "unlock", b: "Pass to unlock", t: "the next round, or retake after 1–2 weeks" },
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
  { key: "research", title: "1. Learn the process", body: "See the company’s real interview for your role, round by round.", tags: ["Rounds", "Difficulty", "Red flags"] },
  { key: "interview", title: "2. Practise out loud", body: "A spoken mock round with an AI interviewer that knows your background.", tags: ["Voice", "Code", "Whiteboard"] },
  { key: "debrief", title: "3. Get feedback", body: "Your score, strong answers and what to study next.", tags: ["Breakdown", "Signals", "Learn next"] },
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

export const UNIVERSITY_POINTS: [title: string, body: string][] = [
  ["Batch readiness at a glance", "See every student’s readiness level for the companies coming to campus, and where the batch needs help."],
  ["Aligned to your placement calendar", "Prioritise the processes of the companies visiting this season."],
  ["Fair and proctored", "Pass marks, cooldowns and full-screen proctoring mean readiness reflects real preparation."],
  ["Onboarding in a week", "Students sign up in one click with their resume. We handle the rest."],
];

export const PERSONAS = [
  { role: "STUDENTS", mono: "ST", who: "Campus placements", body: "Rehearse the exact process of the companies coming to your campus.", status: "AVAILABLE NOW", featured: true },
  { role: "PLACEMENT CELLS", mono: "TPO", who: "Universities", body: "Unlimited realistic practice for the whole batch, with readiness at a glance.", status: "PILOT · FALL 2026", featured: false },
  { role: "PROFESSIONALS", mono: "PR", who: "Job switchers", body: "Focused, company-specific mock interviews that fit a working week.", status: "AVAILABLE NOW", featured: false },
];

export const FAQS: [q: string, a: string][] = [
  ["Is it free?", "Yes. It's free while we're in beta, and nothing needs a card. When paid plans arrive, the pricing page will show them first."],
  ["Can I take a mock interview right away?", "Interviews are opening in stages during the beta. Everyone can build a profile and explore every company's process today; if your account doesn't have interview access yet, request it from the contact page."],
  ["What do I need to start?", "Just your resume, or fill in your profile by hand. GitHub, LeetCode and other coding profiles are optional extras."],
  ["How long is a round?", "30 to 45 minutes. You speak out loud, and use a code editor or whiteboard when the round needs one."],
  ["Which companies can I practise for?", "Every company in the library, with new ones added all the time. Each company page shows how much data is behind it."],
  ["What happens if I don’t pass a round?", "You get the full debrief, then retake after 1–2 weeks — enough time to act on the feedback."],
  ["Can I change the rounds?", "Yes. Edited rounds become standalone practice with full analysis, but don’t count towards readiness."],
  ["Do I need GitHub or LeetCode?", "No. A resume is enough to start; connected sources just give the interviewer more of your own work to ask about."],
  ["How is it proctored?", "Interviews run full-screen. Leaving full-screen or switching tabs pauses the round until you return."],
  ["Is interview-ready a certification?", "No. It shows readiness from mock interviews on InterviewIQ. It is never a certification or an endorsement by the company."],
];
