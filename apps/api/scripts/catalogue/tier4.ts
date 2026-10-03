import type { CompanyIn, RoundIn } from "./types.js";

// Tier 4: small / troubled startups where pay, job security or work-life balance are weak.
// Values marked "(estimate)" have no public source; they are best guesses, not reported figures.

// ---- Salescode.ai ----
const S = {
  gdInt1: "https://www.glassdoor.co.in/Interview/Salescode-ai-Interview-E8613603-RVW99579131.htm",
  gdInt2: "https://www.glassdoor.com.br/Entrevista/Salescode-ai-Entrevista-E8613603-RVW100499518.htm",
  gdInt3: "https://www.glassdoor.com.br/Entrevista/Salescode-ai-Entrevista-E8613603-RVW99021181.htm",
  naukri: "https://www.naukri.com/code360/interview-bundle/salescode-ai",
  gd: "https://www.glassdoor.com/Reviews/Salescode-Reviews-E4578504.htm",
  gdAi: "https://www.glassdoor.ca/Reviews/Salescode-ai-Reviews-E8613603.htm",
  pb: "https://pitchbook.com/profiles/company/112582-72",
  rev: "https://prospeo.io/c/salescode-ai-revenue",
};
const sRounds = (senior: boolean): RoundIn[] => [
  {
    name: "Online aptitude test", type: "dsa", minutes: 60, difficulty: "easy",
    topics: ["Quantitative aptitude", "Logical reasoning", "Basic programming"],
    guidance: "Reported first stage: an online aptitude test before any interview.",
    src: [S.gdInt1, S.gdInt2],
  },
  {
    name: senior ? "Technical round: system design and Java/React/SQL" : "Technical round: data structures and problem solving", type: senior ? "system-design" : "dsa",
    minutes: 60, difficulty: senior ? "hard" : "medium",
    topics: senior
      ? ["System design", "Java", "React", "SQL", "Resume-based questions"]
      : ["Data structures", "Algorithms", "Java", "SQL", "Basic problem solving", "Resume-based questions"],
    guidance: "Candidates report technical rounds of moderate to difficult level on data structures, algorithms, Java, React, SQL, system design and resume-based questions. Total process is typically 2-3 rounds.",
    src: [S.gdInt1, S.gdInt3, S.naukri],
  },
  {
    name: "HR discussion", type: "hiring-manager", minutes: 30, difficulty: "easy",
    topics: ["Communication", "Cultural fit", "Expectations", "Compensation"],
    guidance: "Final HR discussion assessing communication skills and cultural fit.",
    src: [S.gdInt1, S.gdInt2],
  },
];

