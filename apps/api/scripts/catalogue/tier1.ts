import type { CompanyIn } from "./types.js";

// ---- Google ----
const G = {
  l3: "https://leetcode.com/discuss/post/8543506/google-india-l3-interview-experience-off-1uw5/",
  l4: "https://www.hellointerview.com/guides/google/l4",
  l4In: "https://leetcode.com/discuss/post/6479658/google-l4-swe-3-india-offer-by-leethard-owg3/",
  igo: "https://igotanoffer.com/en/advice/google-l4-interview",
  prep: "https://www.jobrise.io/en/blog/google-interview-preparation-india/",
  comp: "https://jobrise.io/hi/blog/google-india-software-engineer-salary-2026/",
  glassL4: "https://www.glassdoor.co.in/Interview/Google-Software-Engineer-L4-Interview-Questions-EI_IE9079.0,6_KO7,27.htm",
  glassL3: "https://www.glassdoor.co.in/Interview/Google-L3-Software-Engineer-Interview-Questions-EI_IE9079.0,6_KO7,27.htm",
  ab: "https://ambitionbox.com/reviews/google-reviews",
  gd: "https://static.glassdoor.de/Reviews/Google-Reviews-E9079_P15892.htm",
  oyc: "https://www.ownyourcareer.in/companies/google",
};
const gCoding = (n: number, level: string) => ({
  name: `Onsite coding round ${n}`, type: "dsa" as const, minutes: 45, difficulty: (level === "L3" ? "medium" : "hard") as "medium" | "hard",
  topics: ["Arrays and strings", "Graphs and trees", "Dynamic programming", "Hashing", "Complexity analysis"],
  guidance: "45-minute virtual or onsite session on a shared editor or whiteboard. One problem, often with follow-ups that tighten constraints. About 5-10 minutes go to introductions and wrap-up, leaving roughly 36-38 minutes to solve. Interviewers grade problem-solving, coding fluency, testing and communication, not just a correct answer.",
  src: [G.l3, G.igo, G.prep],
});
const gleyness = (src: string[]) => ({
  name: "Googleyness and leadership", type: "behavioural" as const, minutes: 45, difficulty: "medium" as const,
  topics: ["Collaboration", "Ambiguity", "Conflict resolution", "Ownership", "Learning from failure"],
  guidance: "Behavioural round on Googleyness and leadership: tell structured stories (situation, action, result) about working with others, handling ambiguity and disagreeing constructively. It is a pass/fail signal alongside the technical rounds.",
  src,
});
const gScreen = (src: string[]) => ({
  name: "Technical phone screen", type: "dsa" as const, minutes: 45, difficulty: "medium" as const,
  topics: ["Arrays and strings", "Hashing", "Trees", "Complexity analysis"],
  guidance: "30-60 minute coding screen. Expect to write roughly 20-30 lines of working code in your strongest language and explain your approach and complexity as you go.",
  src,
});

