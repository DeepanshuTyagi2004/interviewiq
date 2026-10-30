import type { CompanyIn, RoundIn } from "./types.js";

// ---- Razorpay ----
const R = {
  iq: "https://www.interviewquery.com/guides/razorpay-software-engineer",
  fr: "https://www.finalroundai.com/blog/razorpay-interview-process",
  hld: "https://spacecomplexity.ai/blog/razorpay-system-design-interview",
  onsite: "https://spacecomplexity.ai/blog/razorpay-onsite-interview",
  thita: "https://thita.ai/blog/interview/razorpay-interview-questions-and-process",
  hire: "https://hirestepx.com/blog/razorpay-interview-questions-2026",
  gfg: "https://www.geeksforgeeks.org/interview-experiences/razorpay-interview-experience-for-sde-on-campus-2022/",
  gd: "https://www.glassdoor.co.in/Reviews/Razorpay-Reviews-E1146550.htm",
  ab: "https://www.ambitionbox.com/reviews/razorpay-reviews/associate-manager",
  fin: "https://yespress.io/razorpay",
  ipo: "https://www.outlookbusiness.com/news/razorpay-kicks-off-ipo-preparations-for-4500cr-listing-invites-bank-pitches",
  gd24a: "https://www.glassdoor.com/Interview/Razorpay-Interview-E1146550-RVW86702348.htm",
  gd24b: "https://www.glassdoor.ca/Interview/Razorpay-Interview-E1146550-RVW87144782.htm",
  gd24c: "https://www.glassdoor.com/Interview/Razorpay-Interview-E1146550-RVW85483249.htm",
};
const rOa = (): RoundIn => ({
  name: "Online assessment", type: "dsa", minutes: 75, difficulty: "medium",
  topics: ["Arrays", "Strings", "Hashing", "Greedy", "Dynamic programming"],
  guidance: "Two medium DSA problems in 60-90 minutes. It filters for the live coding rounds.",
  src: [R.fr, R.iq],
});
const rDsa = (n: number, hard: boolean): RoundIn => ({
  name: `DSA live coding ${n}`, type: "dsa", minutes: 60, difficulty: hard ? "hard" : "medium",
  topics: hard ? ["Graphs", "Advanced dynamic programming", "Data structure design"] : ["Arrays", "Trees", "Hashing", "Binary search"],
  guidance: hard
    ? "60-minute round with a harder problem (graphs, advanced DP or data structure design). Described as the primary bar-setting round at Razorpay."
    : "60-minute round with two LeetCode-medium problems. Clean code, edge cases and complexity analysis are expected.",
  src: [R.fr, R.onsite, R.iq],
});
const rMachine = (): RoundIn => ({
  name: "Machine coding / LLD", type: "lld", minutes: 105, difficulty: "hard",
  topics: ["SOLID principles", "Extensibility", "Clean code", "Concurrency basics"],
  questions: ["Rate limiter", "Payment ledger", "Expense splitter", "Rating system", "In-memory SQL database"],
  guidance: "90-120 minute round to build a working system from a product spec. Graded on SOLID principles, extensibility, modularity and clean code.",
  src: [R.fr, R.onsite, R.thita, R.gd24a, R.gd24b],
});
const rHld = (hardFlag = true): RoundIn => ({
  name: "System design (HLD)", type: "system-design", minutes: 75, difficulty: hardFlag ? "hard" : "medium",
  topics: ["Payment gateway design", "Rate limiting", "Fraud detection", "Distributed transactions", "Idempotency", "Monitoring and schema evolution"],
  questions: ["Quick-commerce app like Zepto", "Scheduler service that runs tasks at a timestamp with callbacks, errors and retries"],
  guidance: "60-90 minute round that uses Razorpay's real domain: payment flows, rate limiting, fraud detection and distributed transactions. SDE-2 faces HLD and machine coding as independent gates; senior candidates add operational depth on monitoring and schema evolution.",
  src: [R.hld, R.fr, R.gd24c, R.gd24a],
});
const rHm = (): RoundIn => ({
  name: "Hiring manager and HR", type: "hiring-manager", minutes: 45, difficulty: "medium",
  topics: ["Project deep-dive", "Ownership", "Team fit", "Compensation expectations"],
  guidance: "Resume-driven discussion with the hiring manager followed by an HR conversation. The process is described as practical and sometimes inconsistent across teams.",
  src: [R.fr, R.iq],
});

