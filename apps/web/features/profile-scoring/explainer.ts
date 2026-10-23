/**
 * Plain-language copy for the "How your profile score works" page. Every statement restates the
 * beta v5 policy in `apps/api/docs/profile-scoring-v5.md`; nothing here changes a formula, weight
 * or threshold. If that policy changes, update this file with it.
 */

export interface PartGuide {
  /** The part's name as the score breakdown labels it. */
  title: string;
  /** What this part measures. */
  measures: string;
  /** Where the evidence comes from. */
  from: string;
  /** Concrete things that lift it, in order of usefulness. */
  lift: string[];
}

/** Keyed by the score breakdown's component id. */
export const PART_GUIDE: Record<string, PartGuide> = {
  problem_solving: {
    title: "DSA & problem solving",
    measures: "How hard, how broad and how recent your problem solving is.",
    from: "LeetCode, Codeforces, CodeChef, AtCoder and takeUforward. Each signal takes the best platform you have connected.",
    lift: [
      "Connect LeetCode, Codeforces or takeUforward: a second platform never lowers a strong one, but a missing one counts as 0.",
      "Solve medium and hard problems: those bands count for more than easy ones.",
      "Cover more topics, including advanced ones; breadth needs a reasonable number of solves before it shows.",
      "Solve a little every week: weekly consistency and recent solving both count.",
    ],
  },
  competitive_programming: {
    title: "Competitive programming",
    measures: "Contest rating and percentile, how your rating moves, how often you take part, and listed contest results.",
    from: "Contest data from your coding platforms, and contest results written on your resume.",
    lift: [
      "Take part in contests regularly: participation and recency both count.",
      "Connect the platform where you compete so your rating, percentile and history are read.",
      "List contest results with the year, round and rank on your resume (ICPC, Code Jam, Kick Start and similar).",
    ],
  },
  projects: {
    title: "Projects",
    measures: "Technical complexity, depth, originality, production readiness, engineering practices and impact of the projects you list.",
    from: "Your resume's projects, plus the README of a matching public GitHub repository.",
    lift: [
      "Describe what you built and the hard decisions in it, not just the stack.",
      "Say how it ran in real use: deployed, tested, with numbers (users, latency, scale).",
      "Connect GitHub so a project's README can be read. A README that is only a starter template is ignored.",
      "Your best project carries the score; a weak extra one never lowers it, but volume alone cannot reach 100.",
    ],
  },
  internship_experience: {
    title: "Internship experience",
    measures: "Technical depth, role relevance, ownership, production exposure, impact and duration of internships.",
    from: "Internships on your resume. Titles like intern, trainee, co-op and apprentice are read as internships.",
    lift: [
      "Write what you owned and shipped, not only the team or tools.",
      "Include dates; duration counts, with diminishing returns after the first months.",
      "Add the outcome and scale: what changed because of your work.",
    ],
  },
  professional_experience: {
    title: "Professional experience",
    measures: "Role relevance, technical depth, ownership, production exposure, scale and impact of your jobs, with tenure.",
    from: "Work experience on your resume. From SDE-1 up, internships also count here at a discount.",
    lift: [
      "Describe scope, ownership and measurable results for each role.",
      "Keep dates accurate; tenure counts, with diminishing returns.",
      "Name the production systems and scale you worked at.",
    ],
  },
  open_source: {
    title: "Open-source contribution",
    measures: "Merged pull requests to other people's public repositories: how many, how widely used the project is, how substantial the change is, how many projects, and how recent.",
    from: "GitHub, searched for pull requests you authored that were merged into repositories outside your own.",
    lift: [
      "Connect GitHub; without it this part counts as 0.",
      "One substantial merged change to a widely used project beats many tiny ones to small projects.",
      "Typo and formatting fixes do not count; a change needs at least about 10 lines or 2 files.",
      "Keep contributing: the score decays with a 365-day half-life from your latest merge.",
    ],
  },
  skills: {
    title: "Skills",
    measures: "How well the skills you list match the technology you actually use, and how wide your stack is.",
    from: "Your resume's skills, checked against GitHub languages and your project descriptions.",
    lift: [
      "List the skills you really use, and show them in projects and roles.",
      "Mention deployment, testing and measured results where they are true.",
    ],
  },
  achievements: {
    title: "Achievements",
    measures: "Hackathons, open-source programmes and other recognition, scaled by how selective the event is.",
    from: "Achievement lines on your resume.",
    lift: [
      "State the event, year, round and rank or outcome (finalist, winner, top 10%).",
      "Selective programmes such as GSoC, Outreachy and LFX count as completed once you were selected and finished.",
    ],
  },
  implementation: {
    title: "Delivered implementation",
    measures: "How well you build and deliver working software.",
    from: "Your resume's claims (40%) and the AI's reading of your projects and jobs (60%).",
    lift: [
      "Write specific, quoted-able sentences about what you built and how.",
      "Add detail to your best project or role: the AI reads what is written and cannot invent what is not.",
    ],
  },
  ownership: {
    title: "Engineering ownership",
    measures: "How much of the work you drove: decisions, delivery and follow-through.",
    from: "Your resume's claims (40%) and the AI's reading of your projects and jobs (60%).",
    lift: [
      "Use \"I led / designed / owned\" where it is true, and say what you were responsible for.",
      "Describe decisions you made and what happened after.",
    ],
  },
  impact: {
    title: "Measurable engineering impact",
    measures: "The size and significance of what your work changed.",
    from: "Your resume's claims (40%) and the AI's reading of your projects and jobs (60%).",
    lift: [
      "Quantify results: latency, cost, users, revenue, time saved.",
      "Say who benefited and how you know.",
    ],
  },
  architecture: {
    title: "Architecture and trade-offs",
    measures: "Design judgement: the options you weighed and why you chose what you did.",
    from: "Your resume's claims (40%) and the AI's reading of your projects and jobs (60%).",
    lift: [
      "Name the design, the alternatives you rejected and the trade-off.",
      "Mention scale limits, failure modes and how the design handled them.",
    ],
  },
  cross_team: {
    title: "Cross-team technical influence",
    measures: "Technical leadership and influence beyond your own team.",
    from: "Your resume's claims (40%) and the AI's reading of your experience (60%).",
    lift: ["Describe standards, reviews, mentoring or shared systems you led across teams."],
  },
  strategy: {
    title: "Organization-wide technical strategy",
    measures: "Setting technical direction for a large part of an organisation.",
    from: "Your resume's claims (40%) and the AI's reading of your experience (60%).",
    lift: ["Describe roadmaps, platform decisions or technical strategy you set and the outcome."],
  },
};