const google: CompanyIn = {
  name: "Google", slug: "google", tier: 1,
  tierRationale: "Entry SWE (L3) total compensation reported at roughly ₹35-60 LPA, far above the ₹20 LPA Tier 1 line. Multi-round coding loop with a mandatory hiring assessment and low acceptance rate.",
  hq: "Bengaluru and Hyderabad, India (global HQ: Mountain View, USA)", size: "India headcount not published",
  website: "https://www.google.com", aliases: ["Google India", "Alphabet", "Google LLC"],
  sector: "consumer-internet", businessModel: "product", headcountBand: "Not published (India)",
  revenueBand: "Parent: $100B+ USD / yr", fundingStage: "public",
  wlbRating: 4.4, wlbReviewCount: 1900,
  reviewSummary: "Rated 4.4/5 on AmbitionBox from about 1,900 reviews, with work-life balance also 4.4/5, and 4.4/5 on Glassdoor from 48,530 reviews (87% would recommend). Reviewers praise culture, pay and flexibility; some Glassdoor reviews describe promotion pressure and stress.",
  reviewQuotes: [],
  overview: "Google India runs large engineering centres in Bengaluru and Hyderabad building core products (Search, Ads, Cloud, Android, Chrome, YouTube, Pay). Software engineers are hired at levels L3 to L7 against a common global bar, with Googleyness and system design weighted by level.",
  culture: "Engineering-led, peer-reviewed culture with strong internal mobility, flexible hybrid timings and a high hiring bar. Equity (GSUs) is a large share of total compensation from L4 upwards.",
  benefits: "Total compensation is base + annual bonus + joining bonus + Alphabet RSUs (GSUs) vesting quarterly after a one-year cliff. Campuses include on-site food, health and wellness amenities.",
  src: [G.ab, G.gd, G.comp, G.oyc],
  roles: [
    {
      key: "swe-l3", title: "Software Engineer (L3)", level: "fresher", spec: "backend",
      description: "Entry-level Software Engineer at Google India (L3, 0-2 years). Design, build and test features for large-scale services under the guidance of senior engineers, write well-tested code, review changes and learn Google's engineering practices. Strong data structures and algorithms are the core bar; system design is minimal or absent at this level.",
      stack: ["C++", "Java", "Python", "Go", "Data Structures", "Algorithms"],
      yoe: [0, 2], ctc: [35, 60], src: [G.comp, G.l3, G.glassL3],
      rounds: [
        gScreen([G.l3, G.prep]),
        gCoding(1, "L3"), gCoding(2, "L3"),
        gleyness([G.l3, G.prep]),
      ],
    },
    {
      key: "swe-l4", title: "Software Engineer II (L4)", level: "sde2", spec: "backend",
      description: "Mid-level Software Engineer at Google India (L4, 2-5 years). Own medium-sized features and services end to end, make design trade-offs, mentor newer engineers and drive code quality. Hiring is a mandatory Google Hiring Assessment, a recruiter screen, a technical phone screen and an onsite loop of three to four interviews.",
      stack: ["C++", "Java", "Python", "Go", "Distributed Systems", "Data Structures", "Algorithms"],
      yoe: [2, 5], ctc: [60, 110], src: [G.comp, G.l4, G.l4In, G.igo, G.glassL4],
      rounds: [
        gScreen([G.l4, G.l4In]),
        gCoding(1, "L4"), gCoding(2, "L4"), gCoding(3, "L4"),
        gleyness([G.l4, G.igo]),
      ],
    },
    {
      key: "swe-l5", title: "Senior Software Engineer (L5)", level: "sde3", spec: "backend",
      description: "Senior Software Engineer at Google India (L5, 5-8 years). Lead design and delivery of large cross-team features, make architectural decisions, raise the engineering bar through reviews and mentoring, and own operational quality. System design is part of the loop from L5 upwards.",
      stack: ["C++", "Java", "Go", "Distributed Systems", "System Design", "Data Structures"],
      yoe: [5, 8], ctc: [100, 180], src: [G.comp, G.prep, G.igo],
      rounds: [
        gScreen([G.prep, G.igo]),
        gCoding(1, "L5"), gCoding(2, "L5"),
        {
          name: "System design", type: "system-design", minutes: 45, difficulty: "hard",
          topics: ["Scalability", "Storage and consistency", "Caching", "Queues and async processing", "Failure modes", "Trade-offs"],
          guidance: "Open-ended design of a large-scale system. Clarify requirements, propose an architecture, drill into data model, APIs, scaling and failure handling, and defend trade-offs. Google reserves a dedicated system design round for L5 and above.",
          src: [G.prep, G.igo],
        },
        gleyness([G.prep, G.igo]),
      ],
    },
  ],
};