const razorpay: CompanyIn = {
  name: "Razorpay", slug: "razorpay", tier: 2,
  tierRationale: "SDE-1 reported at about ₹20-35 LPA total, at the top of the Tier 2 band and the boundary of Tier 1. Product-company loop with DSA, machine coding and domain system design.",
  hq: "Bengaluru, India", size: "About 4,000 employees (Bengaluru)",
  website: "https://razorpay.com", aliases: ["Razorpay Software", "Razorpay Software Private Limited"],
  sector: "fintech", businessModel: "product", headcountBand: "About 4,000 (Bengaluru)",
  revenueBand: "FY25 ~₹3,783 crore (+65%)", fundingStage: "late-stage",
  wlbRating: 3.5, wlbReviewCount: 476,
  reviewSummary: "Rated 3.6/5 overall on AmbitionBox from 476 reviews, work-life balance 3.5/5 (promotions lowest at 2.9/5). Glassdoor shows 3.4/5 from 1,284 reviews with 62% recommending. Reviews are mixed: some praise culture and perks, others report long hours and deliverable pressure on weekends.",
  reviewQuotes: [],
  overview: "Razorpay is a Bengaluru payments and fintech infrastructure company processing payments, banking and lending for businesses. FY25 revenue was about ₹3,783 crore; it has raised roughly $742 million, last valued at $7.5 billion in 2021, and is preparing an IPO.",
  culture: "Fast-moving, ownership-heavy engineering culture that hires from freshers through staff; interviews are practical and domain-relevant, with machine coding as a signature round.",
  benefits: "Base salary plus ESOPs (ESOP expense of ₹1,209 crore in FY25 shows heavy equity use); total CTC ranges from SDE-1 to Staff are reported in the next sections.",
  src: [R.gd, R.ab, R.fin, R.ipo],
  roles: [
    {
      key: "sde1", title: "Software Development Engineer I", level: "fresher", spec: "backend",
      description: "SDE-1 at Razorpay (0-2 years). Build and ship backend services in the payments stack, write tested code, join design and code reviews and learn to operate high-throughput financial systems. Expect hard-level DSA and a machine coding round; HLD may be skipped at this level.",
      stack: ["Java", "Go", "PHP", "MySQL", "Kafka", "Redis", "Data Structures"],
      yoe: [0, 2], ctc: [20, 35], src: [R.iq, R.fr, R.hire],
      rounds: [rOa(), rDsa(1, false), rDsa(2, true), rMachine(), rHm()],
    },
    {
      key: "sde2", title: "Software Development Engineer II", level: "sde2", spec: "backend",
      description: "SDE-2 at Razorpay (2-5 years). Own services in the payments platform, lead features end to end, design for idempotency and reliability and mentor SDE-1s. Both machine coding and HLD are separate gates.",
      stack: ["Go", "Java", "PHP", "MySQL", "Kafka", "Redis", "System Design"],
      yoe: [2, 5], ctc: [35, 65], src: [R.iq, R.fr, R.hld],
      rounds: [rOa(), rDsa(1, false), rMachine(), rHld(), rHm()],
    },
    {
      key: "sde3", title: "Senior Software Development Engineer (SDE-3)", level: "sde3", spec: "backend",
      description: "Senior SDE at Razorpay (5+ years). Lead design of large cross-team features in the payments platform, own reliability and observability, mentor engineers and influence the roadmap with the engineering manager.",
      stack: ["Go", "Java", "Distributed Systems", "Kafka", "System Design", "Observability"],
      yoe: [5, 9], ctc: [65, 110], src: [R.iq, R.fr, R.hld],
      rounds: [rDsa(1, true), rMachine(), rHld(), rHm()],
    },
    {
      key: "staff", title: "Staff Software Engineer", level: "staff", spec: "backend",
      description: "Staff-level engineer at Razorpay (8+ years). Set technical direction for a platform area, drive cross-team architecture and long-running reliability or migration programmes and raise the engineering bar. The loop reported for senior candidates emphasises operational depth, monitoring and schema evolution.",
      stack: ["Go", "Java", "Distributed Systems", "Architecture", "Data Modelling", "Observability"],
      yoe: [8, 15], ctc: [100, 180], src: [R.iq, R.hld],
      rounds: [rDsa(1, true), rHld(), { ...rHld(), name: "Architecture deep-dive" }, rHm()],
    },
  ],
};