export interface LevelWeights {
  level: string;
  /** DSA + CP, Projects, Internships, Work experience, Engineering dimensions, Open source, Skills + achievements. */
  weights: [number, number, number, number, number, number, number];
}

export const WEIGHT_COLUMNS = ["DSA + contests", "Projects", "Internships", "Work experience", "Engineering scope", "Open source", "Skills + achievements"] as const;

/** The beta v5 weight table, as published in the scoring doc. Each row sums to 100. */
export const LEVEL_WEIGHTS: Record<string, [number, number, number, number, number, number, number]> = {
  intern: [19, 18, 8, 0, 26, 19, 10],
  fresher: [19, 17, 12, 3, 22, 18, 9],
  sde1: [16, 10, 4, 18, 31, 14, 7],
  sde2: [5, 4, 1, 24, 55, 10, 1],
  sde3: [3, 2, 0, 22, 63, 10, 0],
  staff: [2, 0, 0, 18, 70, 10, 0],
  principal: [2, 0, 0, 15, 72, 11, 0],
  distinguished: [2, 0, 0, 12, 74, 12, 0],
};

export const HOW_STEPS: { title: string; body: string }[] = [
  {
    title: "We read your sources",
    body: "Your resume and the sources you connect (GitHub, LeetCode, Codeforces, CodeChef, AtCoder, takeUforward) are read as they are. Whatever they say is taken as correct, so if something is wrong, fix it at the source.",
  },
  {
    title: "Each part gets a 0 to 100 part score",
    body: "Numbers such as solves, ratings, merged pull requests and tenure are read directly. Judgement calls, such as how complex a project is or how much you owned, are made by an AI that must quote your own words as evidence; a point it cannot quote is not counted.",
  },
  {
    title: "Parts are weighted for your level",
    body: "Each level has its own weights, and they add up to 100. A part's weight is how much a person at that level is expected to show in it.",
  },
  {
    title: "The score is a plain weighted sum",
    body: "Score = the sum of (weight × part score ÷ 100) over every part. A part with no evidence counts as 0, for any reason: nothing there, its assessment failed or it has not run yet.",
  },
  {
    title: "No score until a core part has evidence",
    body: "Core parts are the ones nothing else can stand in for at your level. Until at least one has evidence there is no score, not a zero.",
  },
];

export const RULES: { title: string; body: string }[] = [
  {
    title: "Your best platform counts",
    body: "The same signal from several platforms takes the best one. A second platform can corroborate but never add volume, and a weaker one never lowers a strong one. Not using every platform is never a penalty.",
  },
  {
    title: "Several items: the best leads",
    body: "With several projects or jobs, the best one carries the part and each further one adds a small, shrinking share. A weak extra item never lowers the score, and volume alone cannot reach 100.",
  },
  {
    title: "Recent evidence counts more",
    body: "Recent solving, contests and merged contributions weigh more than old ones. Competition results and achievements do not decay.",
  },
  {
    title: "Strong work at an unknown company still counts",
    body: "Company context is a small share of any part (at most 5%), so strong work at a small or unknown company beats weak work at a famous one.",
  },
  {
    title: "Unchanged items are not re-judged",
    body: "An unchanged project or job reuses its stored assessment. An edited one is re-assessed. If a fresh assessment fails, the older one is removed and the item counts as 0 until a call succeeds.",
  },
];

export const NOT_THIS: string[] = [
  "It is a provisional beta, not a validated hiring assessment.",
  "It is separate from your interview scores and from your readiness for any role.",
  "It is never compared across levels. If you opt in to the leaderboard, you are ranked only against others scored at the same level.",
  "A higher score is not an endorsement by, or eligibility for, any company.",
];

export const QUICK_WINS: { title: string; body: string; href: string; cta: string }[] = [
  {
    title: "Connect your sources",
    body: "A part with no evidence counts as 0. Resume, GitHub and a coding platform cover most of the weight at entry levels.",
    href: "/connections",
    cta: "Connect sources",
  },
  {
    title: "Make your resume specific",
    body: "Name what you built and owned, the decisions you made and measured results. The AI can only credit what is written.",
    href: "/profile",
    cta: "Edit your profile",
  },
  {
    title: "Check your level",
    body: "Weights depend on the level you choose. Pick the one that matches where you are now; a target role does not change it.",
    href: "/profile#profile-level",
    cta: "Edit your level",
  },
  {
    title: "Recalculate after a change",
    body: "Scores refresh weekly and after your sources change. You can also recalculate on demand.",
    href: "/profile/score#your-score",
    cta: "See your breakdown",
  },
];