// ---- Amazon ----
const A = {
  jobsSde2: "https://amazon.jobs/content/en/how-we-hire/sde-ii-interview-prep",
  accio: "https://placement.acciojob.com/interview-kit/amazon-sde-1/",
  exp: "https://www.tryexponent.com/guides/amazon-software-development-engineer-interview",
  kick: "https://interviewkickstart.com/interview-questions/companies/amazon/sde-interview-guide",
  igo: "https://igotanoffer.com/blogs/tech/amazon-software-development-engineer-interview",
  sde2: "https://www.dsaprep.dev/blog/amazon-sde-2-interview-process",
  india: "https://www.crackinterviewai.in/blog/amazon-sde-1-india-interview-experience",
  sal: "https://www.interviewskool.com/blog/amazon-sde1-salary",
  prep: "https://www.placementpreparation.io/amazon/recruitment-process/",
  rehearsal: "https://tryrehearsal.ai/company-interviews/amazon-interview-guide",
  gd: "https://static.glassdoor.fr/Reviews/Amazon-Reviews-E6036_P5.htm",
  ab: "https://www.ambitionbox.com/reviews/amazon-reviews/software-development-engineer/bengaluru-location",
};
const aLp = (src: string[]) => ({
  name: "Bar Raiser (Leadership Principles)", type: "behavioural" as const, minutes: 60, difficulty: "hard" as const,
  topics: ["Customer Obsession", "Ownership", "Dive Deep", "Bias for Action", "Deliver Results", "Earn Trust"],
  guidance: "45-60 minute behavioural deep-dive led by a Bar Raiser, a senior interviewer from outside the hiring team who holds veto power. Prepare 6-8 detailed STAR stories mapped to the Leadership Principles; expect repeated probing on your specific actions and measurable results.",
  src,
});
const aOa = (src: string[]) => ({
  name: "Online Assessment", type: "dsa" as const, minutes: 210, difficulty: "medium" as const,
  topics: ["Arrays", "Strings", "Hashing", "Graphs", "Work simulation", "Work-style assessment"],
  guidance: "3.5-4 hour online assessment after the CV screen: coding problems, a work-simulation module and a work-style (Leadership Principles) questionnaire. A pass moves you into the interview loop.",
  src,
});