// ---- Swiggy ----
const S = {
  gd: "https://www.glassdoor.com/Interview/Swiggy-Software-Engineer-II-Interview-Questions-EI_IE952680.0,6_KO7,27.htm",
  gdSde: "https://www.glassdoor.com/Interview/Swiggy-Software-Development-Engineer-Interview-Questions-EI_IE952680.0,6_KO7,36.htm",
  gdSr: "https://www.glassdoor.com/Interview/Swiggy-Senior-Software-Engineer-Interview-Questions-EI_IE952680.0,6_KO7,31.htm",
  coding: "https://www.codingkaro.in/jobs-internships/leetcode-interview-experience/Swiggy",
  lets: "https://www.lets-code.co.in/previousyearcodingquestion/swiggy-previous-year-coding-questions/",
  accio: "https://placement.acciojob.com/interview-kit/swiggy-sde-1/",
  naukri: "https://www.naukri.com/code360/interview-experiences/swiggy/interview-experience-dec-2024-exp-0-2-years",
  ab: "https://www.ambitionbox.com/reviews/swiggy-reviews",
  abBlr: "https://www.ambitionbox.com/reviews/swiggy-reviews/bengaluru-location",
  fy25: "https://www.thepeoplesboard.com/news/swiggy-added-2000-employees-in-fy25/",
  ipo: "https://www.restaurantindia.in/news/swiggys-ipo-set-to-launch-expected-to-raise-rs-113274-cr.n11833",
  lcFs: "https://leetcode.com/discuss/post/7143750/swiggy-interview-experience-full-stack-s-2d0c/",
  lcRej: "https://leetcode.com/discuss/post/7383296/swiggy-sde-2-backend-interview-experienc-ic7h/",
  lcSde2: "https://leetcode.com/discuss/post/8314817/swiggy-sde-2-by-anonymous_user-izkb/",
  lc4y: "https://leetcode.com/discuss/post/7197132/swiggy-sde-2-interview-exp-4-yrs-exp-by-4wadv/",
  gd26: "https://www.glassdoor.co.nz/Interview/Swiggy-Interview-E952680-RVW104022538.htm",
  roundz: "https://roundz.substack.com/p/interview-experience-123-swiggy-sde3-l8",
};
const sOa = (): RoundIn => ({
  name: "Online assessment", type: "dsa", minutes: 90, difficulty: "medium",
  topics: ["Arrays", "Graphs", "Dynamic programming", "Trees"],
  guidance: "Three medium coding questions on an online assessment platform.",
  src: [S.accio, S.coding],
});
const sMachine = (): RoundIn => ({
  name: "Machine coding round", type: "lld", minutes: 100, difficulty: "hard",
  topics: ["Object-oriented design", "SOLID principles", "Modularity", "Extensibility", "Naming and clean code"],
  questions: ["Splitwise", "Cab booking", "Snake and Ladder"],
  guidance: "75-120 minute round implementing a working system from a product requirement. Graded on SOLID principles, modularity, naming and extensibility.",
  src: [S.accio, S.coding, S.lets],
});
const sDsa = (): RoundIn => ({
  name: "DSA round", type: "dsa", minutes: 60, difficulty: "medium",
  topics: ["Graphs", "Dynamic programming (interval scheduling, grid DP)", "Tree traversals"],
  guidance: "Technical round whose DSA focus is heavily graph-oriented, with dynamic programming and tree traversals the most frequent topics.",
  src: [S.accio, S.coding, S.lets],
});
const sHld = (): RoundIn => ({
  name: "System design / HLD", type: "system-design", minutes: 75, difficulty: "hard",
  topics: ["Kafka for async events", "Redis caching", "WebSockets for real-time tracking", "Order and delivery systems", "Inventory consistency"],
  questions: ["Instamart warehouse management system", "Book search", "Train ticket booking system", "BookMyShow", "Promotional notification system"],
  guidance: "60-90 minute round on Swiggy's actual domain systems, with discussion of Kafka for async events, Redis for caching and WebSockets for real-time tracking. Candidates report APIs, database schemas and a high-level diagram, then deep dives on consistency and scale; some rounds combine HLD and LLD.",
  src: [S.accio, S.coding, S.lcFs, S.lcRej, S.lcSde2, S.lc4y, S.gd26, S.roundz],
});
const sHm = (): RoundIn => ({
  name: "Hiring manager round", type: "hiring-manager", minutes: 45, difficulty: "medium",
  topics: ["Behavioural", "Culture fit", "Project deep-dive", "Ownership"],
  guidance: "Behavioural and culture-fit discussion with the hiring manager.",
  src: [S.accio, S.coding],
});

