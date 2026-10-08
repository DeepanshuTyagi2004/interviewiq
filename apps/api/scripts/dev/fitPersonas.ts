/**
 * Fabricated but realistic engineer profiles for probing JD fit (dev databases only). Three or four
 * per engineering level, with different competencies, sources and strengths, so the score can be
 * checked for fairness across every JD. Seeded by `seed-fit-personas.ts`, scored by
 * `audit-fit-personas.ts`. Nothing here is a real person.
 */
import type { EngineeringLevel } from "../../src/domain/engineeringLevels.js";
import type { EducationDto, ExperienceDto, ProjectDto } from "../../src/domain/candidateProfile.js";

export const PERSONA_EMAIL_DOMAIN = "persona.interviewiq.test";
/** Dev-only; every persona shares it. */
export const PERSONA_PASSWORD = "Persona#2026";

export interface PersonaGitHub {
  login: string;
  joinedYear: number;
  /** [language, byte share %]; bytes are derived. */
  languages: [string, number][];
  repos: { name: string; stars: number; primaryLang: string; description: string; readme?: string }[];
  /** Merged PRs to repositories the persona does not own. */
  mergedPRs?: { repo: string; stars: number; additions: number; deletions: number; changedFiles: number; title: string; mergedAt: string; docsOnly?: boolean }[];
  /** Contributions in the last year; drives the fake calendar. */
  activity: "low" | "medium" | "high";
}

export interface PersonaLeetCode {
  username: string;
  solved: [easy: number, medium: number, hard: number];
  /** LeetCode's tag names → solved count. */
  topics: Record<string, number>;
  contest?: { attended: number; rating: number; topPercent: number };
  preferredLanguage: string;
  last30Days: number;
}

export interface PersonaCodeforces {
  handle: string;
  rating: number;
  maxRating: number;
  contests: number;
  solved: [easy: number, medium: number, hard: number];
  /** Codeforces tags → solved count. */
  topics: Record<string, number>;
  last30Days: number;
}

export interface FitPersona {
  slug: string;
  name: string;
  level: EngineeringLevel;
  /** What this persona is built to probe; shown in the audit, never stored. */
  probe: string;
  /** The template specialization this persona should fit best at its own level, if any. */
  expectedSpecialization: "backend" | "frontend" | "fullstack" | "data-science" | "ai-ml" | "devops" | null;
  /** Catalogue sectors this persona's work is in (for the domain checks). */
  expectedDomains: string[];
  /** Strength rank within the level (1 = strongest); used by the pairwise fairness check. */
  tier: 1 | 2 | 3;
  headline: string;
  location: string;
  education: EducationDto[];
  experience: ExperienceDto[];
  projects: ProjectDto[];
  skills: string[];
  achievements: string[];
  github?: PersonaGitHub;
  leetcode?: PersonaLeetCode;
  codeforces?: PersonaCodeforces;
}

export const personaEmail = (p: Pick<FitPersona, "slug">): string => `${p.slug}@${PERSONA_EMAIL_DOMAIN}`;

const edu = (institution: string, degree: string, field: string, startYear: number, endYear: number, grade: string | null): EducationDto =>
  ({ institution, degree, field, startYear: String(startYear), endYear: String(endYear), grade });
const job = (company: string, title: string, startDate: string, endDate: string, location: string, bullets: string[]): ExperienceDto =>
  ({ company, title, startDate, endDate, location, bullets });
const project = (name: string, description: string, tech: string[], bullets: string[], link: string | null = null): ProjectDto =>
  ({ name, description, tech, bullets, link });