const amazon: CompanyIn = {
  name: "Amazon", slug: "amazon", tier: 1,
  tierRationale: "SDE-1 total compensation reported around ₹20-32 LPA, above the ₹20 LPA Tier 1 line, with an online assessment, eliminatory loop and Bar Raiser veto.",
  hq: "Bengaluru, Hyderabad, Chennai, India (global HQ: Seattle, USA)", size: "About 65,000 employees in India (all functions)",
  website: "https://www.amazon.jobs", aliases: ["Amazon India", "Amazon Development Centre India", "AWS India"],
  sector: "e-commerce", businessModel: "product", headcountBand: "India ~65,000 (all functions)",
  revenueBand: "Parent: $100B+ USD / yr", fundingStage: "public",
  wlbRating: 2.2, wlbReviewCount: 65,
  reviewSummary: "Overall 3.5/5 on Glassdoor from 209,497 reviews (60% would recommend). Amazon SDEs in Bengaluru rate it 2.9/5 overall and 2.2/5 for work-life balance on AmbitionBox (65 reviews); on-call load and long hours are the most common complaints.",
  reviewQuotes: [],
  overview: "Amazon's India tech centres build retail, Prime, devices, advertising, supply-chain and AWS services. Engineers are hired as SDE-1, SDE-2 and SDE-3 (Senior), with a loop that weighs coding, design and the Leadership Principles equally.",
  culture: "Ownership-heavy, metrics-driven culture organised around 16 Leadership Principles that surface in every interview and in performance reviews. Two-pizza teams own services end to end, including on-call.",
  benefits: "Base salary plus a RSU grant weighted to later years of vesting, a sign-on bonus in the early years, and medical and wellness cover.",
  src: [A.gd, A.ab, A.sal, A.prep],
  roles: [
    {
      key: "sde1", title: "Software Development Engineer I (SDE-1)", level: "fresher", spec: "backend",
      description: "SDE-1 at Amazon India (0-2 years). Build, test and operate features of services that run at Amazon scale, write clean tested code, take part in design and code reviews, and take on-call responsibility for the service you help own.",
      stack: ["Java", "Python", "C++", "AWS", "Data Structures", "Algorithms", "Object-Oriented Design"],
      yoe: [0, 2], ctc: [20, 32], src: [A.sal, A.accio, A.india, A.igo, A.prep],
      rounds: [
        aOa([A.accio, A.prep, A.kick]),
        {
          name: "Loop 1: Coding + Leadership Principles", type: "dsa", minutes: 60, difficulty: "medium",
          topics: ["Arrays and strings", "Trees and graphs", "Hashing", "Recursion", "Leadership Principles"],
          guidance: "Each loop round is 45-60 minutes on Amazon Chime: a coding problem plus Leadership Principle questions. Rounds are eliminatory, so a weak round ends the loop.",
          src: [A.accio, A.india, A.kick],
        },
        {
          name: "Loop 2: Coding + Object-Oriented Design", type: "lld", minutes: 60, difficulty: "medium",
          topics: ["Object-oriented design", "Data modelling", "API design", "Trade-offs"],
          questions: ["Design a parking lot", "Design a URL shortener", "Design a Twitter feed at small scale", "Design a vending machine"],
          guidance: "SDE-1 system design is lighter than senior rounds: structured thinking, basic data modelling, API design and awareness of trade-offs, usually in the form of an object-oriented design problem.",
          src: [A.accio, A.igo, A.kick],
        },
        aLp([A.accio, A.exp, A.prep]),
      ],
    },
    {
      key: "sde2", title: "Software Development Engineer II (SDE-2)", level: "sde2", spec: "backend",
      description: "SDE-2 at Amazon India (2-5 years). Own the design and delivery of significant service components, lead small projects, make trade-offs across scalability and operational cost, and mentor SDE-1s. Both high-level and low-level design are tested.",
      stack: ["Java", "AWS", "Distributed Systems", "System Design", "Databases", "Object-Oriented Design"],
      yoe: [2, 5], ctc: [35, 55], src: [A.sal, A.jobsSde2, A.sde2, A.rehearsal],
      rounds: [
        aOa([A.jobsSde2, A.prep]),
        {
          name: "Coding round", type: "dsa", minutes: 60, difficulty: "hard",
          topics: ["Graphs", "Dynamic programming", "Heaps", "Trees", "Leadership Principles"],
          guidance: "A coding problem at medium-to-hard difficulty with follow-ups, plus Leadership Principle questions in the same session.",
          src: [A.jobsSde2, A.sde2],
        },
        {
          name: "Low-level design", type: "lld", minutes: 60, difficulty: "hard",
          topics: ["Object-oriented design", "Design patterns", "Class modelling", "Extensibility"],
          guidance: "Model a real system with clear classes, interfaces and extensibility. Interviewers read your code and ask how it changes with new requirements.",
          src: [A.jobsSde2, A.sde2],
        },
        {
          name: "High-level system design", type: "system-design", minutes: 60, difficulty: "hard",
          topics: ["Scalability", "Databases and caching", "Queues", "API design", "Availability"],
          guidance: "Design a distributed system end to end, estimating scale, choosing storage, and discussing failure handling and operational concerns.",
          src: [A.jobsSde2, A.sde2],
        },
        aLp([A.jobsSde2, A.sde2, A.rehearsal]),
      ],
    },
    {
      key: "sde3", title: "Senior Software Development Engineer (SDE-3)", level: "sde3", spec: "backend",
      description: "SDE-3 (Senior SDE) at Amazon India (5+ years). Define the technical direction of a service area, lead multi-team designs, raise operational excellence and mentor engineers across the organisation. System design depth and Leadership Principles carry the most weight.",
      stack: ["Java", "AWS", "Distributed Systems", "System Design", "Architecture", "Operational Excellence"],
      yoe: [5, 10], ctc: [55, 80], src: [A.sal, A.rehearsal, A.kick],
      rounds: [
        {
          name: "Coding round", type: "dsa", minutes: 60, difficulty: "hard",
          topics: ["Graphs", "Dynamic programming", "Concurrency", "Leadership Principles"],
          guidance: "A harder coding problem with an emphasis on clean, production-quality code and complexity discussion.",
          src: [A.rehearsal, A.kick],
        },
        {
          name: "System design 1", type: "system-design", minutes: 60, difficulty: "hard",
          topics: ["Large-scale distributed systems", "Data partitioning", "Consistency", "Capacity estimation"],
          guidance: "Design a large system and defend decisions on partitioning, replication and consistency.",
          src: [A.rehearsal, A.kick],
        },
        {
          name: "System design 2 / architecture deep-dive", type: "system-design", minutes: 60, difficulty: "hard",
          topics: ["Architecture review", "Operational readiness", "Migration strategy", "Cost"],
          guidance: "Deep-dive on a system you have built or a second design problem, with focus on operations, failure modes and organisational impact.",
          src: [A.rehearsal, A.kick],
        },
        aLp([A.rehearsal, A.exp]),
        {
          name: "Hiring manager round", type: "hiring-manager", minutes: 45, difficulty: "medium",
          topics: ["Project deep-dive", "Team fit", "Scope and impact", "Technical leadership"],
          guidance: "Discussion with the hiring manager on your past projects, technical leadership and fit for the team's roadmap.",
          src: [A.accio, A.kick],
        },
      ],
    },
  ],
};