const swiggy: CompanyIn = {
  name: "Swiggy", slug: "swiggy", tier: 2,
  tierRationale: "SDE-I roles reported at about ₹18-24 LPA and experienced SDE-1 around ₹32-35 LPA, squarely in the Tier 2 band for Indian consumer-internet product companies. Four to six rounds including machine coding.",
  hq: "Bengaluru, India", size: "7,431 employees (31 March 2025)",
  website: "https://careers.swiggy.com", aliases: ["Swiggy Limited", "Bundl Technologies", "Instamart"],
  sector: "consumer-internet", businessModel: "product", headcountBand: "7,431 (31 Mar 2025)",
  revenueBand: "FY25 revenue ₹9,429.9 crore", fundingStage: "public",
  wlbRating: 3.5, wlbReviewCount: 4600,
  reviewSummary: "Rated 3.8/5 overall on AmbitionBox from about 4,600 reviews with work-life balance 3.5/5 (3.3/5 for the Bengaluru office). 17% work from home permanently, 47% from office and 36% hybrid; 72% report flexible timing.",
  reviewQuotes: [],
  overview: "Swiggy is a Bengaluru-based food delivery, quick commerce (Instamart) and out-of-home consumption platform, listed on NSE and BSE. It added about 2,000 employees in FY25, driven by Instamart expansion across 100 new cities.",
  culture: "Operations-linked engineering where product decisions meet real-world logistics; interviews weight low-level design and machine coding heavily.",
  benefits: "Base salary plus bonus and ESOPs; experienced SDE-1 total CTC reported at roughly ₹32-35 LPA with base ₹21.5-26 LPA.",
  src: [S.ab, S.abBlr, S.fy25, S.ipo],
  roles: [
    {
      key: "sde1-fresher", title: "Software Development Engineer I (New Grad)", level: "fresher", spec: "backend",
      description: "SDE-I at Swiggy (0-2 years). Build backend services for food delivery, Instamart or logistics, write clean, modular code and own features with mentoring. The process centres on LLD and machine coding.",
      stack: ["Java", "Kotlin", "Python", "Kafka", "Redis", "SQL", "Data Structures"],
      yoe: [0, 2], ctc: [18, 24], src: [S.accio, S.coding, S.gdSde],
      rounds: [sOa(), sMachine(), sDsa(), sHm()],
    },
    {
      key: "sde1-exp", title: "Software Development Engineer I (Experienced)", level: "sde1", spec: "backend",
      description: "Experienced SDE-1 at Swiggy. Own backend features end to end, design clean modular services, and take part in on-call and operational reviews. Base ₹21.5-26 LPA plus bonus and equity.",
      stack: ["Java", "Kotlin", "Kafka", "Redis", "MySQL", "Microservices"],
      yoe: [1, 3], ctc: [32, 35], src: [S.accio, S.gd, S.gdSde],
      rounds: [sOa(), sMachine(), sDsa(), sHm()],
    },
    {
      key: "sde2", title: "Software Development Engineer II", level: "sde2", spec: "backend",
      description: "SDE-2 at Swiggy (2-5 years). Compensation (₹35-50 LPA) is an estimate extrapolated from the reported SDE-1 band. Design and deliver significant services, lead features across teams, mentor SDE-1s and discuss Kafka, Redis and real-time tracking design in the HLD round.",
      stack: ["Java", "Kotlin", "Kafka", "Redis", "WebSockets", "System Design"],
      yoe: [2, 5], ctc: [35, 50], src: [S.accio, S.gd, S.coding],
      rounds: [sMachine(), sDsa(), sHld(), sHm()],
    },
    {
      key: "sde3", title: "Senior Software Engineer (SDE-3)", level: "sde3", spec: "backend",
      description: "Senior software engineer at Swiggy (5+ years). Compensation (₹55-80 LPA) is an estimate for this level. Drive architecture for a domain such as delivery, Instamart or payments, lead cross-team projects, and mentor engineers. System design depth and ownership are the main signals.",
      stack: ["Java", "Kotlin", "Kafka", "Redis", "Distributed Systems", "System Design"],
      yoe: [5, 9], ctc: [55, 80], src: [S.gdSr, S.accio],
      rounds: [sDsa(), sHld(), { ...sHld(), name: "Architecture deep-dive" }, sHm()],
    },
  ],
};

// ---- CRED ----
const C = {
  lc1: "https://leetcode.com/discuss/post/6754564/cred-sde1-bangalore-by-anonymous_user-z53c/",
  lc2: "https://leetcode.com/discuss/post/6696012/",
  lc3: "https://leetcode.com/discuss/post/7390578/",
  lcSde2: "https://leetcode.com/discuss/compensation/1116641/Cred-or-SDE-II-or-Backend-or-Bangalore",
  lcFresh: "https://leetcode.com/discuss/post/1334211/cred-software-engineer-2021-fresh-grad-bangalore/",
  guvi: "https://www.guvi.in/blog/top-5-cred-interview-questions-for-sde-role/",
  gdSal: "https://www.glassdoor.co.in/Salary/CRED-Software-Development-Engineer-SDE-Salaries-E3050300_DAO.htm?filter.jobTitleExact=Software+Development+Engineer+%28SDE%29",
  six: "https://6figr.com/in/salary/cred--software-engineer-sde",
  naukri: "https://www.naukri.com/code360/interview-experiences/cred/interview-experience-nov-2024-exp-0-2-years",
  ab: "https://ambitionbox.com/reviews/cred-reviews",
  fin: "https://entrackr.com/news/cred-reports-rs-2735-cr-revenue-in-fy25-operating-losses-fall-51-11058243",
  inc: "https://inc42.com/company/cred/financials/",
  down: "https://finder.techleap.nl/news/feed/cred-raises-75m-at-lower-valuation",
  lcBe21: "https://leetcode.com/discuss/interview-experience/1627624/cred-backend-engineer-bengaluru-dec-2021-offer",
  gd22: "https://www.glassdoor.com/Interview/CRED-Interview-E3050300-RVW51242161.htm",
  gd22b: "https://www.glassdoor.com.hk/Interview/CRED-Interview-E3050300-RVW67636765.htm",
};
const cRounds = (level: "sde1" | "sde2" | "sde3"): RoundIn[] => [
  {
    name: "Take-home assignment", type: "lld", minutes: 240, difficulty: "medium",
    topics: ["Clean code", "Modular architecture", "API design", "Testing"],
    guidance: "24-hour take-home assignment. CRED reads the code for structure, readability and real-world design thinking, not only correctness. Rounds usually run on consecutive days.",
    src: [C.guvi, C.lc1, C.lc2],
  },
  {
    name: "DSA and puzzles", type: "dsa", minutes: 90, difficulty: level === "sde1" ? "medium" : "hard",
    topics: ["Data structures", "Algorithms", "Puzzles", "Problem decomposition"],
    guidance: "90-minute round of medium-to-hard DSA problems plus puzzles.",
    src: [C.guvi, C.lc1, C.lc3],
  },
  {
    name: "Machine coding (LLD)", type: "lld", minutes: 150, difficulty: "hard",
    topics: ["Object-oriented design", "Extensibility", "Clean code", "Working end-to-end implementation", "In-memory data structures"],
    questions: ["In-memory database with primary and secondary indexes", "Key-value cache", "Simulated microprocessor with registers (set, increment, decrement, move, add)"],
    guidance: "2.5-hour machine coding round, the most CRED-specific round and the one that separates most candidates. Judged on clean, modular, extensible code that runs; one rejected candidate blamed code that did not fully follow OOP principles.",
    src: [C.guvi, C.lc1, C.lc2, C.lcBe21, C.gd22, C.naukri],
  },
  {
    name: level === "sde1" ? "System design and managerial (Head of Engineering)" : "System design and managerial (Head of Engineering, deeper)",
    type: "system-design", minutes: 90, difficulty: "hard",
    topics: ["System design", "Ownership", "Past projects", "Managerial fit"],
    questions: ["Distributed key-value cache"],
    guidance: "90-minute round with the Head of Engineering combining system design and a managerial conversation.",
    src: [C.guvi, C.lc1, C.gd22b],
  },
];