const salescode: CompanyIn = {
  name: "Salescode", slug: "salescode", tier: 4,
  tierRationale: "Small VC-backed company (about 175-200 staff, estimated revenue around $3 million) with reviewers describing work-life balance as poor. Pay for engineers is not published, so Tier 4 reflects size, funding stage and reported working conditions, not a salary median.",
  hq: "Gurugram and Bengaluru, India", size: "About 175-200 employees",
  website: "https://salescode.ai", aliases: ["Salescode.ai", "SalesCode"],
  sector: "saas", businessModel: "product", headcountBand: "About 175-200",
  revenueBand: "~$3M USD / yr (estimate)", fundingStage: "early",
  wlbRating: 2.5, wlbReviewCount: 131,
  reviewSummary: "4.1/5 on Glassdoor from 131 reviews with 84% recommending, yet reviewers cite poor work-life balance that depends heavily on the manager, with long days through midnight and weekend work. The work-life balance score of 2.5/5 and its review count are estimates from that feedback.",
  reviewQuotes: [],
  overview: "Salescode.ai builds an AI platform for sales in consumer-packaged-goods, guaranteeing CPG companies a minimum 3% sales uplift. It has about 175-200 people in Gurugram and Bengaluru, thirteen investors and a Series A raised in 2021.",
  culture: "Small, fast-moving team where hiring is short (2-3 rounds) and workload is high; feedback on work-life balance is notably negative even though overall ratings are good.",
  benefits: "Pay is not publicly itemised; engineer salaries shown below are estimates. Roles listed publicly include Software Engineer, Senior Software Engineer, Full Stack Developer, Software Test Engineer and Business Analyst.",
  src: [S.gd, S.gdAi, S.pb, S.rev],
  roles: [
    {
      key: "swe-fresher", title: "Software Engineer (Fresher)", level: "fresher", spec: "fullstack",
      description: "Entry-level Software Engineer at Salescode.ai, building features across the AI sales platform for CPG clients with Java, React and SQL. Annual pay of ₹5-8 LPA is an estimate; no public salary data was found.",
      stack: ["Java", "React", "SQL", "Data Structures", "REST APIs"],
      yoe: [0, 1], ctc: [5, 8], src: [S.gdInt1, S.naukri, S.gd],
      rounds: sRounds(false),
    },
    {
      key: "sde", title: "Software Development Engineer (SDE)", level: "sde1", spec: "backend",
      description: "SDE at Salescode.ai working on backend services and APIs for the sales-intelligence platform. Annual pay of ₹8-14 LPA is an estimate.",
      stack: ["Java", "Spring", "SQL", "Microservices", "AWS"],
      yoe: [1, 3], ctc: [8, 14], src: [S.gdInt2, S.naukri, S.gdAi],
      rounds: sRounds(false),
    },
    {
      key: "test-engineer", title: "Software Test Engineer", level: "sde1", spec: "qa",
      description: "Test engineer at Salescode.ai responsible for functional and automated testing of the platform. Annual pay of ₹5-9 LPA is an estimate.",
      stack: ["Selenium", "Java", "SQL", "API testing", "Test automation"],
      yoe: [1, 3], ctc: [5, 9], src: [S.gdInt3, S.naukri],
      rounds: sRounds(false),
    },
    {
      key: "senior-swe", title: "Senior Software Engineer", level: "sde3", spec: "fullstack",
      description: "Senior engineer at Salescode.ai owning full-stack features and design decisions, with system design discussed in the technical round. Annual pay of ₹16-26 LPA is an estimate.",
      stack: ["Java", "React", "SQL", "System Design", "AWS"],
      yoe: [5, 9], ctc: [16, 26], src: [S.gdInt1, S.naukri, S.gdAi],
      rounds: sRounds(true),
    },
  ],
};

// ---- Byju's ----
const B = {
  lvl: "https://www.levels.fyi/companies/byjus/salaries/software-engineer/locations/greater-bengaluru",
  salGd: "https://www.glassdoor.co.in/Salary/BYJU-S-Software-Engineer-Salaries-E690021_D_KO7,24.htm",
  six: "https://6figr.com/in/salary/byju's--software-engineer",
  revGd: "https://www.glassdoor.co.in/Reviews/BYJU-S-Software-Engineer-Reviews-EI_IE690021.0,6_KO7,24.htm",
  revAse: "https://www.glassdoor.com/Reviews/BYJU-S-associate-software-engineer-Reviews-EI_IE690021.0,6_KO7,34.htm",
  ab: "https://ambitionbox.com/reviews/byjus-reviews",
  wiki: "https://en.wikipedia.org/wiki/Byju%27s",
  bk: "https://www.equentis.com/blog/inside-byjus-bankruptcy-impact-recovery-and-future-prospects/",
  rev23: "https://inc42.com/buzz/exclusive-byjus-fy23-revenue-touches-inr-6500-cr/",
  dunzo: "https://restofworld.org/2025/dunzo-shutdown-india-quick-commerce/",
  layoff: "https://www.zeebiz.com/startups/news-byjus-ola-oyo-unacademy-a-summary-of-indian-startups-layoffs-stst-240788",
};
const bRounds = (level: "entry" | "mid" | "senior"): RoundIn[] => [
  {
    name: "Online coding test (estimate)", type: "dsa", minutes: 60, difficulty: level === "entry" ? "easy" : "medium",
    topics: ["Arrays", "Strings", "Basic data structures"],
    guidance: "No public candidate reports of Byju's engineering interviews were found, so this round structure is an estimate based on typical edtech product hiring. Treat it as practice, not a verified process.",
    src: [B.revGd, B.lvl],
  },
  {
    name: "Technical interview (estimate)", type: level === "senior" ? "system-design" : "lld", minutes: 60, difficulty: level === "entry" ? "medium" : "hard",
    topics: level === "senior" ? ["System design", "Scalability", "Databases"] : ["OOP", "Data structures", "Databases", "Project deep-dive"],
    guidance: "Estimated technical round covering fundamentals, projects and, for mid and senior levels, design. No public source confirms the format.",
    src: [B.revGd, B.lvl],
  },
  {
    name: "HR and hiring manager (estimate)", type: "hiring-manager", minutes: 30, difficulty: "easy",
    topics: ["Role fit", "Compensation", "Notice period"],
    guidance: "Estimated final discussion. Note that Byju's (Think & Learn) is in insolvency proceedings, so confirm the company is actually hiring before relying on this loop.",
    src: [B.bk, B.wiki],
  },
];