// ---- Microsoft ----
const M = {
  fp: "https://www.faceprep.in/article/microsoft-recruitment-process-for-freshers-faceprep/",
  gfg: "https://www.geeksforgeeks.org/microsoft-interview-experience-sde-i/",
  taro: "https://www.jointaro.com/interviews/companies/microsoft/experiences/sde-1-india-december-1-2024-no-offer-positive-a8f62dc3/",
  rehearsal: "https://www.tryrehearsal.ai/blog/microsoft-india-interview-complete-guide-2026",
  ignition: "https://interviewignition.com/blogs/microsoft-sde-interview-questions/",
  roundz: "https://roundz.substack.com/p/interview-experience-150-microsoft-sde2",
  sal: "https://salaryinsight.in/microsoft-software-engineer-salary/",
  six: "https://6figr.com/in/salary/microsoft--sde-ii-61",
  ab: "https://www.ambitionbox.com/reviews/microsoft-corporation-reviews/software-developer",
  faceprepElig: "https://faceprep.in/article/microsoft-eligibility-criteria-for-freshers-2026/",
};
const mCoding = (n: number, level: "fresher" | "mid" | "senior") => ({
  name: `Technical round ${n}: coding`, type: "dsa" as const, minutes: 60, difficulty: (level === "fresher" ? "medium" : "hard") as "medium" | "hard",
  topics: ["Arrays and strings", "Trees and graphs", "Linked lists", "Dynamic programming", "CS fundamentals (OS, DBMS)"],
  guidance: "45-60 minute round on a shared editor with a medium-to-hard algorithmic problem, plus CS fundamentals. Interviewers probe how you think: clarify, reason aloud, code, then test and optimise.",
  src: [M.rehearsal, M.ignition, M.gfg],
});
const mBehav = (src: string[]) => ({
  name: "As-appropriate (AA) / behavioural round", type: "hiring-manager" as const, minutes: 45, difficulty: "medium" as const,
  topics: ["Growth mindset", "Collaboration", "Project deep-dive", "Customer focus"],
  guidance: "Conversation with a senior engineer or manager on your projects, collaboration and growth mindset. Often the final round; it can include one more design or coding question.",
  src,
});