const cred: CompanyIn = {
  name: "CRED", slug: "cred", tier: 2,
  tierRationale: "SDE-1 reported with base about ₹37.8 LPA plus ESOPs; high pay but a small, highly selective engineering team with a four-round loop heavy on machine coding. Placed in Tier 2 as an Indian product company.",
  hq: "Bengaluru, India", size: "About 2,277 employees (one source)",
  website: "https://cred.club", aliases: ["CRED Club", "Dreamplug Technologies"],
  sector: "fintech", businessModel: "product", headcountBand: "About 2,277 (one source)",
  revenueBand: "FY25 ₹2,735 crore (+16%)", fundingStage: "late-stage",
  wlbRating: 2.9, wlbReviewCount: 132,
  reviewSummary: "Work-life balance 2.9/5 on AmbitionBox (132 reviews); Indeed shows 3.9/5 for work-life balance. Valuation was cut from $6.4 billion (2022) to about $3.6 billion in a May 2025 down round led by GIC, while FY25 operating losses fell 51%.",
  reviewQuotes: [],
  overview: "CRED is a Bengaluru credit-card payments and rewards platform for creditworthy users, expanding into lending and commerce. It reported ₹2,735 crore operating revenue in FY25 and has raised over $1 billion.",
  culture: "Quality-obsessed engineering culture that values clean code, modular architecture and real-world design; interviews are a fast four-round sequence, often on consecutive days.",
  benefits: "Fixed salary plus ESOPs vesting over four years; reported SDE-1 base ₹37.8 LPA with ESOPs of about ₹40 lakh, SDE-2 fixed ₹38 LPA plus ₹13.5 lakh stock, SDE-3 fixed ₹70 LPA plus ₹1 crore ESOP.",
  src: [C.ab, C.fin, C.inc, C.down],
  roles: [
    {
      key: "sde1", title: "Software Development Engineer I", level: "sde1", spec: "backend",
      description: "SDE-1 at CRED. Build backend services behind the CRED app, write clean modular code and own features with a small, senior team. A take-home assignment and a machine coding round are central to selection.",
      stack: ["Kotlin", "Java", "Go", "SQL", "Microservices", "Data Structures"],
      yoe: [0, 2], ctc: [38, 48], src: [C.lc1, C.lcFresh, C.six, C.guvi],
      rounds: cRounds("sde1"),
    },
    {
      key: "sde2", title: "Software Development Engineer II (Backend)", level: "sde2", spec: "backend",
      description: "SDE-2 (Backend) at CRED. Design and own backend services, lead projects with the Head of Engineering and mentor SDE-1s. Reported fixed pay about ₹38 LPA plus stock over four years.",
      stack: ["Kotlin", "Java", "Go", "SQL", "Kafka", "System Design"],
      yoe: [2, 5], ctc: [38, 52], src: [C.lcSde2, C.gdSal, C.guvi],
      rounds: cRounds("sde2"),
    },
    {
      key: "sde3", title: "Senior Software Development Engineer (SDE-3)", level: "sde3", spec: "backend",
      description: "SDE-3 at CRED. Lead architecture for a product area, make high-leverage design decisions and mentor a team. Reported fixed pay about ₹70 LPA with a ₹1 crore ESOP grant.",
      stack: ["Kotlin", "Java", "Go", "Distributed Systems", "System Design"],
      yoe: [5, 10], ctc: [70, 80], src: [C.lc3, C.six, C.guvi],
      rounds: cRounds("sde3"),
    },
  ],
};