const byjus: CompanyIn = {
  name: "Byju's", slug: "byjus", tier: 4,
  tierRationale: "Think & Learn entered insolvency proceedings in October 2024 after delayed filings, investor disputes and large layoffs (about 500 in April 2024, plus broader cuts). Reported engineer pay was decent on paper but job security is the weakest in this catalogue.",
  hq: "Bengaluru, India", size: "Sharply reduced; under insolvency (about 500 laid off in April 2024)",
  website: "https://byjus.com", aliases: ["BYJU'S", "Think and Learn", "Think & Learn Pvt Ltd"],
  sector: "edtech", businessModel: "product", headcountBand: "Sharply reduced (insolvency)",
  revenueBand: "FY23 ~₹6,500 crore (company)", fundingStage: "late-stage",
  wlbRating: 2.7, wlbReviewCount: 16000,
  reviewSummary: "3.1/5 overall on AmbitionBox from about 16,000 reviews with work-life balance 2.7/5 (108 reviews call it poor); software engineers rate it 3.2/5 on Glassdoor from 226 reviews. Reviews repeatedly mention layoffs and seniors leaving.",
  reviewQuotes: [
    { text: "layoffs all around and seniors leaving willingly", sourceUrl: B.revGd, sourceName: "Glassdoor", date: null },
  ],
  overview: "Byju's (Think & Learn Private Limited) was India's most valuable edtech company. After post-pandemic demand weakened and disputes with investors and the BCCI, it entered corporate insolvency proceedings in October 2024; its valuation is reported as zero.",
  culture: "Historically sales-driven and fast-growing, now defined by restructuring, layoffs and managerial powers suspended under insolvency. Included to show candidates what a low-security employer looks like.",
  benefits: "Levels.fyi reports Greater Bengaluru software engineer pay from ₹16.5 LPA (L1) to ₹36.7 LPA (L4); Glassdoor averages ₹12 LPA. Pay delays are common across distressed Indian startups.",
  src: [B.ab, B.revGd, B.lvl, B.wiki, B.bk],
  roles: [
    {
      key: "ase", title: "Associate Software Engineer", level: "fresher", spec: "fullstack",
      description: "Entry-level engineer building features for the learning app and platform. Pay of ₹10-16 LPA is a blend of the Glassdoor ₹12 LPA average and the Levels.fyi L1 figure. Confirm hiring status before applying: the company is under insolvency.",
      stack: ["Java", "Kotlin", "React", "SQL", "Data Structures"],
      yoe: [0, 2], ctc: [10, 16], src: [B.revAse, B.salGd, B.lvl],
      rounds: bRounds("entry"),
    },
    {
      key: "sde2", title: "Software Engineer (L2-L3)", level: "sde2", spec: "backend",
      description: "Mid-level backend or full-stack engineer at Byju's. Pay is estimated between the L1 and L4 Levels.fyi anchors (₹16.5-36.7 LPA).",
      stack: ["Java", "Spring", "MySQL", "Kafka", "AWS"],
      yoe: [2, 5], ctc: [20, 28], src: [B.lvl, B.salGd, B.six],
      rounds: bRounds("mid"),
    },
    {
      key: "sde3", title: "Senior Software Engineer (L4)", level: "sde3", spec: "backend",
      description: "Senior engineer at Byju's. Levels.fyi reports L4 software-engineer pay around ₹36.7 LPA in Greater Bengaluru.",
      stack: ["Java", "Microservices", "System Design", "AWS"],
      yoe: [5, 9], ctc: [30, 37], src: [B.lvl, B.six],
      rounds: bRounds("senior"),
    },
  ],
};