const microsoft: CompanyIn = {
  name: "Microsoft", slug: "microsoft", tier: 1,
  tierRationale: "SDE roles reported at about ₹18-25 LPA for new hires and ₹35-55 LPA at SDE II, with a multi-round coding and design loop. Entry pay sits at the Tier 1 boundary and the bar matches other Tier 1 companies.",
  hq: "Hyderabad and Bengaluru, India (global HQ: Redmond, USA)", size: "5,500+ across India offices (older company figure)",
  website: "https://careers.microsoft.com", aliases: ["Microsoft India", "Microsoft IDC", "MSFT"],
  sector: "enterprise-software", businessModel: "product", headcountBand: "India 5,500+ (older figure)",
  revenueBand: "Parent: $100B+ USD / yr", fundingStage: "public",
  wlbRating: 4.4, wlbReviewCount: 92,
  reviewSummary: "Software developers rate Microsoft 4.4/5 for work-life balance on AmbitionBox (92 reviews), its highest category, with career growth lowest at 3.8/5. 85% report flexible timing and 97% a Monday-to-Friday schedule.",
  reviewQuotes: [],
  overview: "Microsoft India Development Center (Hyderabad) and offices in Bengaluru build Azure, Microsoft 365, Windows, Dynamics, Teams and developer tools. Engineers are hired as SDE and SDE II through Senior and Principal, with an Explore programme for early-career talent.",
  culture: "Growth-mindset culture with hybrid-by-design working, strong work-life balance relative to peers, and an emphasis on collaboration across product groups.",
  benefits: "Base salary plus annual bonus (about 15-20% of base at SDE II) and RSUs vesting over four years; flexible hybrid work and on-site wellbeing services.",
  src: [M.ab, M.sal, M.six, M.rehearsal],
  roles: [
    {
      key: "sde-fresher", title: "Software Engineer / SDE (New Grad)", level: "fresher", spec: "backend",
      description: "Entry-level Software Engineer at Microsoft India (0-2 years). Build and test features in Azure, Microsoft 365 or developer-tools teams, write well-tested code and learn production engineering with mentor support. Fresher hiring runs in five stages that test algorithms and design reasoning more than aptitude.",
      stack: ["C#", "C++", "Java", "TypeScript", "Azure", "Data Structures", "Algorithms"],
      yoe: [0, 2], ctc: [18, 25], src: [M.fp, M.faceprepElig, M.gfg, M.taro],
      rounds: [
        {
          name: "Online coding assessment", type: "dsa", minutes: 90, difficulty: "medium",
          topics: ["Arrays", "Strings", "Trees", "Dynamic programming"],
          guidance: "Timed online coding test used to shortlist candidates for the interview loop.",
          src: [M.fp, M.gfg],
        },
        mCoding(1, "fresher"), mCoding(2, "fresher"),
        {
          name: "Technical round 3: design and problem solving", type: "lld", minutes: 60, difficulty: "medium",
          topics: ["Object-oriented design", "Data structure design", "CS fundamentals"],
          guidance: "A design-flavoured round: model a small system or design a data structure, discuss trade-offs, then solve a follow-up coding problem.",
          src: [M.fp, M.gfg],
        },
        mBehav([M.fp, M.rehearsal]),
      ],
    },
    {
      key: "sde2", title: "Software Engineer II (SDE II, Level 61-62)", level: "sde2", spec: "backend",
      description: "SDE II at Microsoft India (2-5 years). Own features and components, contribute to design decisions, mentor new engineers and operate services in production. A dedicated system design interview is part of the loop from SDE II.",
      stack: ["C#", ".NET", "Java", "Azure", "Distributed Systems", "System Design", "SQL"],
      yoe: [2, 5], ctc: [35, 55], src: [M.sal, M.six, M.rehearsal, M.roundz],
      rounds: [
        mCoding(1, "mid"), mCoding(2, "mid"),
        {
          name: "System design", type: "system-design", minutes: 60, difficulty: "hard",
          topics: ["APIs", "Storage", "Caching", "Queues", "Failure modes"],
          guidance: "Design a service with APIs, storage, caching and queues. Interviewers expect diagrams and explicit trade-offs, plus failure-mode discussion.",
          src: [M.rehearsal, M.ignition],
        },
        mBehav([M.rehearsal, M.roundz]),
      ],
    },
    {
      key: "senior-sde", title: "Senior Software Engineer (Level 63)", level: "sde3", spec: "backend",
      description: "Senior Software Engineer at Microsoft India. Compensation shown (₹55-85 LPA total) is an estimate built from the reported ₹35-50 LPA base plus bonus and RSUs. Drive the design and delivery of large cross-team features, make architectural decisions, lead incident response and mentor SDE and SDE II engineers.",
      stack: ["C#", ".NET", "Azure", "Distributed Systems", "System Design", "Architecture"],
      yoe: [5, 9], ctc: [55, 85], src: [M.sal, M.rehearsal],
      rounds: [
        mCoding(1, "senior"),
        {
          name: "System design 1", type: "system-design", minutes: 60, difficulty: "hard",
          topics: ["Large-scale design", "Consistency", "Capacity planning", "Observability"],
          guidance: "Open-ended design with depth on scaling, reliability and operations.",
          src: [M.rehearsal, M.ignition],
        },
        {
          name: "System design 2 / architecture", type: "system-design", minutes: 60, difficulty: "hard",
          topics: ["Architecture trade-offs", "Migration", "Security", "Cost"],
          guidance: "Deep-dive on architecture, often rooted in your past projects.",
          src: [M.rehearsal],
        },
        mBehav([M.rehearsal]),
      ],
    },
  ],
};

export const TIER1: CompanyIn[] = [google, amazon, microsoft];