// ---- Zerodha ----
const Z = {
  gfg: "https://www.geeksforgeeks.org/zerodha-recruitment-process/",
  dg: "https://www.designgurus.io/answers/detail/what-is-the-zerodha-interview-process-like-round-by-round",
  gdInt: "https://www.glassdoor.co.in/Interview/Zerodha-Interview-Questions-E823908.htm",
  nk: "https://www.naukri.com/campus/career-guidance/interview-experience-at-zerodha",
  intern: "https://myinternships.in/internships/zerodha-is-hiring-android-developer-intern-bengaluru-osef8",
  gdSal: "https://www.glassdoor.co.in/Salary/Zerodha-Software-Developer-Salaries-E823908_D_KO8,26.htm",
  sde2: "https://1kstartup.com/salary/zerodha-sde-2-salary",
  ab: "https://ambitionbox.com/reviews/zerodha-reviews",
  gd: "https://www.glassdoor.co.in/Reviews/Zerodha-Reviews-E823908.htm",
  fin: "https://entrackr.com/fintrackr/zerodha-cash-reserve-stands-at-rs-22679-cr-in-fy25-10799921",
  wiki: "https://en.wikipedia.org/wiki/Zerodha",
  yourstory: "https://yourstory.com/2026/08/zerodha-marks-16-years-with-steady-profits",
};
const zRounds = (depth: "intern" | "dev" | "senior"): RoundIn[] => [
  {
    name: "Recruiter / HR conversation", type: "hiring-manager", minutes: 30, difficulty: "easy",
    topics: ["Background", "Motivation", "Notice period"],
    guidance: "About 30-minute call covering your background, why Zerodha and logistics such as notice period. Applications go through the careers-site form; public code and side projects count more than titles.",
    src: [Z.gfg, Z.dg],
  },
  {
    name: "Practical task", type: "lld", minutes: 240, difficulty: depth === "intern" ? "easy" : "medium",
    topics: ["Small working program", "Code clarity", "Language fundamentals"],
    guidance: "Engineering candidates get a small practical task instead of algorithm puzzles, done on your own time. The follow-up conversations start from what you built.",
    src: [Z.gfg, Z.dg],
  },
  {
    name: "Technical conversations", type: "system-design", minutes: 60, difficulty: depth === "senior" ? "hard" : "medium",
    topics: ["Projects in depth", "Languages", "Databases", "Systems"],
    guidance: "One to three video or in-person sessions that begin with your own projects and go into languages, databases and systems. The CTO has described these as free-flowing conversations.",
    src: [Z.gfg, Z.dg],
  },
  {
    name: "Final fit conversation", type: "behavioural", minutes: 45, difficulty: "easy",
    topics: ["Working style", "Expectations of the work"],
    guidance: "Closing conversation about working style and expectations before a decision, a few weeks after applying.",
    src: [Z.gfg, Z.dg],
  },
];

const zerodha: CompanyIn = {
  name: "Zerodha", slug: "zerodha", tier: 2,
  tierRationale: "Salary reports are sparse and conflict (a Glassdoor software-developer median of about ₹6.7 LPA from 7 salaries versus SDE-2 base around ₹21 LPA), so tier reflects Zerodha's profitability, selectivity and project-driven hiring, not a pay median.",
  hq: "Bengaluru, India", size: "About 2,872 employees (one source)",
  website: "https://zerodha.com", aliases: ["Zerodha Broking", "Zerodha Broking Limited"],
  sector: "fintech", businessModel: "product", headcountBand: "About 2,872 (one source)",
  revenueBand: "FY25 ₹8,847 crore", fundingStage: "bootstrapped",
  wlbRating: 3.9, wlbReviewCount: 128,
  reviewSummary: "4.4/5 on Glassdoor from 166 reviews (87% recommend) and 4.1/5 on AmbitionBox from 128 reviews with work-life balance 3.9/5. Fresher pay data is thin; reported Glassdoor developer pay ranges from about ₹4.2 to ₹10 LPA.",
  reviewQuotes: [],
  overview: "Zerodha is India's largest retail stockbroker by active clients, a bootstrapped company that has never raised external funding. FY25 revenue was ₹8,847 crore with ₹4,237 crore net income, run by a notably small in-house technology team.",
  culture: "Small-team, engineering-led culture that hires on evidence of what you have built: public code and projects matter more than titles, and interviews are conversations rather than algorithm drills.",
  benefits: "Reported developer pay is modest at junior levels (Glassdoor ₹4.2-10 LPA from a small sample) and higher at SDE-2 (average base about ₹21 LPA). No venture-funded ESOP structure since the company is bootstrapped.",
  src: [Z.ab, Z.gd, Z.fin, Z.wiki, Z.yourstory],
  roles: [
    {
      key: "android-intern", title: "Android Developer Intern", level: "intern", spec: "android",
      description: "Android developer intern at Zerodha, Bengaluru. Work on the trading app alongside the mobile team. Stipend shown (₹3.0-4.2 LPA equivalent) is an estimate from typical early-stage startup internship pay of ₹15,000-35,000 a month. Selection is conversation- and project-driven rather than puzzle-driven.",
      stack: ["Kotlin", "Android", "Java", "REST"],
      yoe: [0, 0], ctc: [3.0, 4.2], src: [Z.intern, Z.gfg],
      rounds: zRounds("intern"),
    },
    {
      key: "dev", title: "Software Developer", level: "sde1", spec: "fullstack",
      description: "Software developer at Zerodha. Build and maintain trading, back-office and investor products with a small team, with end-to-end ownership of what you ship. Evidence of real projects and public code is weighted heavily.",
      stack: ["Go", "Python", "PostgreSQL", "Redis", "JavaScript", "Linux"],
      yoe: [0, 3], ctc: [4.2, 10], src: [Z.gdSal, Z.gfg, Z.dg],
      rounds: zRounds("dev"),
    },
    {
      key: "sde2", title: "Software Development Engineer II (SDE-2)", level: "sde2", spec: "backend",
      description: "SDE-2 at Zerodha. Own systems end to end in a small engineering team, make technology choices and operate them in production. Reported average base pay is about ₹21 LPA.",
      stack: ["Go", "Python", "PostgreSQL", "Redis", "Kafka", "Distributed Systems"],
      yoe: [2, 6], ctc: [21, 28], src: [Z.sde2, Z.gfg, Z.dg],
      rounds: zRounds("senior"),
    },
  ],
};