// ---- Zypp Electric ----
const Z = {
  gdInt: "https://www.glassdoor.co.in/Interview/Zypp-Electric-Interview-Questions-E4751986.htm",
  gdJava: "https://www.glassdoor.co.in/Interview/Zypp-Electric-Software-Engineer-Java-Developer-Interview-Questions-EI_IE4751986.0,13_KO14,46.htm",
  gdSal: "https://www.glassdoor.co.in/Salary/Zypp-Electric-Software-Development-Engineer-SDE-Salaries-E4751986_DAO.htm?filter.jobTitleExact=Software+Development+Engineer+(SDE)",
  gdSalAll: "https://www.glassdoor.co.in/Salary/Zypp-Electric-Salaries-E4751986.htm",
  lvl: "https://www.levels.fyi/en-gb/companies/zypp-electric/salaries/software-engineer",
  wd: "https://www.weekday.works/company/zypp",
  java: "https://cutshort.io/job/Java-Developer-NCR-Delhi-Gurgaon-Noida-Zypp-Electric-oO6Sizzt",
  be: "https://www.instahyre.com/job-221456-backend-developer-at-zypp-electric-gurgaon/",
  gd: "https://www.glassdoor.co.in/Reviews/Zypp-Electric-Reviews-E4751986.htm",
  evr: "https://evreporter.com/zypp-electric-raises-usd-15m-in-series-c1-round-led-by-eneos/",
  ys: "https://yourstory.com/2025/01/zypp-electric-secures-rs-554-cr-ongoing-series-c-funding-round",
  tracxn: "https://tracxn.com/d/companies/zypp-electric/__U96AIh11fa25kr6vVshWgWmUjnbdhH8Yl6GqHtiPPfE",
};
const zRounds = (senior: boolean): RoundIn[] => [
  {
    name: "Assignment round", type: "lld", minutes: 180, difficulty: "medium",
    topics: ["Coding assignment", "OOP", "SQL"],
    guidance: "First stage of the three-round SDE process: a take-home assignment evaluated before any interview.",
    src: [Z.gdInt, Z.gdJava],
  },
  {
    name: "Online technical interview", type: "dsa", minutes: 60, difficulty: "medium",
    topics: ["Basic SQL", "Object-oriented programming", "Coding problems", "Puzzle-based questions"],
    guidance: "Video technical round covering basic SQL, OOP, situational and puzzle-based questions and coding problems.",
    src: [Z.gdInt, Z.gdJava],
  },
  {
    name: senior ? "Final technical and HR interview (Gurgaon office, with design discussion)" : "Final technical and HR interview (Gurgaon office)",
    type: senior ? "system-design" : "hiring-manager", minutes: 60, difficulty: senior ? "hard" : "medium",
    topics: senior ? ["System design", "Fleet and telemetry data", "Ownership", "Compensation"] : ["Project discussion", "Situational questions", "Culture fit", "Compensation"],
    guidance: "In-person technical plus HR round at the Gurugram office.",
    src: [Z.gdInt, Z.gdJava],
  },
];