export const FIT_PERSONAS: FitPersona[] = [
  // ------------------------------------------------------------------ intern (third/fourth-year students)
  {
    slug: "aarav-mehta", name: "Aarav Mehta", level: "intern", tier: 1,
    probe: "Strong intern: heavy LeetCode, MERN project, one summer internship",
    expectedSpecialization: "backend", expectedDomains: [],
    headline: "Final-year CSE student · competitive programmer · backend",
    location: "Vellore, Tamil Nadu",
    education: [edu("Vellore Institute of Technology, Vellore", "B.Tech", "Computer Science and Engineering", 2023, 2027, "8.62 CGPA")],
    experience: [
      job("Zomato", "Software Engineering Intern", "2026-05", "2026-07", "Gurugram", [
        "Added retry and dead-letter handling to the restaurant menu-sync worker (Go, Kafka), cutting failed syncs by 18% over two weeks",
        "Wrote integration tests with Testcontainers for the menu service's PostgreSQL repository layer",
        "Profiled a slow nightly job and removed an N+1 query, bringing the run from 42 minutes to 9",
      ]),
    ],
    projects: [
      project("CampusCab", "Carpool matching for VIT students: post a ride, match by route and time, chat in-app.", ["React", "Node.js", "Express", "MongoDB", "Socket.IO"], [
        "Built REST APIs with Express and MongoDB; JWT auth and rate limiting",
        "Deployed on Render with GitHub Actions CI; 600+ sign-ups during a campus fest",
      ], "https://github.com/aaravm/campuscab"),
      project("cp-templates", "My competitive programming library: segment tree, DSU, Dijkstra, KMP, with stress tests.", ["C++"], [
        "Used in 25+ rated contests; stress-test harness compares against brute force",
      ], "https://github.com/aaravm/cp-templates"),
    ],
    skills: ["C++", "Java", "JavaScript", "React", "Node.js", "Express", "MongoDB", "MySQL", "Git", "Docker", "Linux"],
    achievements: ["Rank 412 in LeetCode Weekly Contest 452", "Finalist, Smart India Hackathon 2025 (software edition)", "Knight on LeetCode (rating 1742)"],
    github: {
      login: "aaravm", joinedYear: 2023, activity: "high",
      languages: [["C++", 55], ["JavaScript", 25], ["Python", 14], ["HTML", 4], ["Shell", 2]],
      repos: [
        { name: "campuscab", stars: 23, primaryLang: "JavaScript", description: "Carpool matching for VIT students (MERN)", readme: "CampusCab matches students going the same way at the same time. The backend is an Express API over MongoDB with JWT auth, rate limiting and Socket.IO chat; the React client is a PWA. Run with docker compose up; tests use Jest and Testcontainers." },
        { name: "cp-templates", stars: 41, primaryLang: "C++", description: "Competitive programming templates with stress tests", readme: "Segment tree with lazy propagation, DSU with rollback, Dijkstra and 0-1 BFS, KMP and Z-function, modular arithmetic. Every template has a brute-force stress test under tests/." },
      ],
    },
    leetcode: {
      username: "aaravm", solved: [210, 290, 40], preferredLanguage: "cpp", last30Days: 34,
      contest: { attended: 28, rating: 1742, topPercent: 11.8 },
      topics: { "Array": 240, "String": 130, "Hash Table": 150, "Dynamic Programming": 95, "Math": 80, "Sorting": 90, "Greedy": 60, "Depth-First Search": 55, "Binary Search": 60, "Tree": 70, "Binary Tree": 62, "Matrix": 30, "Two Pointers": 50, "Bit Manipulation": 20, "Heap (Priority Queue)": 25, "Stack": 40, "Graph": 55, "Prefix Sum": 28, "Sliding Window": 35, "Backtracking": 30, "Linked List": 35, "Trie": 8, "Union Find": 12, "Monotonic Stack": 14, "Breadth-First Search": 40, "Recursion": 22 },
    },
  },
  {
    slug: "devika-nair", name: "Devika Nair", level: "intern", tier: 1,
    probe: "Competitive programmer (Codeforces Expert), thin projects, no internship",
    expectedSpecialization: "backend", expectedDomains: [],
    headline: "Pre-final year, IIIT Allahabad · Codeforces Expert",
    location: "Prayagraj, Uttar Pradesh",
    education: [edu("Indian Institute of Information Technology, Allahabad", "B.Tech", "Information Technology", 2023, 2027, "9.1 CGPA")],
    experience: [],
    projects: [
      project("MiniJudge", "A small online judge for the college coding club with sandboxed submissions.", ["Python", "Flask", "Docker", "PostgreSQL"], [
        "Runs submissions in Docker containers with CPU and memory limits; 300+ users during the intra-college contest",
        "Problem setters upload tests through a Flask admin; verdicts stream back over server-sent events",
      ], "https://github.com/devika-n/minijudge"),
    ],
    skills: ["C++", "Python", "Flask", "Docker", "Linux", "Git", "Data Structures", "Algorithms"],
    achievements: ["ICPC Amritapuri Regionals 2025 — rank 38", "Codeforces Expert (max rating 1655)", "Google Kickstart Round F 2025 — top 5%"],
    github: {
      login: "devika-n", joinedYear: 2024, activity: "medium",
      languages: [["C++", 88], ["Python", 10], ["Dockerfile", 2]],
      repos: [
        { name: "minijudge", stars: 17, primaryLang: "Python", description: "Sandboxed online judge for the coding club", readme: "MiniJudge runs C++, Python and Java submissions inside short-lived Docker containers with ulimit-based CPU and memory caps. Flask serves the problem set and admin; PostgreSQL stores submissions; verdicts stream over SSE." },
        { name: "algo-notes", stars: 9, primaryLang: "C++", description: "Notes and implementations from contest practice", readme: "Working notes on segment trees, lazy propagation, centroid decomposition, Mo's algorithm and FFT, each with a tested implementation and the problems it solved." },
      ],
    },
    leetcode: {
      username: "devika_n", solved: [60, 85, 15], preferredLanguage: "cpp", last30Days: 6,
      contest: { attended: 15, rating: 1890, topPercent: 6.2 },
      topics: { "Array": 70, "Dynamic Programming": 40, "Math": 35, "Greedy": 30, "Graph": 25, "Tree": 20, "String": 28, "Hash Table": 32, "Binary Search": 22, "Bit Manipulation": 10 },
    },
    codeforces: {
      handle: "devika_n", rating: 1612, maxRating: 1655, contests: 71, solved: [520, 480, 180], last30Days: 41,
      topics: { "implementation": 420, "math": 310, "greedy": 280, "dp": 190, "data structures": 170, "brute force": 160, "constructive algorithms": 140, "graphs": 120, "sortings": 110, "binary search": 95, "dfs and similar": 90, "strings": 85, "number theory": 70, "trees": 60, "two pointers": 45, "combinatorics": 40, "bitmasks": 30, "dsu": 25, "shortest paths": 20, "hashing": 12 },
    },
  },
  {
    slug: "rohit-yadav", name: "Rohit Kumar Yadav", level: "intern", tier: 3,
    probe: "Thin tier-3 student: resume only, no platforms connected, listed skills",
    expectedSpecialization: null, expectedDomains: [],
    headline: "B.Tech CSE student looking for an internship",
    location: "Greater Noida, Uttar Pradesh",
    education: [edu("Galgotias College of Engineering and Technology, Greater Noida", "B.Tech", "Computer Science and Engineering", 2023, 2027, "7.4 CGPA")],
    experience: [],
    projects: [
      project("Hostel Mess Feedback App", "Android app for students to rate daily mess meals and for the warden to see weekly reports.", ["Java", "Android Studio", "Firebase"], [
        "Login with Firebase Auth, feedback stored in Firestore, weekly bar chart with MPAndroidChart",
      ]),
      project("College Event Portal", "Website to list college events and register for them.", ["PHP", "MySQL", "HTML", "CSS", "Bootstrap"], [
        "Admin panel to add events; students register and get a confirmation email",
      ]),
    ],
    skills: ["C", "Java", "Python", "HTML", "CSS", "JavaScript", "PHP", "MySQL", "Android Studio", "Firebase", "MS Office"],
    achievements: ["NPTEL Data Structures and Algorithms — Elite certificate", "HackerRank 5-star in Problem Solving"],
  },
  {
    slug: "sneha-pillai", name: "Sneha Pillai", level: "intern", tier: 2,
    probe: "ML/data student: PyTorch projects, Kaggle, light LeetCode",
    expectedSpecialization: "ai-ml", expectedDomains: [],
    headline: "B.Tech CSE (AI & ML) · Kaggle Expert",
    location: "Chennai, Tamil Nadu",
    education: [edu("SRM Institute of Science and Technology, Kattankulathur", "B.Tech", "Computer Science (AI and Machine Learning)", 2023, 2027, "8.9 CGPA")],
    experience: [
      job("Tredence Analytics", "Machine Learning Intern", "2026-06", "2026-07", "Chennai", [
        "Built a demand-forecasting baseline (LightGBM) for a retail client's weekly SKU sales; MAPE 14% vs 21% for the existing moving average",
        "Wrote feature pipelines in pandas and documented leakage checks for the train/validation split",
      ]),
    ],
    projects: [
      project("Crop disease classifier", "Fine-tuned ResNet-18 on PlantVillage to classify leaf diseases from phone photos.", ["Python", "PyTorch", "OpenCV", "Streamlit"], [
        "94.1% test accuracy across 38 classes; Grad-CAM visualisations for explanations",
        "Streamlit demo deployed on Hugging Face Spaces",
      ], "https://github.com/snehapillai/crop-disease"),
      project("IPL score predictor", "Predicts first-innings totals from ball-by-ball data.", ["Python", "pandas", "scikit-learn", "Streamlit"], [
        "Gradient boosting with venue, overs and wickets features; R² 0.81 on 2023–24 seasons",
      ]),
    ],
    skills: ["Python", "PyTorch", "scikit-learn", "pandas", "NumPy", "SQL", "Streamlit", "OpenCV", "Matplotlib", "Git"],
    achievements: ["Kaggle Expert — top 8% in Playground Series S4E7", "Winner, SRM Datathon 2025"],
    github: {
      login: "snehapillai", joinedYear: 2024, activity: "medium",
      languages: [["Jupyter Notebook", 58], ["Python", 39], ["HTML", 3]],
      repos: [
        { name: "crop-disease", stars: 31, primaryLang: "Jupyter Notebook", description: "ResNet-18 leaf disease classifier with Grad-CAM", readme: "Fine-tunes torchvision's ResNet-18 on PlantVillage (38 classes). Training notebook, evaluation with confusion matrix and Grad-CAM, and a Streamlit app for phone photos. 94.1% test accuracy." },
        { name: "ipl-score-predictor", stars: 6, primaryLang: "Python", description: "First-innings total prediction from ball-by-ball data", readme: "Feature engineering on Cricsheet ball-by-ball files (venue, overs left, wickets, run rate) and a gradient boosting regressor. Streamlit UI to try match states." },
      ],
    },
    leetcode: {
      username: "sneha_pillai", solved: [80, 42, 3], preferredLanguage: "python3", last30Days: 9,
      topics: { "Array": 55, "String": 30, "Hash Table": 35, "Math": 20, "Sorting": 25, "Two Pointers": 12, "Dynamic Programming": 10, "Tree": 8, "Binary Search": 9, "Stack": 7 },
    },
  },

  // ------------------------------------------------------------------ fresher (2026 graduates)
  {
    slug: "pranav-deshpande", name: "Pranav Deshpande", level: "fresher", tier: 1,
    probe: "Strong backend/fintech fresher: Razorpay internship, Spring Boot + Kafka projects, Knight on LeetCode, OSS PR",
    expectedSpecialization: "backend", expectedDomains: ["fintech"],
    headline: "NIT Trichy '26 · backend · payments",
    location: "Pune, Maharashtra",
    education: [edu("National Institute of Technology, Tiruchirappalli", "B.Tech", "Computer Science and Engineering", 2022, 2026, "8.71 CGPA")],
    experience: [
      job("Razorpay", "Software Engineer Intern", "2025-05", "2025-07", "Bengaluru", [
        "Built the retry scheduler for payout webhooks in Go: exponential backoff with jitter and idempotency keys, delivering 99.6% of webhooks within 60 s",
        "Added Prometheus metrics and a Grafana dashboard for webhook latency and failure reasons",
      ]),
      job("Groww", "SDE Intern", "2026-01", "2026-03", "Bengaluru", [
        "Implemented SIP order deduplication in the mutual-fund order service (Java, Spring Boot, MySQL) to stop double orders on client retries",
      ]),
    ],
    projects: [
      project("Ledgerly", "Double-entry ledger service with idempotent APIs, built like a small payments core.", ["Java", "Spring Boot", "PostgreSQL", "Kafka", "Docker"], [
        "Append-only journal with balance snapshots; idempotency keys on every write; outbox pattern publishing to Kafka",
        "Load-tested to 1,200 postings/s on a laptop with k6; 180 unit and integration tests",
      ], "https://github.com/pranavd/ledgerly"),
      project("upi-qr", "CLI and library that generates and validates UPI payment QR codes.", ["Go"], ["Implements the NPCI UPI deep-link spec; published as a Go module"], "https://github.com/pranavd/upi-qr"),
    ],
    skills: ["Java", "Spring Boot", "Go", "PostgreSQL", "MySQL", "Kafka", "Redis", "Docker", "Kubernetes", "AWS", "Git"],
    achievements: ["Knight on LeetCode (rating 1688)", "Winner, Razorpay intern hackathon 2025", "Rank 2, NIT Trichy Pragyan CTF 2024"],
    github: {
      login: "pranavd", joinedYear: 2022, activity: "high",
      languages: [["Java", 48], ["Go", 30], ["TypeScript", 12], ["HTML", 5], ["Shell", 4], ["Dockerfile", 1]],
      repos: [
        { name: "ledgerly", stars: 58, primaryLang: "Java", description: "Double-entry ledger service with idempotent APIs (Spring Boot, PostgreSQL, Kafka)", readme: "Ledgerly is a double-entry ledger: accounts, journal entries and postings with an append-only journal and periodic balance snapshots. Every write takes an idempotency key. Events go out through a transactional outbox to Kafka. Spring Boot 3, PostgreSQL 16, Testcontainers." },
        { name: "upi-qr", stars: 12, primaryLang: "Go", description: "UPI payment QR generation and validation", readme: "Generates UPI deep links and QR codes per the NPCI specification (pa, pn, am, tn, tr fields), validates incoming links, and exposes a small CLI. No external dependencies beyond the QR encoder." },
      ],
      mergedPRs: [{ repo: "redis/jedis", stars: 12_000, additions: 64, deletions: 9, changedFiles: 3, title: "Fix NullPointerException in cluster pipeline when a slot is migrating", mergedAt: "2026-02-14T10:12:00.000Z" }],
    },
    leetcode: {
      username: "pranavd", solved: [160, 240, 30], preferredLanguage: "java", last30Days: 18,
      contest: { attended: 22, rating: 1688, topPercent: 14.5 },
      topics: { "Array": 190, "Hash Table": 120, "String": 100, "Dynamic Programming": 70, "Tree": 65, "Binary Tree": 58, "Graph": 40, "Binary Search": 45, "Two Pointers": 40, "Stack": 35, "Heap (Priority Queue)": 20, "Greedy": 50, "Linked List": 30, "Sliding Window": 25, "Backtracking": 20, "Trie": 6, "Math": 60, "Sorting": 70, "Depth-First Search": 45, "Breadth-First Search": 30, "Matrix": 22, "Prefix Sum": 18, "Bit Manipulation": 12 },
    },
  },
  {
    slug: "ananya-krishnan", name: "Ananya Krishnan", level: "fresher", tier: 1,
    probe: "Frontend fresher: design-system OSS, Next.js PWA, Freshworks internship, modest LeetCode",
    expectedSpecialization: "frontend", expectedDomains: ["e-commerce", "saas"],
    headline: "Frontend engineer · React, TypeScript, design systems",
    location: "Chennai, Tamil Nadu",
    education: [edu("College of Engineering, Guindy (Anna University)", "B.E.", "Information Technology", 2022, 2026, "8.4 CGPA")],
    experience: [
      job("Freshworks", "Frontend Engineering Intern", "2025-06", "2025-08", "Chennai", [
        "Migrated four Freshdesk ticket-list widgets from Ember to React with TypeScript on Freshdesk, a customer-support SaaS used by 60k businesses",
        "Fixed keyboard navigation and ARIA roles in the ticket sidebar; WCAG 2.1 AA checks pass in axe",
      ]),
    ],
    projects: [
      project("leaf-ui", "A small open-source React component library with Storybook docs and a token-based theme.", ["React", "TypeScript", "Storybook", "Tailwind CSS"], [
        "28 components, dark mode, 60 GitHub stars; published to npm with changesets",
      ], "https://github.com/ananyak/leaf-ui"),
      project("QuickBasket", "Grocery ordering PWA with a cart and checkout flow, offline product browsing and order tracking.", ["Next.js", "TypeScript", "Tailwind CSS", "Supabase"], [
        "Lighthouse 97 performance; optimistic cart updates; Supabase auth and row-level security",
      ], "https://quickbasket.vercel.app"),
    ],
    skills: ["JavaScript", "TypeScript", "React", "Next.js", "Redux", "Tailwind CSS", "HTML", "CSS", "Jest", "Playwright", "Figma", "Git"],
    achievements: ["Hacktoberfest 2025 — 6 merged PRs", "Winner, Smart India Hackathon 2024 (software edition)"],
    github: {
      login: "ananyak", joinedYear: 2022, activity: "high",
      languages: [["TypeScript", 58], ["JavaScript", 22], ["CSS", 14], ["HTML", 6]],
      repos: [
        { name: "leaf-ui", stars: 60, primaryLang: "TypeScript", description: "React component library with tokens, dark mode and Storybook", readme: "leaf-ui is a React + TypeScript component library: buttons, inputs, dialogs, menus, tables and form primitives built on Radix with Tailwind tokens. Storybook docs, visual tests with Chromatic, published with changesets." },
        { name: "quickbasket", stars: 14, primaryLang: "TypeScript", description: "Grocery ordering PWA (Next.js, Supabase)", readme: "QuickBasket is a grocery ordering PWA. Next.js App Router, Supabase auth and Postgres with RLS, optimistic cart, offline product browsing through a service worker, and a checkout flow with order tracking." },
      ],
      mergedPRs: [{ repo: "radix-ui/primitives", stars: 16_000, additions: 22, deletions: 4, changedFiles: 2, title: "Fix focus trap when Dialog closes from a nested Popover", mergedAt: "2025-10-20T09:00:00.000Z" }],
    },
    leetcode: {
      username: "ananya_k", solved: [110, 60, 5], preferredLanguage: "javascript", last30Days: 7,
      topics: { "Array": 75, "String": 50, "Hash Table": 45, "Two Pointers": 20, "Sorting": 30, "Stack": 18, "Linked List": 12, "Tree": 15, "Dynamic Programming": 12, "Binary Search": 10, "Math": 20, "Sliding Window": 9 },
    },
  },
  {
    slug: "faizan-ahmed", name: "Mohammed Faizan Ahmed", level: "fresher", tier: 3,
    probe: "Mass-recruiter fresher: tier-3 college, Java basics, no GitHub, small LeetCode",
    expectedSpecialization: null, expectedDomains: [],
    headline: "B.Tech CSE 2026 · Java, SQL",
    location: "Mohali, Punjab",
    education: [edu("Chandigarh University, Mohali", "B.Tech", "Computer Science and Engineering", 2022, 2026, "7.9 CGPA")],
    experience: [
      job("CodSoft", "Web Development Intern (virtual)", "2025-07", "2025-08", "Remote", [
        "Built a landing page, a calculator and a to-do app in HTML, CSS and JavaScript as part of the internship tasks",
      ]),
    ],
    projects: [
      project("Library Management System", "Desktop app to issue and return books with fine calculation.", ["Java", "Swing", "MySQL", "JDBC"], [
        "Librarian and student logins; reports exported to CSV",
      ]),
      project("Weather App", "Shows current weather and a 5-day forecast for any city.", ["HTML", "CSS", "JavaScript"], ["Uses the OpenWeather API; saves recent searches in localStorage"]),
      project("Portfolio Website", "Personal portfolio with projects and contact form.", ["HTML", "CSS", "JavaScript"], ["Hosted on GitHub Pages"]),
    ],
    skills: ["Core Java", "C", "Python", "HTML", "CSS", "JavaScript", "MySQL", "OOPs", "DBMS", "Git"],
    achievements: ["Qualified TCS NQT 2026 for the Ninja interview", "Coursera: Java Programming and Software Engineering Fundamentals (Duke)"],
    leetcode: {
      username: "faizan_ahmed26", solved: [70, 22, 0], preferredLanguage: "java", last30Days: 12,
      topics: { "Array": 45, "String": 25, "Hash Table": 18, "Math": 15, "Sorting": 14, "Two Pointers": 6, "Linked List": 5, "Stack": 4 },
    },
  },
  {
    slug: "harshita-bansal", name: "Harshita Bansal", level: "fresher", tier: 3,
    probe: "Android fresher: Play Store app, Dunzo internship (logistics), Kotlin GitHub. The catalogue has one Android JD, so she is expected to trail web generalists on fit",
    expectedSpecialization: null, expectedDomains: ["fintech", "logistics"],
    headline: "Android developer · Kotlin, Jetpack Compose",
    location: "Noida, Uttar Pradesh",
    education: [edu("Jaypee Institute of Information Technology, Noida", "B.Tech", "Computer Science and Engineering", 2022, 2026, "8.3 CGPA")],
    experience: [
      job("Dunzo", "Android Developer Intern", "2026-01", "2026-04", "Bengaluru", [
        "Rebuilt the order-tracking screen in Jetpack Compose with live rider location for the delivery app; crash-free sessions up from 98.9% to 99.6%",
        "Added Paging 3 to the order history list and cut cold start by 300 ms by deferring Firebase initialisation",
      ]),
    ],
    projects: [
      project("Hisaab", "Split bills with friends and settle up over UPI; on the Play Store.", ["Kotlin", "Jetpack Compose", "Room", "Firebase", "Coroutines"], [
        "1,200+ installs, 4.6 rating; offline-first with Room and WorkManager sync",
        "UPI deep links for settling balances; MVVM with Hilt",
      ], "https://play.google.com/store/apps/details?id=in.hisaab"),
      project("RailRadar", "Live train running status and PNR lookup.", ["Kotlin", "Retrofit", "MVVM"], ["Retrofit + Moshi client for the RapidAPI IRCTC endpoint; cached with Room"]),
    ],
    skills: ["Kotlin", "Java", "Android SDK", "Jetpack Compose", "Room", "Retrofit", "Coroutines", "Hilt", "Firebase", "Git", "SQL"],
    achievements: ["Hisaab — 1,200+ Play Store installs, 4.6 rating", "Android lead, Google Developer Student Club JIIT"],
    github: {
      login: "harshitab", joinedYear: 2023, activity: "medium",
      languages: [["Kotlin", 85], ["Java", 10], ["Shell", 5]],
      repos: [
        { name: "hisaab", stars: 44, primaryLang: "Kotlin", description: "Split bills and settle over UPI (Jetpack Compose)", readme: "Hisaab lets groups split expenses and settle balances over UPI deep links. Jetpack Compose, Room, WorkManager sync to Firebase, Hilt, Coroutines and Flow. Offline-first with conflict-free balance recomputation." },
        { name: "railradar", stars: 8, primaryLang: "Kotlin", description: "Live train status and PNR lookup", readme: "RailRadar shows live running status and PNR state. MVVM, Retrofit with Moshi, Room cache with a 10 minute TTL, Compose UI with pull-to-refresh." },
      ],
    },
    leetcode: {
      username: "harshitab", solved: [90, 55, 5], preferredLanguage: "kotlin", last30Days: 4,
      contest: { attended: 6, rating: 1520, topPercent: 32 },
      topics: { "Array": 60, "String": 35, "Hash Table": 30, "Tree": 18, "Linked List": 15, "Stack": 12, "Dynamic Programming": 14, "Binary Search": 12, "Sorting": 20, "Math": 15, "Two Pointers": 11 },
    },
  },

  // ------------------------------------------------------------------ sde1 (1–2.5 years)
  {
    slug: "karthik-raman", name: "Karthik Raman", level: "sde1", tier: 1,
    probe: "Backend SDE-1 at Zerodha (Go, Postgres, Kafka); OSS PRs; LeetCode rusty",
    expectedSpecialization: "backend", expectedDomains: ["fintech"],
    headline: "Software Developer at Zerodha · Go, PostgreSQL",
    location: "Bengaluru, Karnataka",
    education: [edu("PSG College of Technology, Coimbatore", "B.Tech", "Information Technology", 2020, 2024, "8.5 CGPA")],
    experience: [
      job("Zerodha", "Software Developer", "2024-07", "Present", "Bengaluru", [
        "Own the back-office reconciliation jobs that settle 4M trades a day against exchange files (Go, PostgreSQL); reconciliation finishes 40 minutes earlier than before",
        "Rewrote contract-note PDF generation as a Go worker reading from Kafka; p95 from 2.1 s to 400 ms",
        "On-call for the ledger services; wrote the runbook for Redis failover",
      ]),
      job("Zerodha", "Backend Intern", "2024-01", "2024-06", "Bengaluru", ["Built an internal Go CLI to replay Kafka topics into staging for debugging"]),
    ],
    projects: [
      project("pg-outbox", "Transactional outbox for Go services on PostgreSQL, with Kafka and NATS publishers.", ["Go", "PostgreSQL", "Kafka"], ["140 GitHub stars; used in production by two startups that I know of"], "https://github.com/karthikr/pg-outbox"),
    ],
    skills: ["Go", "PostgreSQL", "Redis", "Kafka", "Docker", "Linux", "gRPC", "Python", "Git"],
    achievements: ["Lightning talk at GopherCon India 2026: outbox patterns in Go"],
    github: {
      login: "karthikr", joinedYear: 2021, activity: "high",
      languages: [["Go", 71], ["Python", 15], ["TypeScript", 9], ["Shell", 5]],
      repos: [
        { name: "pg-outbox", stars: 140, primaryLang: "Go", description: "Transactional outbox for Go + PostgreSQL with Kafka/NATS publishers", readme: "pg-outbox writes events in the same transaction as your data and relays them to Kafka or NATS with at-least-once delivery, ordering per aggregate and a pluggable serializer. Uses LISTEN/NOTIFY to wake the relay. Tested with Testcontainers." },
        { name: "kafka-replay", stars: 19, primaryLang: "Go", description: "Replay Kafka topics into another cluster by time range", readme: "kafka-replay copies messages from a topic between two timestamps into a target cluster, preserving keys and headers, with rate limiting. Handy for rebuilding staging from production topics." },
      ],
      mergedPRs: [
        { repo: "jackc/pgx", stars: 11_000, additions: 38, deletions: 6, changedFiles: 2, title: "Return wrapped error from CopyFrom when the context is cancelled", mergedAt: "2025-09-03T12:00:00.000Z" },
        { repo: "segmentio/kafka-go", stars: 8_000, additions: 121, deletions: 20, changedFiles: 4, title: "Support per-partition commit intervals in the Reader", mergedAt: "2026-03-18T08:30:00.000Z" },
      ],
    },
    leetcode: {
      username: "karthikr", solved: [110, 135, 15], preferredLanguage: "golang", last30Days: 2,
      contest: { attended: 9, rating: 1560, topPercent: 27 },
      topics: { "Array": 120, "Hash Table": 80, "String": 60, "Dynamic Programming": 35, "Tree": 40, "Graph": 25, "Binary Search": 30, "Two Pointers": 25, "Stack": 22, "Heap (Priority Queue)": 12, "Greedy": 28, "Linked List": 20, "Sorting": 40, "Math": 30, "Depth-First Search": 30, "Breadth-First Search": 18 },
    },
  },
  {
    slug: "priya-venkatesh", name: "Priya Venkatesh", level: "sde1", tier: 1,
    probe: "Full-stack SDE-1 at Freshworks (Rails + React, SaaS); good LeetCode",
    expectedSpecialization: "fullstack", expectedDomains: ["saas"],
    headline: "Software Engineer at Freshworks · Rails, React",
    location: "Chennai, Tamil Nadu",
    education: [edu("R.V. College of Engineering, Bengaluru", "B.E.", "Computer Science and Engineering", 2021, 2025, "9.0 CGPA")],
    experience: [
      job("Freshworks", "Software Engineer", "2025-07", "Present", "Chennai", [
        "Ship features across Freshdesk's ticketing product, a customer-support SaaS: Rails APIs, Sidekiq jobs and React front-ends",
        "Built the bulk ticket-merge flow end to end (Rails service objects, PostgreSQL, React modal) used 40k times a month",
        "Cut the agent dashboard's p95 load time by 35% with query batching and a Redis cache for SLA counters",
      ]),
      job("Zoho", "Software Development Intern", "2024-05", "2024-07", "Chennai", ["Built REST endpoints and a React settings page for Zoho Desk's SLA policies"]),
    ],
    projects: [
      project("Shelfwise", "Inventory and billing app for a family kirana store.", ["Next.js", "TypeScript", "Prisma", "PostgreSQL"], ["Barcode scanning from the phone camera; GST invoice PDFs; daily sales dashboard"], "https://github.com/priyav/shelfwise"),
    ],
    skills: ["Ruby on Rails", "Ruby", "React", "TypeScript", "JavaScript", "PostgreSQL", "Redis", "Sidekiq", "GraphQL", "Docker", "AWS", "Git"],
    achievements: ["Freshworks Rookie of the Quarter, Q1 2026"],
    github: {
      login: "priyav", joinedYear: 2021, activity: "medium",
      languages: [["TypeScript", 40], ["Ruby", 30], ["JavaScript", 18], ["CSS", 7], ["Shell", 5]],
      repos: [
        { name: "shelfwise", stars: 21, primaryLang: "TypeScript", description: "Inventory and GST billing for a kirana store (Next.js, Prisma)", readme: "Shelfwise tracks stock, prints GST invoices and shows daily sales. Next.js with server actions, Prisma on PostgreSQL, barcode scanning through the browser camera, PDF invoices with react-pdf." },
        { name: "rails-sla-counters", stars: 5, primaryLang: "Ruby", description: "Redis-backed SLA counters for Rails apps", readme: "A small Rails engine that keeps SLA breach counters in Redis sorted sets and exposes them through a controller concern. Extracted from work on a ticketing dashboard." },
      ],
    },
    leetcode: {
      username: "priya_v", solved: [130, 160, 20], preferredLanguage: "python3", last30Days: 11,
      contest: { attended: 14, rating: 1610, topPercent: 21 },
      topics: { "Array": 140, "Hash Table": 90, "String": 75, "Dynamic Programming": 45, "Tree": 45, "Binary Tree": 40, "Graph": 28, "Binary Search": 35, "Two Pointers": 30, "Stack": 25, "Heap (Priority Queue)": 14, "Greedy": 32, "Linked List": 25, "Sorting": 50, "Math": 35, "Sliding Window": 18, "Backtracking": 15, "Depth-First Search": 32, "Breadth-First Search": 20 },
    },
  },
  {
    slug: "arjun-bhattacharya", name: "Arjun Bhattacharya", level: "sde1", tier: 2,
    probe: "Data engineer at Swiggy (Spark, Airflow); logistics domain from JD text; small LeetCode. No data-engineering template exists, so backend and data-science may both lead",
    expectedSpecialization: null, expectedDomains: ["logistics"],
    headline: "Data Engineer I at Swiggy · Spark, Airflow, Kafka",
    location: "Bengaluru, Karnataka",
    education: [edu("Jadavpur University, Kolkata", "B.E.", "Computer Science and Engineering", 2021, 2025, "8.2 CGPA")],
    experience: [
      job("Swiggy", "Data Engineer I", "2025-07", "Present", "Bengaluru", [
        "Built the demand-forecast feature pipeline for Instamart in PySpark on EMR: 2 TB/day of order and delivery events, hourly Airflow DAGs with data-quality checks",
        "Moved delivery-partner ETA features from a nightly Hive job to a Kafka + Flink stream, cutting feature lag from 24 h to 5 min",
        "Own the dbt models for the logistics analytics mart used by city ops",
      ]),
      job("Flipkart", "Data Engineering Intern", "2024-05", "2024-07", "Bengaluru", ["Wrote Airflow DAGs to backfill the seller-payments warehouse tables; added Great Expectations checks"]),
    ],
    projects: [
      project("metro-ridership", "Kolkata Metro ridership dashboard from open data.", ["Python", "Airflow", "dbt", "PostgreSQL", "Metabase"], ["Daily Airflow DAG; dbt models with tests; Metabase dashboard"], "https://github.com/arjunb/metro-ridership"),
    ],
    skills: ["Python", "PySpark", "Spark", "Airflow", "Kafka", "Flink", "Hive", "SQL", "dbt", "Snowflake", "AWS", "Scala"],
    achievements: ["Swiggy Data Platform award for the ETA streaming migration (2026)"],
    github: {
      login: "arjunb", joinedYear: 2022, activity: "medium",
      languages: [["Python", 70], ["Scala", 15], ["TSQL", 10], ["Shell", 5]],
      repos: [
        { name: "metro-ridership", stars: 11, primaryLang: "Python", description: "Airflow + dbt pipeline and dashboard for Kolkata Metro ridership", readme: "Pulls daily ridership CSVs from the open data portal with an Airflow DAG, loads them into PostgreSQL, models them with dbt (tests included) and serves a Metabase dashboard." },
        { name: "spark-skew-notes", stars: 27, primaryLang: "Scala", description: "Notes and benchmarks on handling skewed joins in Spark", readme: "Benchmarks of salting, broadcast joins and AQE skew handling on a synthetic order dataset, with the Spark configs used and the resulting stage timings." },
      ],
    },
    leetcode: {
      username: "arjun_b", solved: [90, 48, 2], preferredLanguage: "python3", last30Days: 3,
      topics: { "Array": 60, "Hash Table": 40, "String": 30, "Sorting": 25, "Math": 15, "Two Pointers": 12, "Dynamic Programming": 10, "Tree": 10, "Database": 45 },
    },
  },
  {
    slug: "nikhil-agarwal", name: "Nikhil Agarwal", level: "sde1", tier: 2,
    probe: "ML engineer at a healthtech startup; PyTorch + FastAPI; one paper",
    expectedSpecialization: "ai-ml", expectedDomains: ["healthtech"],
    headline: "Machine Learning Engineer at HealthifyMe",
    location: "Bengaluru, Karnataka",
    education: [edu("Indian Institute of Technology, Guwahati", "B.Tech", "Computer Science and Engineering", 2021, 2025, "8.8 CGPA")],
    experience: [
      job("HealthifyMe", "Machine Learning Engineer", "2025-08", "Present", "Bengaluru", [
        "Own the food-photo recognition model behind meal logging: fine-tuned a ViT-S on 1.2M labelled images, top-1 accuracy from 81% to 88%",
        "Serve models with FastAPI and TorchServe on Kubernetes; p95 inference 140 ms with ONNX export and dynamic batching",
        "Built diet-plan recommendations for diabetes patients with the clinic dietitians; A/B tested with 50k patients",
      ]),
    ],
    projects: [
      project("ncert-rag", "Question answering over NCERT textbooks with retrieval-augmented generation.", ["Python", "LangChain", "pgvector", "FastAPI"], ["Hybrid BM25 + embedding retrieval; evaluation set of 400 questions with 0.74 answer accuracy"], "https://github.com/nikhila/ncert-rag"),
    ],
    skills: ["Python", "PyTorch", "Hugging Face Transformers", "FastAPI", "Docker", "Kubernetes", "PostgreSQL", "pgvector", "AWS SageMaker", "MLflow", "SQL"],
    achievements: ["Paper: 'Low-resource food recognition with synthetic augmentation', ICON 2024 student track"],
    github: {
      login: "nikhila", joinedYear: 2022, activity: "medium",
      languages: [["Python", 82], ["Jupyter Notebook", 15], ["Dockerfile", 3]],
      repos: [
        { name: "ncert-rag", stars: 38, primaryLang: "Python", description: "RAG over NCERT textbooks (LangChain, pgvector, FastAPI)", readme: "Chunks NCERT PDFs, stores embeddings in pgvector, retrieves with hybrid BM25 + cosine and answers with an open model. FastAPI service with an evaluation harness of 400 questions." },
        { name: "torchserve-batching-demo", stars: 9, primaryLang: "Python", description: "Dynamic batching benchmarks for TorchServe", readme: "Compares TorchServe dynamic batching settings and ONNX export for a ViT-S classifier; includes the Locust load test and the p95 numbers." },
      ],
    },
    leetcode: {
      username: "nikhil_a", solved: [100, 100, 10], preferredLanguage: "python3", last30Days: 5,
      contest: { attended: 5, rating: 1490, topPercent: 36 },
      topics: { "Array": 95, "Hash Table": 60, "String": 50, "Dynamic Programming": 35, "Tree": 30, "Graph": 20, "Binary Search": 25, "Two Pointers": 20, "Sorting": 35, "Math": 30, "Stack": 15, "Heap (Priority Queue)": 10, "Greedy": 18, "Depth-First Search": 22 },
    },
  },

  // ------------------------------------------------------------------ sde2 (3–5 years)
  {
    slug: "vikram-rathore", name: "Vikram Singh Rathore", level: "sde2", tier: 1,
    probe: "Payments backend SDE-2 (PhonePe, ex-Razorpay); Apache Kafka PR; LeetCode rusty",
    expectedSpecialization: "backend", expectedDomains: ["fintech"],
    headline: "SDE-2 at PhonePe · UPI · Java, Kafka",
    location: "Bengaluru, Karnataka",
    education: [edu("Delhi Technological University", "B.Tech", "Computer Engineering", 2017, 2021, "8.1 CGPA")],
    experience: [
      job("PhonePe", "Software Development Engineer II", "2024-03", "Present", "Bengaluru", [
        "Own the UPI collect-request service (Java, Spring Boot, Aerospike, Kafka): 9k TPS peak, 99.99% availability over the last four quarters",
        "Led the UPI Lite rollout for the merchant flow across three teams; designed the idempotent debit path and the reconciliation job",
        "Mentor two SDE-1s; run the payments design review every fortnight",
      ]),
      job("Razorpay", "Software Development Engineer I", "2021-07", "2024-02", "Bengaluru", [
        "Built the refunds service's retry and settlement reconciliation in Java and MySQL; refund SLA breaches down 70%",
        "Moved webhook delivery to Kafka consumers with per-merchant rate limits",
      ]),
    ],
    projects: [
      project("spring-idempotency", "Spring Boot starter that adds idempotency keys to any POST endpoint with a Redis or JDBC store.", ["Java", "Spring Boot", "Redis"], ["95 GitHub stars; used in two production services at work"], "https://github.com/vikramsr/spring-idempotency"),
    ],
    skills: ["Java", "Spring Boot", "Kafka", "MySQL", "Aerospike", "Redis", "Kubernetes", "gRPC", "System Design", "Distributed Systems"],
    achievements: ["PhonePe Spot Award for the UPI Lite merchant rollout (2025)"],
    github: {
      login: "vikramsr", joinedYear: 2018, activity: "medium",
      languages: [["Java", 80], ["Kotlin", 10], ["Shell", 10]],
      repos: [
        { name: "spring-idempotency", stars: 95, primaryLang: "Java", description: "Idempotency keys for Spring Boot endpoints (Redis/JDBC stores)", readme: "Adds an Idempotency-Key filter to Spring Boot: stores the first response for a key in Redis or JDBC and replays it on retries, with fingerprint checks so a different body with the same key is rejected. Spring Boot 3 starter with auto-configuration." },
      ],
      mergedPRs: [{ repo: "apache/kafka", stars: 29_000, additions: 92, deletions: 15, changedFiles: 5, title: "KAFKA-16772: Fix rebalance-latency metric reset on consumer close", mergedAt: "2025-06-11T14:20:00.000Z" }],
    },
    leetcode: {
      username: "vikramsr", solved: [80, 90, 10], preferredLanguage: "java", last30Days: 0,
      topics: { "Array": 85, "Hash Table": 55, "String": 40, "Dynamic Programming": 25, "Tree": 30, "Graph": 15, "Binary Search": 20, "Linked List": 18, "Stack": 15, "Sorting": 30, "Math": 20, "Heap (Priority Queue)": 8, "Depth-First Search": 18 },
    },
  },
  {
    slug: "shruti-iyer", name: "Shruti Iyer", level: "sde2", tier: 1,
    probe: "Frontend SDE-2 at Flipkart (checkout, design system); TanStack PR; little LeetCode",
    expectedSpecialization: "frontend", expectedDomains: ["e-commerce"],
    headline: "SDE-2 (Frontend) at Flipkart · React, TypeScript",
    location: "Bengaluru, Karnataka",
    education: [edu("Veermata Jijabai Technological Institute, Mumbai", "B.Tech", "Computer Engineering", 2018, 2022, "8.6 CGPA")],
    experience: [
      job("Flipkart", "Software Development Engineer II (Frontend)", "2024-07", "Present", "Bengaluru", [
        "Own the checkout page web experience: React, TypeScript, Node.js BFF; moved the address and payment steps to React Server Components, LCP down 28% on mid-range Android phones",
        "Maintain the design system's data-table and form packages used by 40 teams; wrote the migration codemods",
        "Run the web performance guild; set the 2.5 s LCP budget for product pages",
      ]),
      job("Flipkart", "Software Development Engineer I", "2022-07", "2024-06", "Bengaluru", [
        "Built the order-tracking timeline and the returns flow in React; added Cypress end-to-end coverage",
      ]),
    ],
    projects: [
      project("react-virtual-grid", "Virtualised grid for very large product catalogues with variable row heights.", ["React", "TypeScript"], ["320 GitHub stars; used on the catalogue listing pages at work"], "https://github.com/shrutii/react-virtual-grid"),
    ],
    skills: ["React", "TypeScript", "JavaScript", "Next.js", "Node.js", "GraphQL", "Webpack", "Jest", "Cypress", "Web performance", "Accessibility", "CSS"],
    achievements: ["Speaker, React India 2025: 'Server Components at checkout scale'"],
    github: {
      login: "shrutii", joinedYear: 2019, activity: "high",
      languages: [["TypeScript", 70], ["JavaScript", 18], ["CSS", 8], ["HTML", 4]],
      repos: [
        { name: "react-virtual-grid", stars: 320, primaryLang: "TypeScript", description: "Virtualised grid with variable row heights and sticky headers", readme: "react-virtual-grid renders only the visible window of a large grid, measures variable row heights, supports sticky headers and columns, keyboard navigation and RTL. Zero dependencies besides React; tested with Playwright." },
        { name: "lcp-budget-action", stars: 48, primaryLang: "TypeScript", description: "GitHub Action that fails a PR when Lighthouse LCP exceeds a budget", readme: "Runs Lighthouse CI on preview URLs and comments the LCP, CLS and TBT deltas on the pull request, failing the check when a budget from lcp-budget.json is exceeded." },
      ],
      mergedPRs: [{ repo: "TanStack/virtual", stars: 6_000, additions: 45, deletions: 7, changedFiles: 3, title: "Fix scroll jump when measured item sizes shrink above the viewport", mergedAt: "2025-11-02T16:45:00.000Z" }],
    },
    leetcode: {
      username: "shruti_i", solved: [60, 35, 0], preferredLanguage: "javascript", last30Days: 0,
      topics: { "Array": 50, "String": 30, "Hash Table": 25, "Two Pointers": 10, "Sorting": 15, "Stack": 10, "Tree": 8, "Linked List": 6, "Math": 10 },
    },
  },
  {
    slug: "abhishek-reddy", name: "Abhishek Reddy", level: "sde2", tier: 2,
    probe: "SRE/DevOps SDE-2 (Chargebee, ex-Infosys); Kubernetes, Terraform; almost no LeetCode",
    expectedSpecialization: "devops", expectedDomains: ["saas"],
    headline: "Site Reliability Engineer II at Chargebee",
    location: "Chennai, Tamil Nadu",
    education: [edu("BITS Pilani, Hyderabad Campus", "B.E.", "Electronics and Communication Engineering", 2017, 2021, "7.8 CGPA")],
    experience: [
      job("Chargebee", "Site Reliability Engineer II", "2024-01", "Present", "Chennai", [
        "Run the Kubernetes platform (EKS, 14 clusters) for Chargebee's subscription billing SaaS; moved deployments to ArgoCD with progressive rollouts",
        "Cut AWS spend 23% with Karpenter consolidation, spot node pools and rightsizing from Prometheus data",
        "Own the on-call rotation and incident reviews; MTTR down from 48 to 19 minutes with better alert routing",
      ]),
      job("Infosys", "DevOps Engineer", "2021-08", "2023-12", "Hyderabad", [
        "Built Jenkins and GitHub Actions pipelines and Terraform modules for a US insurance client's Azure landing zone",
        "Wrote Ansible playbooks for patching 300 VMs",
      ]),
    ],
    projects: [
      project("k8s-cost-exporter", "Prometheus exporter that attributes node cost to namespaces and workloads.", ["Go", "Kubernetes", "Prometheus"], ["210 GitHub stars; Helm chart; supports AWS and GCP pricing"], "https://github.com/abhishekr/k8s-cost-exporter"),
    ],
    skills: ["Kubernetes", "Terraform", "AWS", "Azure", "Docker", "Helm", "ArgoCD", "Prometheus", "Grafana", "Go", "Python", "Linux", "GitHub Actions", "Jenkins", "Ansible"],
    achievements: ["AWS Certified DevOps Engineer – Professional", "Certified Kubernetes Administrator (CKA)"],
    github: {
      login: "abhishekr", joinedYear: 2018, activity: "medium",
      languages: [["Go", 45], ["HCL", 25], ["Shell", 20], ["Python", 10]],
      repos: [
        { name: "k8s-cost-exporter", stars: 210, primaryLang: "Go", description: "Prometheus exporter attributing node cost to namespaces and workloads", readme: "Reads node pricing from the AWS and GCP price lists, joins it with kube-state-metrics and cAdvisor usage, and exports per-namespace and per-workload cost series. Helm chart and Grafana dashboard included." },
        { name: "terraform-eks-baseline", stars: 33, primaryLang: "HCL", description: "Opinionated Terraform module for an EKS cluster with Karpenter and IRSA", readme: "Terraform module that provisions an EKS cluster with Karpenter, IRSA, VPC CNI prefix delegation, ArgoCD bootstrap and the usual add-ons. Used as the starting point for new clusters." },
      ],
    },
    leetcode: {
      username: "abhishek_r", solved: [50, 10, 0], preferredLanguage: "python3", last30Days: 0,
      topics: { "Array": 35, "String": 20, "Hash Table": 15, "Sorting": 10, "Math": 8 },
    },
  },
  {
    slug: "meera-joshi", name: "Meera Joshi", level: "sde2", tier: 2,
    probe: "Android SDE-2 (CRED, ex-Meesho); Compose OSS library; fintech via employer",
    expectedSpecialization: null, expectedDomains: ["fintech", "e-commerce"],
    headline: "SDE-2 (Android) at CRED · Kotlin, Jetpack Compose",
    location: "Bengaluru, Karnataka",
    education: [edu("Manipal Institute of Technology, Manipal", "B.Tech", "Computer Science and Engineering", 2018, 2022, "8.4 CGPA")],
    experience: [
      job("CRED", "Software Development Engineer II (Android)", "2025-04", "Present", "Bengaluru", [
        "Own the credit card bill payment flow in the Android app: Kotlin, Jetpack Compose, Coroutines; payment-success rate up 1.4 points after the retry redesign",
        "Modularised the app into 60 Gradle modules; clean build time from 14 to 6 minutes",
      ]),
      job("Meesho", "Software Development Engineer I (Android)", "2022-07", "2025-03", "Bengaluru", [
        "Built the product detail and cart screens for Meesho's reseller app in Kotlin with MVVM and Hilt; app size down 18% with dynamic feature modules",
        "Added Compose to the checkout flow and wrote the migration guide the team followed",
      ]),
    ],
    projects: [
      project("compose-charts", "Line, bar and candlestick charts for Jetpack Compose with gestures and animations.", ["Kotlin", "Jetpack Compose"], ["480 GitHub stars; used by a few fintech apps on the Play Store"], "https://github.com/meeraj/compose-charts"),
    ],
    skills: ["Kotlin", "Android", "Jetpack Compose", "Coroutines", "Hilt", "Room", "Retrofit", "Gradle", "Firebase", "Kotlin Multiplatform", "Java"],
    achievements: ["Google Developer Expert nominee (Android), 2026"],
    github: {
      login: "meeraj", joinedYear: 2019, activity: "high",
      languages: [["Kotlin", 93], ["Java", 5], ["Shell", 2]],
      repos: [
        { name: "compose-charts", stars: 480, primaryLang: "Kotlin", description: "Charts for Jetpack Compose with gestures and animations", readme: "compose-charts draws line, bar, pie and candlestick charts in Jetpack Compose with pinch-zoom, scrubbing, animated transitions and accessibility descriptions. Kotlin Multiplatform artifacts for Android and desktop." },
      ],
      mergedPRs: [{ repo: "coil-kt/coil", stars: 11_000, additions: 70, deletions: 12, changedFiles: 4, title: "Respect ImageRequest.size when decoding animated WebP on API 28+", mergedAt: "2025-05-22T11:00:00.000Z" }],
    },
    leetcode: {
      username: "meera_j", solved: [80, 45, 5], preferredLanguage: "kotlin", last30Days: 0,
      topics: { "Array": 60, "String": 35, "Hash Table": 30, "Tree": 15, "Linked List": 12, "Stack": 10, "Sorting": 20, "Math": 12, "Dynamic Programming": 8 },
    },
  },

  // ------------------------------------------------------------------ sde3 (5–8 years)
  {
    slug: "siddharth-menon", name: "Siddharth Menon", level: "sde3", tier: 1,
    probe: "Amazon SDE-3, eight years, e-commerce backend at scale; old LeetCode record",
    expectedSpecialization: "backend", expectedDomains: ["e-commerce"],
    headline: "SDE-3 at Amazon · fulfilment systems · Java, AWS",
    location: "Bengaluru, Karnataka",
    education: [edu("National Institute of Technology, Calicut", "B.Tech", "Computer Science and Engineering", 2014, 2018, "8.9 CGPA")],
    experience: [
      job("Amazon", "Software Development Engineer III", "2023-07", "Present", "Bengaluru", [
        "Technical lead for the regional inventory-reservation service behind order placement: 60k TPS peak, DynamoDB with conditional writes, p99 under 40 ms",
        "Designed the migration from a monolithic reservation ledger to partitioned services across three teams without an order-placement outage",
        "Raise the operational bar: cut sev-2 pages 55% through automated remediation with Lambda and SQS dead-letter replays",
      ]),
      job("Amazon", "Software Development Engineer II", "2020-07", "2023-06", "Bengaluru", ["Owned the returns-eligibility service; added Kotlin coroutines-based batching that cut downstream calls 4x"]),
      job("Amazon", "Software Development Engineer I", "2018-07", "2020-06", "Hyderabad", ["Built order-fulfilment event consumers in Java on SQS and Kinesis"]),
    ],
    projects: [
      project("dynamo-ttl-sweeper", "Safe TTL backfill tool for large DynamoDB tables with adaptive write throttling.", ["Java", "AWS", "DynamoDB"], ["Backfilled 4B items at work without throttling live traffic"], "https://github.com/sidmenon/dynamo-ttl-sweeper"),
    ],
    skills: ["Java", "Kotlin", "AWS", "DynamoDB", "Lambda", "SQS", "Kafka", "Distributed Systems", "System Design", "Microservices", "Architecture"],
    achievements: ["Amazon 'Just Do It' award for the reservation-ledger migration (2025)"],
    github: {
      login: "sidmenon", joinedYear: 2016, activity: "low",
      languages: [["Java", 60], ["Python", 35], ["Shell", 5]],
      repos: [
        { name: "dynamo-ttl-sweeper", stars: 27, primaryLang: "Java", description: "Adaptive TTL backfill for large DynamoDB tables", readme: "Scans a DynamoDB table in parallel segments and writes TTL attributes with adaptive throttling based on consumed capacity, so a backfill never starves live traffic. Resumable from checkpoints in a side table." },
      ],
    },
    leetcode: {
      username: "sid_menon", solved: [120, 160, 30], preferredLanguage: "java", last30Days: 0,
      contest: { attended: 18, rating: 1720, topPercent: 12.4 },
      topics: { "Array": 130, "Hash Table": 90, "String": 70, "Dynamic Programming": 55, "Tree": 55, "Graph": 35, "Binary Search": 38, "Two Pointers": 30, "Stack": 28, "Heap (Priority Queue)": 18, "Greedy": 35, "Linked List": 25, "Sorting": 50, "Math": 40, "Depth-First Search": 40, "Breadth-First Search": 25, "Backtracking": 18, "Trie": 7 },
    },
  },
  {
    slug: "ritika-sharma", name: "Ritika Sharma", level: "sde3", tier: 1,
    probe: "Senior backend at Swiggy (ex-Delhivery, Ola): logistics streaming; Flink PR; strong old LeetCode",
    expectedSpecialization: "backend", expectedDomains: ["logistics"],
    headline: "Senior Software Engineer at Swiggy · delivery platform · Go, Kafka, Flink",
    location: "Bengaluru, Karnataka",
    education: [edu("International Institute of Information Technology, Hyderabad", "B.Tech", "Computer Science and Engineering", 2015, 2019, "9.2 CGPA")],
    experience: [
      job("Swiggy", "Senior Software Engineer", "2024-01", "Present", "Bengaluru", [
        "Lead the delivery-assignment platform: Go services, Kafka, Redis and Flink that assign 2.5M orders a day to delivery partners; assignment latency p99 from 900 ms to 310 ms",
        "Designed the batching engine that groups nearby orders for one delivery partner; 9% fewer kilometres per order in three cities",
        "Mentor four engineers; own the team's design reviews and the on-call quality bar",
      ]),
      job("Delhivery", "Software Development Engineer II", "2021-04", "2023-12", "Gurugram", [
        "Built the shipment tracking event pipeline (Kafka, Go, PostgreSQL) processing 40M scan events a day for last-mile delivery",
        "Rewrote the route-optimisation service's distance matrix cache; API cost down 60%",
      ]),
      job("Ola", "Software Development Engineer", "2019-07", "2021-03", "Bengaluru", ["Worked on ride-hailing dispatch services in Java; added surge-zone recomputation on Kafka Streams"]),
    ],
    projects: [
      project("geo-batcher", "Library for grouping geo-tagged tasks into routes under time and capacity limits.", ["Go"], ["Used in the Swiggy batching engine's first version; H3 indexing and a greedy-plus-local-search solver"], "https://github.com/ritikas/geo-batcher"),
    ],
    skills: ["Go", "Java", "Kafka", "Flink", "Redis", "PostgreSQL", "Kubernetes", "gRPC", "System Design", "Distributed Systems"],
    achievements: ["Swiggy Tech Excellence award, 2025", "Rating 1810 on LeetCode (2020)"],
    github: {
      login: "ritikas", joinedYear: 2016, activity: "medium",
      languages: [["Go", 65], ["Java", 20], ["Python", 15]],
      repos: [
        { name: "geo-batcher", stars: 76, primaryLang: "Go", description: "Group geo-tagged tasks into routes under time and capacity constraints", readme: "geo-batcher indexes tasks with H3, builds candidate batches greedily and improves them with 2-opt local search under per-batch time windows and capacity limits. Benchmarks against OR-Tools included." },
      ],
      mergedPRs: [{ repo: "apache/flink", stars: 24_000, additions: 134, deletions: 22, changedFiles: 6, title: "[FLINK-34211] Fix watermark alignment when a source split goes idle", mergedAt: "2025-03-30T07:15:00.000Z" }],
    },
    leetcode: {
      username: "ritika_s", solved: [150, 230, 40], preferredLanguage: "java", last30Days: 0,
      contest: { attended: 30, rating: 1810, topPercent: 9.1 },
      topics: { "Array": 180, "Hash Table": 110, "String": 90, "Dynamic Programming": 75, "Tree": 70, "Graph": 50, "Binary Search": 48, "Two Pointers": 40, "Stack": 35, "Heap (Priority Queue)": 25, "Greedy": 45, "Linked List": 30, "Sorting": 60, "Math": 55, "Depth-First Search": 50, "Breadth-First Search": 35, "Backtracking": 22, "Trie": 10, "Union Find": 14, "Sliding Window": 28 },
    },
  },
  {
    slug: "rahul-kulkarni", name: "Rahul Kulkarni", level: "sde3", tier: 2,
    probe: "Senior data engineer (Razorpay, ex-Dream11, ex-TCS); Spark/Flink; weak LeetCode. No data-engineering template exists, so backend and data-science may both lead",
    expectedSpecialization: null, expectedDomains: ["fintech", "gaming"],
    headline: "Senior Data Engineer at Razorpay · Spark, Flink, Snowflake",
    location: "Pune, Maharashtra",
    education: [edu("Pune Institute of Computer Technology", "B.E.", "Computer Engineering", 2015, 2019, "8.0 CGPA")],
    experience: [
      job("Razorpay", "Senior Data Engineer", "2024-02", "Present", "Bengaluru", [
        "Own the payments data platform's streaming layer: Flink jobs on Kafka that build settlement and risk features for 3B events a month",
        "Led the Hive-to-Snowflake migration of the finance marts (dbt, Airflow); monthly close reports now run in 20 minutes instead of 6 hours",
      ]),
      job("Dream11", "Data Engineer II", "2021-03", "2024-01", "Mumbai", [
        "Built Spark pipelines for match-day traffic on fantasy games: 20M concurrent users on IPL finals; late-arriving event handling with watermarks",
      ]),
      job("TCS", "Data Engineer", "2019-07", "2021-02", "Pune", ["ETL development in Informatica and Spark for a retail banking client's data warehouse"]),
    ],
    projects: [
      project("flink-dq", "Data-quality checks as Flink operators with Prometheus metrics.", ["Scala", "Flink"], ["Null-rate, freshness and schema-drift checks that page before downstream jobs fail"], "https://github.com/rahulk/flink-dq"),
    ],
    skills: ["Spark", "Flink", "Airflow", "Kafka", "Snowflake", "dbt", "Python", "Scala", "SQL", "AWS", "Data modelling"],
    achievements: ["Razorpay Data award for the Snowflake migration (2025)"],
    github: {
      login: "rahulk", joinedYear: 2017, activity: "low",
      languages: [["Python", 55], ["Scala", 30], ["TSQL", 15]],
      repos: [
        { name: "flink-dq", stars: 34, primaryLang: "Scala", description: "Data-quality operators for Flink with Prometheus metrics", readme: "Drop-in Flink operators that measure null rates, event-time freshness and schema drift per key and export them to Prometheus, with an alerting example for Grafana." },
      ],
    },
    leetcode: {
      username: "rahul_k", solved: [75, 40, 5], preferredLanguage: "python3", last30Days: 0,
      topics: { "Array": 55, "Hash Table": 35, "String": 25, "Sorting": 20, "Math": 12, "Database": 60, "Two Pointers": 8, "Dynamic Programming": 6 },
    },
  },

  // ------------------------------------------------------------------ staff (8–12 years)
  {
    slug: "anirudh-rao", name: "Anirudh Rao", level: "staff", tier: 1,
    probe: "Staff engineer at Juspay (ex-Razorpay, Flipkart): payments architecture; patent",
    expectedSpecialization: "backend", expectedDomains: ["fintech", "e-commerce"],
    headline: "Staff Engineer at Juspay · payments infrastructure",
    location: "Bengaluru, Karnataka",
    education: [edu("Indian Institute of Technology, Madras", "B.Tech", "Computer Science and Engineering", 2011, 2015, "8.7 CGPA")],
    experience: [
      job("Juspay", "Staff Engineer", "2022-04", "Present", "Bengaluru", [
        "Set the architecture for the payments orchestration platform (Haskell and Go services, PostgreSQL, Kafka) that routes 150M UPI and card transactions a month across 40 gateways",
        "Designed the tokenised card vault and smart routing; authorisation success up 2.1 points, which the team measured at ₹300 crore of extra annual GMV for merchants",
        "Lead a cross-team reliability programme: 99.995% availability, zero sev-1 in 2025",
      ]),
      job("Razorpay", "Lead Engineer", "2018-05", "2022-03", "Bengaluru", [
        "Built the payment gateway's routing and retry layer in Go; led the move from a PHP monolith to services",
      ]),
      job("Flipkart", "Software Development Engineer", "2015-07", "2018-04", "Bengaluru", ["Worked on the order-management system's inventory and promise services in Java"]),
    ],
    projects: [
      project("pg-router-sim", "Simulator for payment-gateway routing strategies on anonymised transaction logs.", ["Go", "PostgreSQL"], ["Used to evaluate routing changes before rollout"]),
    ],
    skills: ["System Design", "Distributed Systems", "Architecture", "Kafka", "PostgreSQL", "Go", "Java", "Haskell", "Kubernetes", "Observability"],
    achievements: ["Patent filed: dynamic routing across tokenised card vaults (2023)", "Speaker, Rootconf 2024"],
    github: {
      login: "anirudhr", joinedYear: 2014, activity: "low",
      languages: [["Haskell", 40], ["Go", 30], ["Java", 20], ["Nix", 10]],
      repos: [
        { name: "pg-router-sim", stars: 19, primaryLang: "Go", description: "Payment routing strategy simulator over anonymised transaction logs", readme: "Replays anonymised transaction logs through pluggable routing strategies (static weights, bandit, success-rate windows) and reports authorisation success, latency and cost per gateway." },
      ],
      mergedPRs: [{ repo: "grafana/loki", stars: 24_000, additions: 81, deletions: 10, changedFiles: 4, title: "Fix ingester flush starvation under high-cardinality streams", mergedAt: "2024-12-09T13:30:00.000Z" }],
    },
    leetcode: {
      username: "anirudh_r", solved: [90, 95, 15], preferredLanguage: "golang", last30Days: 0,
      topics: { "Array": 90, "Hash Table": 55, "String": 45, "Dynamic Programming": 30, "Tree": 30, "Graph": 20, "Binary Search": 22, "Sorting": 30, "Math": 25, "Stack": 15, "Linked List": 15, "Greedy": 20 },
    },
  },
  {
    slug: "neha-kapoor", name: "Neha Kapoor", level: "staff", tier: 1,
    probe: "Staff frontend at Microsoft (Teams web); VS Code PRs; no product domain",
    expectedSpecialization: "frontend", expectedDomains: [],
    headline: "Staff Software Engineer at Microsoft · web platform and performance",
    location: "Hyderabad, Telangana",
    education: [edu("Netaji Subhas Institute of Technology, Delhi", "B.E.", "Computer Engineering", 2010, 2014, "8.2 CGPA")],
    experience: [
      job("Microsoft", "Staff Software Engineer", "2021-02", "Present", "Hyderabad", [
        "Lead the web client architecture for a large collaboration product: TypeScript, React, Electron; drove the move to a single web code base for desktop and browser across 12 teams",
        "Cut cold start by 38% through code splitting, a shared module federation layer and startup tracing; own the performance budgets for 60 feature teams",
        "Chair the front-end architecture council; mentor senior and principal engineers across India and Redmond",
      ]),
      job("Adobe", "Senior Software Engineer", "2017-03", "2021-01", "Noida", ["Built the document-cloud web viewer's rendering pipeline (TypeScript, WebAssembly); accessibility compliance for US federal customers"]),
      job("Samsung R&D Institute", "Software Engineer", "2014-07", "2017-02", "Noida", ["Developed the Tizen browser's JavaScript bindings in C++"]),
    ],
    projects: [],
    skills: ["TypeScript", "JavaScript", "React", "Node.js", "Electron", "WebAssembly", "Web performance", "Accessibility", "System Design", "Architecture", "Rust"],
    achievements: ["Microsoft Technical Leadership award, 2024", "Speaker, JSConf India 2025"],
    github: {
      login: "nehak", joinedYear: 2013, activity: "medium",
      languages: [["TypeScript", 75], ["JavaScript", 15], ["C++", 7], ["Rust", 3]],
      repos: [
        { name: "startup-tracer", stars: 150, primaryLang: "TypeScript", description: "Startup tracing and flame charts for Electron and web apps", readme: "startup-tracer records user-timing marks, long tasks and module evaluation during app start and renders them as a flame chart with per-release comparisons. Works in Electron renderers and browsers." },
      ],
      mergedPRs: [
        { repo: "microsoft/vscode", stars: 165_000, additions: 148, deletions: 31, changedFiles: 7, title: "Reduce workbench startup by lazily creating the auxiliary bar", mergedAt: "2025-01-21T10:00:00.000Z" },
        { repo: "microsoft/vscode", stars: 165_000, additions: 57, deletions: 12, changedFiles: 3, title: "Fix focus loss when the terminal tab list rerenders", mergedAt: "2025-08-05T15:40:00.000Z" },
      ],
    },
    leetcode: {
      username: "neha_k", solved: [50, 30, 0], preferredLanguage: "typescript", last30Days: 0,
      topics: { "Array": 40, "String": 25, "Hash Table": 20, "Sorting": 10, "Tree": 8, "Stack": 6 },
    },
  },
  {
    slug: "sanjay-krishnamurthy", name: "Sanjay Krishnamurthy", level: "staff", tier: 2,
    probe: "Staff ML engineer at Google (ex-Byju's): recommendation systems; papers; little LeetCode",
    expectedSpecialization: "ai-ml", expectedDomains: ["edtech"],
    headline: "Staff ML Engineer at Google · ranking and recommendation",
    location: "Bengaluru, Karnataka",
    education: [
      edu("Indian Institute of Science, Bengaluru", "M.Tech", "Computer Science", 2012, 2014, "8.9 CGPA"),
      edu("National Institute of Technology, Karnataka", "B.Tech", "Computer Science and Engineering", 2008, 2012, "8.6 CGPA"),
    ],
    experience: [
      job("Google", "Staff Machine Learning Engineer", "2020-06", "Present", "Bengaluru", [
        "Technical lead for recommendation ranking on a large video product: two-tower retrieval and multi-task ranking models in TensorFlow and JAX trained on TPUs; +3.4% watch time in the India launch",
        "Set the modelling roadmap across three teams; own the offline/online evaluation framework and the launch review process",
      ]),
      job("Byju's", "Senior Machine Learning Scientist", "2017-04", "2020-05", "Bengaluru", [
        "Built the adaptive practice engine for the learning app: knowledge tracing models that pick the next question for 10M students; completion rate up 12%",
      ]),
      job("Xerox Research Centre India", "Research Engineer", "2014-07", "2017-03", "Bengaluru", ["Research on document understanding; two papers at ICDAR"]),
    ],
    projects: [],
    skills: ["Python", "TensorFlow", "JAX", "PyTorch", "Recommendation systems", "Distributed training", "BigQuery", "SQL", "System Design", "Machine learning"],
    achievements: ["Four papers (RecSys 2022, KDD 2023 workshop, ICDAR 2015, 2016)", "Google Tech Impact award, 2024"],
    github: {
      login: "sanjayk", joinedYear: 2012, activity: "low",
      languages: [["Python", 90], ["C++", 10]],
      repos: [
        { name: "two-tower-recsys", stars: 210, primaryLang: "Python", description: "Reference two-tower retrieval model with in-batch negatives (TensorFlow)", readme: "A reference implementation of two-tower retrieval with in-batch negatives, logQ correction and hard-negative mining in TensorFlow, with an evaluation harness for recall@k on MovieLens-25M." },
      ],
    },
    leetcode: {
      username: "sanjay_km", solved: [80, 60, 10], preferredLanguage: "python3", last30Days: 0,
      topics: { "Array": 60, "Hash Table": 40, "String": 30, "Dynamic Programming": 25, "Math": 25, "Sorting": 20, "Tree": 15, "Graph": 12, "Binary Search": 12 },
    },
  },

  // ------------------------------------------------------------------ principal (12–16 years)
  {
    slug: "suresh-balasubramanian", name: "Suresh Balasubramanian", level: "principal", tier: 3,
    probe: "Principal at Infosys, 16 years, enterprise Java for banking clients; resume only, no platforms",
    expectedSpecialization: "backend", expectedDomains: ["fintech"],
    headline: "Principal Technology Architect at Infosys · banking platforms",
    location: "Chennai, Tamil Nadu",
    education: [edu("Anna University, Chennai", "B.E.", "Computer Science and Engineering", 2006, 2010, "First class with distinction")],
    experience: [
      job("Infosys", "Principal Technology Architect", "2019-04", "Present", "Chennai", [
        "Architecture owner for a European bank's core banking modernisation: 180 Java and Spring Boot microservices on Azure Kubernetes Service, Kafka and Oracle; led a 120-engineer programme",
        "Defined the API gateway, event streaming and data-migration standards reused across four banking accounts",
        "Review architecture for the Financial Services unit; mentor 15 architects",
      ]),
      job("Infosys", "Technology Architect", "2014-06", "2019-03", "Chennai", ["Designed the payments hub for a US bank (Java EE, Oracle, IBM MQ) handling 30M transactions a day"]),
      job("Infosys", "Senior Systems Engineer", "2010-08", "2014-05", "Mysuru", ["Java development and support for a retail banking client's internet banking portal"]),
    ],
    projects: [],
    skills: ["Java", "Spring Boot", "Oracle", "Microservices", "Kafka", "Azure", "Kubernetes", "Architecture", "TOGAF", "API design", "System Design"],
    achievements: ["TOGAF 9 Certified", "Infosys Awards for Excellence 2022: Delivery Excellence"],
  },
  {
    slug: "kavya-raghunath", name: "Kavya Raghunath", level: "principal", tier: 1,
    probe: "Principal at Zerodha (ex-Zoho, Amazon): trading systems in Go/Python; listmonk PR",
    expectedSpecialization: "backend", expectedDomains: ["fintech", "saas", "e-commerce"],
    headline: "Principal Engineer at Zerodha · trading and order systems",
    location: "Bengaluru, Karnataka",
    education: [edu("National Institute of Technology, Warangal", "B.Tech", "Computer Science and Engineering", 2008, 2012, "9.0 CGPA")],
    experience: [
      job("Zerodha", "Principal Engineer", "2020-07", "Present", "Bengaluru", [
        "Own the architecture of the order management system that places 1.5M trades a day: Go services, PostgreSQL, Redis, Kafka; p99 order acknowledgement 12 ms",
        "Led the exchange-connectivity rewrite (NSE and BSE FIX gateways) and the move to a Kubernetes platform with zero trading-hour downtime",
        "Set the engineering standards for a 40-person team that runs with no managers",
      ]),
      job("Zoho", "Engineering Lead", "2014-08", "2020-06", "Chennai", [
        "Led the backend team for Zoho CRM, a SaaS used by 250k businesses: Java services, MySQL sharding, the activity-stream service at 50k events/s",
      ]),
      job("Amazon", "Software Development Engineer", "2012-07", "2014-07", "Bengaluru", ["Worked on the seller catalogue ingestion pipeline in Java"]),
    ],
    projects: [
      project("pg-partman-ops", "Runbooks and tooling for time-partitioned PostgreSQL tables at scale.", ["Go", "PostgreSQL"], ["Automates partition creation, detachment and archival to S3"], "https://github.com/kavyar/pg-partman-ops"),
    ],
    skills: ["Go", "Python", "PostgreSQL", "Kafka", "Redis", "Linux", "System Design", "Architecture", "Kubernetes", "Java", "Distributed Systems"],
    achievements: ["Speaker, GopherCon India 2025 keynote: 'Boring systems that trade'"],
    github: {
      login: "kavyar", joinedYear: 2011, activity: "medium",
      languages: [["Go", 60], ["Python", 35], ["Shell", 5]],
      repos: [
        { name: "pg-partman-ops", stars: 88, primaryLang: "Go", description: "Operate time-partitioned PostgreSQL tables: create, detach, archive", readme: "pg-partman-ops creates upcoming partitions, detaches old ones, archives them to S3 as Parquet and verifies row counts, with a dry-run mode and Prometheus metrics. Built for ledger tables that grow by 100M rows a month." },
      ],
      mergedPRs: [{ repo: "knadh/listmonk", stars: 16_000, additions: 203, deletions: 40, changedFiles: 8, title: "Add per-campaign send-rate limits with a token bucket", mergedAt: "2024-04-16T09:10:00.000Z" }],
    },
    leetcode: {
      username: "kavya_r", solved: [110, 110, 20], preferredLanguage: "golang", last30Days: 0,
      topics: { "Array": 100, "Hash Table": 65, "String": 50, "Dynamic Programming": 35, "Tree": 35, "Graph": 25, "Binary Search": 25, "Sorting": 35, "Math": 30, "Stack": 20, "Heap (Priority Queue)": 12, "Linked List": 18, "Greedy": 25 },
    },
  },
  {
    slug: "deepak-verma", name: "Deepak Verma", level: "principal", tier: 1,
    probe: "Principal at Flipkart (ex-Myntra, Amazon): search and catalogue platforms; Elasticsearch PR",
    expectedSpecialization: "backend", expectedDomains: ["e-commerce"],
    headline: "Principal Engineer at Flipkart · search and catalogue",
    location: "Bengaluru, Karnataka",
    education: [edu("Indian Institute of Technology, Kanpur", "B.Tech", "Computer Science and Engineering", 2007, 2011, "8.8 CGPA")],
    experience: [
      job("Flipkart", "Principal Engineer", "2021-05", "Present", "Bengaluru", [
        "Architect for product search and the catalogue platform: Java and Scala services, Kafka, Elasticsearch clusters holding 400M listings; search p99 under 120 ms at 80k QPS during the Big Billion Days sale",
        "Led the move of the product catalog to an event-sourced model across six teams; catalogue update latency from hours to under a minute",
        "Sit on the company architecture board; set the retrieval and ranking platform strategy for three years",
      ]),
      job("Myntra", "Senior Architect", "2016-02", "2021-04", "Bengaluru", ["Built Myntra's search relevance platform (learning-to-rank on Elasticsearch, Spark feature pipelines); conversion from search up 11%"]),
      job("Amazon", "Software Development Engineer → Senior SDE", "2011-07", "2016-01", "Bengaluru", ["Worked on catalogue classification and the product matching pipeline in Java and Hadoop"]),
    ],
    projects: [],
    skills: ["Java", "Scala", "Kafka", "Elasticsearch", "Cassandra", "Distributed Systems", "System Design", "Architecture", "GCP", "Spark"],
    achievements: ["Flipkart Technical Excellence award 2023", "Two patents on catalogue matching"],
    github: {
      login: "deepakv", joinedYear: 2012, activity: "low",
      languages: [["Java", 70], ["Scala", 20], ["Python", 10]],
      repos: [
        { name: "es-shard-balancer", stars: 64, primaryLang: "Java", description: "Rebalance Elasticsearch shards by observed load, not shard count", readme: "Collects per-shard search and indexing load from node stats and proposes relocations that even out load across nodes, respecting awareness attributes and a maximum concurrent relocation count." },
      ],
      mergedPRs: [{ repo: "elastic/elasticsearch", stars: 70_000, additions: 160, deletions: 28, changedFiles: 6, title: "Avoid redundant fetch phase when all sort fields are doc values", mergedAt: "2024-09-27T11:25:00.000Z" }],
    },
    leetcode: {
      username: "deepak_v", solved: [150, 170, 30], preferredLanguage: "java", last30Days: 0,
      contest: { attended: 12, rating: 1650, topPercent: 17 },
      topics: { "Array": 140, "Hash Table": 95, "String": 80, "Dynamic Programming": 55, "Tree": 50, "Graph": 35, "Binary Search": 35, "Sorting": 55, "Math": 40, "Stack": 25, "Heap (Priority Queue)": 15, "Linked List": 25, "Greedy": 35, "Trie": 9, "Depth-First Search": 38 },
    },
  },

  // ------------------------------------------------------------------ distinguished (15+ years)
  {
    slug: "lakshmi-narayanan", name: "Lakshmi Narayanan", level: "distinguished", tier: 2,
    probe: "Distinguished engineer at Microsoft: storage engines, C++/Rust, patents; no product domain, no SQL, no LeetCode. Strong, but a weaker fit for web-backend listings than the fintech and logistics leaders",
    expectedSpecialization: "backend", expectedDomains: [],
    headline: "Distinguished Engineer at Microsoft · distributed storage",
    location: "Hyderabad, Telangana",
    education: [
      edu("Indian Institute of Technology, Bombay", "Ph.D.", "Computer Science", 2004, 2009, null),
      edu("Indian Institute of Technology, Bombay", "B.Tech", "Computer Science and Engineering", 2000, 2004, "9.4 CGPA"),
    ],
    experience: [
      job("Microsoft", "Distinguished Engineer", "2019-03", "Present", "Hyderabad", [
        "Technical strategy for a cloud platform's distributed storage: the log-structured storage engine (C++ and Rust), erasure coding and the consensus layer that keeps exabytes durable at eleven nines",
        "Led the multi-year replacement of the replication protocol across 20 teams with no customer-visible downtime; tail latency down 45%",
        "Set the engineering direction for 600 engineers; chair the storage architecture review board",
      ]),
      job("Microsoft", "Partner Software Architect", "2013-02", "2019-02", "Hyderabad", ["Designed the metadata service for a globally distributed object store; Paxos-based with regional failover"]),
      job("Yahoo", "Senior Research Engineer", "2009-07", "2013-01", "Bengaluru", ["Worked on the Hadoop HDFS NameNode's scalability and the Sherpa key-value store"]),
    ],
    projects: [],
    skills: ["C++", "Rust", "Distributed Systems", "Storage systems", "Consensus (Raft, Paxos)", "System Design", "Architecture", "Technical strategy", "Performance engineering"],
    achievements: ["12 granted US patents in distributed storage", "ACM Distinguished Member (2022)", "Keynote, USENIX FAST 2025"],
    github: {
      login: "lakshmin", joinedYear: 2011, activity: "low",
      languages: [["C++", 60], ["Rust", 30], ["Python", 10]],
      repos: [
        { name: "raft-rs-notes", stars: 120, primaryLang: "Rust", description: "Annotated Raft implementation in Rust with Jepsen-style tests", readme: "An annotated Raft implementation in Rust: leader election, log replication, snapshotting and membership changes, with deterministic simulation tests that inject partitions and clock skew." },
      ],
      mergedPRs: [
        { repo: "apache/arrow", stars: 15_000, additions: 310, deletions: 44, changedFiles: 9, title: "C++: vectorised run-length decoding for the Parquet reader", mergedAt: "2024-06-18T08:00:00.000Z" },
        { repo: "facebook/rocksdb", stars: 29_000, additions: 118, deletions: 21, changedFiles: 5, title: "Fix compaction priority starvation for cold column families", mergedAt: "2025-02-03T17:30:00.000Z" },
      ],
    },
  },
  {
    slug: "rajesh-khanna", name: "Rajesh Khanna", level: "distinguished", tier: 2,
    probe: "24-year logistics technology leader (Delhivery, Ola, Amazon, Infosys); minimal GitHub, no LeetCode",
    expectedSpecialization: "backend", expectedDomains: ["logistics", "e-commerce"],
    headline: "Distinguished Engineer at Delhivery · logistics platforms",
    location: "Gurugram, Haryana",
    education: [edu("Manipal Institute of Technology, Manipal", "B.E.", "Computer Science and Engineering", 1998, 2002, "First class")],
    experience: [
      job("Delhivery", "Distinguished Engineer", "2018-06", "Present", "Gurugram", [
        "Technical strategy for the logistics network: the routing engine, fleet and hub systems that move 3M shipments a day; Java and Go services on Kafka and PostgreSQL across 30 teams",
        "Designed the address-intelligence platform (geocoding, H3 serviceability) that cut failed deliveries 21%",
        "Advise the board on technology investment; built the architecture guild and the principal-engineer track",
      ]),
      job("Ola", "Head of Engineering, Platform", "2014-04", "2018-05", "Bengaluru", ["Led the ride-hailing dispatch and pricing platforms through the growth from 20 to 110 cities"]),
      job("Amazon", "Principal Engineer", "2008-09", "2014-03", "Hyderabad", ["Worked on fulfilment-centre software and the transportation planning systems"]),
      job("Infosys", "Senior Software Engineer", "2002-07", "2008-08", "Bengaluru", ["Java development for supply-chain clients"]),
    ],
    projects: [],
    skills: ["Java", "Go", "Kafka", "PostgreSQL", "Distributed Systems", "Architecture", "Technical strategy", "Kubernetes", "GCP", "System Design"],
    achievements: ["ET Logistics Technology Leader of the Year, 2023"],
    github: {
      login: "rajeshk", joinedYear: 2015, activity: "low",
      languages: [["Go", 50], ["Java", 50]],
      repos: [
        { name: "geo-h3-tools", stars: 42, primaryLang: "Go", description: "Serviceability and coverage utilities on Uber H3", readme: "Utilities for logistics coverage on H3: polyfill serviceable areas, compute k-ring neighbours for hub assignment, and export GeoJSON for maps. Used in address-intelligence prototypes." },
      ],
    },
  },
  {
    slug: "farah-siddiqui", name: "Farah Siddiqui", level: "distinguished", tier: 2,
    probe: "Distinguished engineer at PhonePe (ex-HDFC Bank, Oracle FSS): core banking and UPI; resume only",
    expectedSpecialization: "backend", expectedDomains: ["fintech"],
    headline: "Distinguished Engineer at PhonePe · payments and banking systems",
    location: "Mumbai, Maharashtra",
    education: [edu("Aligarh Muslim University", "B.Tech", "Computer Engineering", 2003, 2007, "First class with distinction")],
    experience: [
      job("PhonePe", "Distinguished Engineer", "2021-09", "Present", "Bengaluru", [
        "Technical strategy for the UPI switch and the banking integrations: Java and Spring Boot services, Kafka and Aerospike, 400M transactions a day with bank-side failover across 50 partner banks",
        "Led the design of the credit-line-on-UPI platform with three banks and NPCI; live within nine months",
        "Chair the architecture council for payments; mentor principal engineers",
      ]),
      job("HDFC Bank", "Senior Vice President, Technology", "2015-05", "2021-08", "Mumbai", ["Owned the core banking and payments architecture: UPI, IMPS and NEFT systems on Java, Oracle and IBM MQ; led the UPI 2.0 programme"]),
      job("Oracle Financial Services Software", "Architect", "2007-07", "2015-04", "Mumbai", ["Built lending and core banking modules of a banking product used by 60 banks (Java, Oracle, PL/SQL)"]),
    ],
    projects: [],
    skills: ["Java", "Spring Boot", "Oracle", "Kafka", "Aerospike", "Microservices", "System Design", "Architecture", "Security", "Compliance", "Payments"],
    achievements: ["NPCI UPI Excellence award, 2024", "Fellow, Institution of Engineers (India)"],
  },
];