// ---- PhonePe ----
const P = {
  lcSde1: "https://leetcode.com/discuss/post/6437867/my-phonepe-sde-1-interview-experience-by-gha9/",
  lcPune: "https://leetcode.com/discuss/post/6680307/phonepe-interview-for-sde1-backend-0-3-y-i9lr/",
  lcSe13: "https://leetcode.com/discuss/post/7286629/phonepe-se-1-3y-interview-experience-by-qdo0q/",
  lc35: "https://leetcode.com/discuss/post/7539137/phonepe-backend-software-engineer-3-5-ye-n5mi/",
  lc57: "https://leetcode.com/discuss/post/7770543/phonepe-software-engineer-5-7-years-bang-tppy/",
  lcCampus: "https://leetcode.com/discuss/interview-experience/5601966/PhonePe-2024-On-Campus-SDE-Interview-Experience/",
  roundz: "https://roundz.substack.com/p/interview-experience-101-phonepe-sde2",
  taroJul: "https://www.jointaro.com/interviews/companies/phonepe/experiences/software-development-engineer-sde-bengaluru-july-1-2025-declined-offer-positive-716ebb73",
  taroSep: "https://www.jointaro.com/interviews/companies/phonepe/experiences/software-engineer-bengaluru-karnataka-september-1-2025-no-offer-neutral-f435d5c3",
  gd1: "https://www.glassdoor.co.in/Interview/PhonePe-Interview-E2289138-RVW92916632.htm",
  gd2: "https://www.glassdoor.com/Interview/PhonePe-Interview-E2289138-RVW103053712.htm",
  offer1: "https://leetcode.com/discuss/compensation/2031858/phonepe-sde-2-bangalore",
  offer2: "https://leetcode.com/discuss/compensation/2874180/PhonePe-or-Software-Engineer-or-Bengaluru",
  abSal: "https://ambitionbox.com/salaries/phonepe-salaries/software-engineer2",
  fy25: "https://entrackr.com/fintrackr/phonepe-posts-rs-7115-cr-revenue-and-rs-630-cr-adjusted-pat-in-fy25-10487742",
  ipo: "https://www.medianama.com/2025/09/223-phonepe-confidential-1-3b-ipo-with-sebi-15b-valuation/",
  ab: "https://ambitionbox.com/reviews/phonepe-reviews",
  roundz130: "https://roundz.substack.com/p/interview-experience-130-phonepe-sde2",
  roundz174: "https://roundz.substack.com/p/interview-experience-174-phonepe-sde2",
  lcSse: "https://leetcode.com/discuss/post/2614003/phonepe-sse-bengaluru-aug-offer",
  lcDec24: "https://leetcode.com/discuss/interview-experience/6293258/",
};
const pMachine = (oa: boolean): RoundIn => ({
  name: oa ? "Machine coding (first round)" : "Machine coding round", type: "lld", minutes: 90, difficulty: "hard",
  topics: ["Modular design", "Exception handling and validation", "Concurrency control", "Testable code", "Extensibility"],
  questions: ["Battleship", "Vehicle rental system", "BookMyShow-style booking system", "Issue management system", "Customer issue resolution system"],
  guidance: "About 90 minutes to build a working system with a modular structure, exception handling, validations and concurrency control; some candidates then have a follow-up on scalability and extensibility. Reports describe PhonePe interviews as code-heavy with a strong focus on modular, testable code.",
  src: [P.roundz, P.taroJul, P.lc35, P.gd1],
});
const pDsa = (senior: boolean): RoundIn => ({
  name: "DSA round", type: "dsa", minutes: 60, difficulty: senior ? "hard" : "medium",
  topics: senior ? ["Stacks", "Graphs", "Dynamic programming", "Disjoint set union"] : ["Arrays", "Strings", "Trees", "Two pointers"],
  questions: senior ? ["Min stack"] : ["Dutch National Flag sorting", "Palindrome check in O(1) space"],
  guidance: senior
    ? "Medium-to-hard problems; campus and experienced reports mention graphs, DP and DSU."
    : "Medium problems on arrays, strings and trees, with an optimal solution and its complexity expected.",
  src: senior ? [P.lcSe13, P.lcCampus, P.gd2] : [P.lcSde1, P.lcPune],
});
const pDesign = (): RoundIn => ({
  name: "Design round", type: "system-design", minutes: 60, difficulty: "hard",
  topics: ["High-level design", "Scalability", "Kafka and asynchronous processing", "REST API design", "Service decomposition", "Database design"],
  questions: ["Shazam-style song recognition from a sound sample", "Seat booking platform", "Movie booking system like BookMyShow",
    "Twitter (post tweet, follow, user timeline, profile)"],
  guidance: "About 60-minute design round after DSA in the experienced loop; SDE-1 candidates were also advised to revise backend design, Kafka and REST.",
  src: [P.roundz, P.lc57, P.lcSde1, P.roundz130, P.roundz174, P.lcSse, P.lcDec24],
});
const pHm = (): RoundIn => ({
  name: "Hiring manager round", type: "hiring-manager", minutes: 45, difficulty: "medium",
  topics: ["Project deep-dive", "Ownership", "Team fit"],
  guidance: "Final round with the hiring manager on past projects and fit.",
  src: [P.roundz, P.lc57],
});