const zypp: CompanyIn = {
  name: "Zypp Electric", slug: "zypp-electric", tier: 4,
  tierRationale: "Series C EV delivery-as-a-service startup whose pay is reported as consistently below industry averages at every experience level (for example ₹12.66 LPA at 5 years vs ₹18.16 LPA industry average), with a Series C round still ongoing. Tier 4 reflects below-market pay and startup funding risk, though Glassdoor reviews are positive.",
  hq: "Gurugram, India", size: "1,001-5,000 employees",
  website: "https://www.zypp.app", aliases: ["Zypp", "Zypp Electric Mobility"],
  sector: "logistics", businessModel: "service", headcountBand: "1,001-5,000",
  revenueBand: "~₹100-200 crore (estimate)", fundingStage: "growth",
  wlbRating: 3.5, wlbReviewCount: 110,
  reviewSummary: "4.2/5 on Glassdoor from 110 reviews with 77% recommending (culture 4.2, compensation 4.1, career opportunities 4.2). The work-life balance score of 3.5/5 is an estimate; pay is reported below industry averages.",
  reviewQuotes: [],
  overview: "Zypp Electric is a Gurugram-based electric-vehicle delivery-as-a-service company founded in 2017 by Tushar Mehta and Akash Gupta. It has raised about $76.5 million over 12 rounds, including an ongoing Series C led by Japan's ENEOS.",
  culture: "Operations-heavy startup where engineering supports EV fleet, rider and delivery workflows; hiring is quick (assignment, online technical, in-office final).",
  benefits: "Reported engineer pay: about ₹3.97 LPA at 1 year, ₹12.66 LPA at 5 years and ₹34.37 LPA at 15 years; ₹7-10 LPA typical for Gurgaon software engineers.",
  src: [Z.gd, Z.gdSalAll, Z.lvl, Z.evr, Z.ys, Z.tracxn],
  roles: [
    {
      key: "sde-fresher", title: "Software Development Engineer (Fresher)", level: "fresher", spec: "backend",
      description: "Entry-level SDE building backend and app features for Zypp's EV delivery and fleet platform. Reported entry pay is about ₹3.97 LPA at one year of experience.",
      stack: ["Java", "SQL", "OOP", "REST APIs"],
      yoe: [0, 1], ctc: [3.5, 6], src: [Z.lvl, Z.gdSal, Z.gdInt],
      rounds: zRounds(false),
    },
    {
      key: "java-dev", title: "Java Developer", level: "sde1", spec: "backend",
      description: "Java developer in Delhi NCR (Gurugram/Noida) building services for Zypp's platform. Gurgaon software engineers are reported at ₹7-10 LPA.",
      stack: ["Java", "Spring Boot", "MySQL", "REST APIs", "Kafka"],
      yoe: [1, 4], ctc: [7, 10], src: [Z.java, Z.gdJava, Z.gdSalAll],
      rounds: zRounds(false),
    },
    {
      key: "backend-dev", title: "Backend Developer", level: "sde2", spec: "backend",
      description: "Backend developer in Gurugram owning services for fleet, orders and payments. Levels.fyi data puts five-year pay near ₹12.66 LPA, below the ₹18.16 LPA industry average.",
      stack: ["Java", "Node.js", "PostgreSQL", "Redis", "AWS"],
      yoe: [3, 6], ctc: [10, 14], src: [Z.be, Z.lvl, Z.wd],
      rounds: zRounds(false),
    },
    {
      key: "senior-eng", title: "Senior Software Engineer", level: "sde3", spec: "backend",
      description: "Senior engineer at Zypp Electric leading design of fleet, telemetry and delivery platforms. Pay of ₹18-28 LPA is an estimate extrapolated from the reported curve (₹34.37 LPA at 15 years).",
      stack: ["Java", "Microservices", "Kafka", "AWS", "System Design"],
      yoe: [6, 10], ctc: [18, 28], src: [Z.lvl, Z.gdSalAll],
      rounds: zRounds(true),
    },
  ],
};

export const TIER4: CompanyIn[] = [salescode, byjus, zypp];