const phonepe: CompanyIn = {
  name: "PhonePe", slug: "phonepe", tier: 2,
  tierRationale: "Self-reported Bengaluru software-engineer offers show ₹48 LPA fixed and above for experienced hires, but fresher pay data is sparse and inconsistent, so it is placed with other Indian fintech product companies in Tier 2. The loop is code-heavy, with machine coding as a gate.",
  hq: "Bengaluru, India", size: "About 12,300 employees (one source)",
  website: "https://www.phonepe.com/careers/", aliases: ["PhonePe Private Limited", "PhonePe Pvt Ltd"],
  sector: "fintech", businessModel: "product", headcountBand: "About 12,300 (one source)",
  revenueBand: "FY25 ₹7,115 crore (+40%)", fundingStage: "subsidiary",
  wlbRating: null, wlbReviewCount: null,
  reviewSummary: "Rated 4.0/5 on AmbitionBox from about 2,200 reviews. Engineers describe strong backend learning at scale, while others mention ad hoc tasks crowding out planned work and unclear growth; no separate work-life balance score was found.",
  reviewQuotes: [],
  overview: "PhonePe is a Walmart-owned UPI payments and financial-services company. FY25 revenue rose about 40% to ₹7,115 crore with adjusted PAT (excluding ESOP costs) of about ₹630 crore; it filed confidential IPO papers with SEBI in September 2025.",
  culture: "Engineering-led culture with code-heavy hiring: machine coding, DSA, design and hiring manager rounds, where modular, testable code is the main signal.",
  benefits: "Self-reported offers list fixed pay plus joining and retention bonuses and ESOPs.",
  src: [P.fy25, P.ipo, P.ab],
  roles: [
    {
      key: "sde1", title: "Software Engineer (SDE-1, Backend)", level: "sde1", spec: "backend",
      description: "Backend Software Engineer at PhonePe (0-3 years). Build payment and platform services in Java, with Kafka and REST APIs. Reports describe an online assessment of four mixed-difficulty problems, then DSA rounds on arrays and trees and a final round on projects and design. Public pay data for this level is inconsistent, so no range is shown.",
      stack: ["Java", "Kafka", "REST APIs", "MySQL", "Data Structures"],
      yoe: [0, 3], ctc: null, src: [P.lcPune, P.lcSde1, P.abSal],
      rounds: [
        {
          name: "Online assessment", type: "dsa", minutes: 90, difficulty: "medium",
          topics: ["Arrays", "Strings", "Trees", "Graphs"],
          guidance: "Reported on CodeSignal with four problems of mixed difficulty.",
          src: [P.lcPune, P.lcSe13],
        },
        pDsa(false), { ...pDsa(false), name: "DSA round 2", questions: [] }, pHm(),
      ],
    },
    {
      key: "se2", title: "Software Engineer II (Backend)", level: "sde2", spec: "backend",
      description: "Backend Software Engineer at PhonePe (about 3-5 years). Own services in the payments stack end to end. The reported loop is machine coding, DSA, design and a hiring manager round; a round may be repeated.",
      stack: ["Java", "Kafka", "REST APIs", "MySQL", "System Design"],
      yoe: [3, 5], ctc: [48, 70], src: [P.offer1, P.offer2, P.lc35, P.roundz],
      rounds: [pMachine(true), pDsa(true), pDesign(), pHm()],
    },
    {
      key: "sse", title: "Senior Software Engineer (Backend)", level: "sde3", spec: "backend",
      description: "Senior backend engineer at PhonePe (about 5-7 years), leading design of high-throughput payment services. A Bangalore candidate who was selected describes the same code-heavy loop with a deeper design discussion.",
      stack: ["Java", "Distributed Systems", "Kafka", "System Design", "Observability"],
      yoe: [5, 7], ctc: null, src: [P.lc57],
      rounds: [pMachine(false), pDsa(true), { ...pDesign(), name: "System design" }, pHm()],
    },
  ],
};

export const TIER2: CompanyIn[] = [razorpay, swiggy, cred, zerodha, phonepe];
