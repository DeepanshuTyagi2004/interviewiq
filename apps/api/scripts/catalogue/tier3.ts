import type { CompanyIn, RoundIn } from "./types.js";

// ---- TCS ----
const T = {
  upd: "https://faceprep.in/article/tcs-recruitment-latest-updates/",
  tracks: "https://faceprep.in/article/tcs-ninja-2019-tcs-digital-2019-updates-tcs-recruitment-2019/",
  sal: "https://www.newleafins.org/placement-prep/tcs-nqt/salary",
  rank: "https://www.placementranker.com/articles/tcs-ninja-vs-digital-vs-prime-2026",
  bharat: "https://bharatnqt.com/tcs-ninja-vs-digital/",
  rozgar: "https://rozgarrank.com/category/private-jobs/tcs-nqt-recruitment-2026-ninja-digital-prime",
  tutors: "https://tutorsbot.com/blog/tcs-fresher-salary-2026-complete-breakdown",
  lateral: "https://www.peoplematters.in/news/recruiting-and-onboarding/tcs-launches-lateral-hiring-offers-indian-rupee9-lakh-pay-and-indian-rupee50000-joining-bonus-48940",
  lateral2: "https://analyticsindiamag.com/ai-news/tcs-ramps-up-lateral-hiring-offers-9-lpa-50k-joining-bonus-amid-ai-push",
  fp: "https://www.freepressjournal.in/tech/tcs-launches-lateral-hiring-drive-offers-9-lpa-package-and-50000-joining-bonus",
  ab: "https://ambitionbox.com/reviews/tcs-reviews",
  hc: "https://india.entrepreneur.com/business-news/from-tcs-to-techm-headcount-declines-echo-vembus-it-hiring-concerns",
  rpe: "https://oga-prod.angelone.in/news/stocks/tcs-infosys-hcltech-lead-3-4-rise-in-revenue-per-employee-in-fy26-signalling-ai-driven-productivity-shift",
  lets: "https://letsdatascience.com/news/indian-it-giants-face-ai-driven-fy26-reset-b29040ed",
};
const tNqt = (track: "ninja" | "digital" | "prime"): RoundIn => ({
  name: track === "ninja" ? "TCS NQT: Foundation section" : "TCS NQT: Foundation + Advanced sections", type: "dsa",
  minutes: track === "ninja" ? 90 : 180, difficulty: track === "prime" ? "hard" : track === "digital" ? "medium" : "easy",
  topics: track === "ninja"
    ? ["Numerical ability", "Verbal ability", "Reasoning"]
    : ["Numerical ability", "Verbal ability", "Reasoning", "Advanced quantitative and reasoning", "Coding"],
  guidance: track === "ninja"
    ? "Ninja candidates sit only the Foundation section; the shortlisting NQT score is around 65% overall and a CGPA of 6.0 is required. The test is held two or three times a year."
    : track === "digital"
      ? "Digital needs a higher NQT score (around 78%) plus strong coding in the Advanced section before the advanced technical interview."
      : "Prime needs the highest NQT score (around 88%) including the Advanced coding section.",
  src: [T.upd, T.tracks, T.rank, T.bharat],
});
const tTech = (track: "ninja" | "digital" | "prime"): RoundIn => ({
  name: track === "prime" ? "Extended technical interview" : track === "digital" ? "Advanced technical interview" : "Technical interview",
  type: "lld", minutes: track === "ninja" ? 30 : track === "digital" ? 45 : 60, difficulty: track === "prime" ? "hard" : "medium",
  topics: track === "prime"
    ? ["Projects", "Data structures", "AI or data project", "OOP", "DBMS", "Problem solving"]
    : ["Projects", "Programming fundamentals", "OOP", "DBMS", "Problem solving"],
  guidance: track === "prime"
    ? "Closer to a software-engineering screen; candidates are expected to show an AI or data project and discuss it in depth."
    : "Interview on your resume projects, programming language basics, OOP, DBMS and simple problem solving.",
  src: [T.upd, T.rank, T.bharat],
});
const tMgr = (): RoundIn => ({
  name: "Managerial interview", type: "hiring-manager", minutes: 30, difficulty: "easy",
  topics: ["Project discussion", "Teamwork", "Adaptability", "Shift and relocation flexibility"],
  guidance: "Conversation with a manager about your projects, how you work in teams and willingness to relocate or work in shifts.",
  src: [T.upd, T.rozgar],
});
const tHr = (): RoundIn => ({
  name: "HR interview", type: "behavioural", minutes: 20, difficulty: "easy",
  topics: ["Why TCS", "Strengths and weaknesses", "Relocation", "Joining logistics"],
  guidance: "Final HR conversation covering motivation for TCS, communication and offer logistics.",
  src: [T.upd, T.rozgar],
});

const tcs: CompanyIn = {
  name: "TCS", slug: "tcs", tier: 3,
  tierRationale: "Fresher tracks span ₹3.36-3.9 LPA (Ninja) to ₹9-11 LPA (Prime) with Digital at about ₹7-7.5 LPA. A fresher median under ₹6 LPA would formally place it in the lowest pay band, but as the mass-recruiting IT-services anchor with stable employment it is classed Tier 3.",
  hq: "Mumbai, India", size: "584,519 employees (31 March 2026)",
  website: "https://www.tcs.com/careers", aliases: ["Tata Consultancy Services", "TCS iON"],
  sector: "it-services", businessModel: "service", headcountBand: "584,519 (FY26 end)",
  revenueBand: "FY26 revenue ₹2.67 lakh crore", fundingStage: "public",
  wlbRating: 3.8, wlbReviewCount: 85200,
  reviewSummary: "Work-life balance 3.8/5 on AmbitionBox from about 85,200 reviews, ahead of Infosys at 3.7/5. TCS hires 40,000-50,000 freshers a year through the NQT, though FY26 headcount fell by over 23,000.",
  reviewQuotes: [],
  overview: "Tata Consultancy Services is India's largest IT-services firm by headcount. Freshers join through the National Qualifier Test into Ninja, Digital or Prime tracks; the company also runs targeted lateral hiring for professionals with two to four years' experience.",
  culture: "Large, process-driven services culture with structured training and project allocation; TCS says 60% of FY26 fresher hires are AI-skilled, up from 10-15% three years ago.",
  benefits: "Fresher CTC of ₹3.36-3.9 LPA (Ninja), ₹7.0-7.5 LPA (Digital) and ₹9.0-11.8 LPA (Prime); lateral hires get up to ₹9 LPA with a ₹50,000 joining bonus.",
  src: [T.ab, T.hc, T.rpe, T.lets, T.sal],
  roles: [
    {
      key: "ninja", title: "Assistant System Engineer (TCS Ninja)", level: "fresher", spec: "ninja",
      description: "Entry-level engineering role in TCS delivery teams. Learn through TCS's training programme, then work on development, testing or support for client projects. Hiring uses the NQT Foundation section only.",
      stack: ["Java", "Python", "SQL", "OOP", "Aptitude"],
      yoe: [0, 1], ctc: [3.36, 3.9], src: [T.sal, T.tutors, T.tracks, T.rank],
      rounds: [tNqt("ninja"), tTech("ninja"), tMgr(), tHr()],
    },
    {
      key: "digital", title: "Digital Engineer (TCS Digital)", level: "fresher", spec: "digital",
      description: "Higher-band fresher role focused on digital-technology projects such as cloud, analytics and modern application development. Requires a stronger NQT score with an advanced coding section and an advanced technical interview.",
      stack: ["Java", "Python", "SQL", "Cloud basics", "Data Structures"],
      yoe: [0, 1], ctc: [7.0, 7.5], src: [T.sal, T.tutors, T.rank, T.bharat],
      rounds: [tNqt("digital"), tTech("digital"), tMgr(), tHr()],
    },
    {
      key: "prime", title: "Prime Engineer (TCS Prime)", level: "fresher", spec: "prime",
      description: "Top fresher track at TCS for high NQT scorers with an AI or data project. Expect an extended technical interview similar to a software-engineering screen.",
      stack: ["Python", "Java", "Data Structures", "Machine Learning basics", "SQL"],
      yoe: [0, 1], ctc: [9.0, 11.8], src: [T.sal, T.tutors, T.rank, T.bharat],
      rounds: [tNqt("prime"), tTech("prime"), tMgr(), tHr()],
    },
    {
      key: "lateral-se", title: "Software Engineer (Lateral)", level: "sde2", spec: "lateral",
      description: "Lateral hire for professionals with two to four years of experience in AI, data engineering, cloud computing or cybersecurity. Candidates must show hands-on skill in stacks such as Java, C++, Python, .NET, AngularJS, ReactJS, Node.js, SQL or Selenium.",
      stack: ["Java", "Python", ".NET", "React", "Node.js", "SQL", "Selenium"],
      yoe: [2, 4], ctc: [6, 9], src: [T.lateral, T.lateral2, T.fp],
      rounds: [
        {
          name: "Skill-based assessment", type: "dsa", minutes: 60, difficulty: "medium",
          topics: ["Stack-specific technical questions", "Coding", "Problem solving"],
          guidance: "First stage of the three-stage lateral process: a skill-based assessment, followed by discussions that prioritise technical capability and practical expertise.",
          src: [T.lateral, T.lateral2],
        },
        {
          name: "Technical discussion", type: "lld", minutes: 45, difficulty: "medium",
          topics: ["Hands-on experience", "Stack depth", "Project design"],
          guidance: "Technical discussion on your hands-on work in the stack named in the opening.",
          src: [T.lateral, T.fp],
        },
        {
          name: "Managerial and HR discussion", type: "hiring-manager", minutes: 30, difficulty: "easy",
          topics: ["Role fit", "Notice period", "Compensation"],
          guidance: "Closing discussion on role fit and offer terms (reported package up to ₹9 LPA with a ₹50,000 joining bonus).",
          src: [T.lateral, T.lateral2],
        },
      ],
    },
  ],
};

// ---- Infosys ----
const I = {
  unstop: "https://unstop.com/blog/infosys-recruitment-process",
  clear: "https://clearround.ai/blog/infosys-interview-process-2026",
  silpa: "https://silpacareer.com/2026/02/25/infosys-recruitment-process-2026/",
  prep: "https://www.prepnplaced.com/companies/infosys",
  entri: "https://entri.app/blog/infosys-interview-guide/",
  tamil: "https://tamiltech.in/article/infosys-interview-experience-2026-complete-guide",
  ophy: "https://ophyai.com/blog/company-guides/infosys-interview-guide",
  final: "https://www.finalroundai.com/blog/infosys-interview-process",
  ab: "https://ambitionbox.com/reviews/infosys-reviews",
  gd: "https://static.glassdoor.fr/Reviews/Infosys-Reviews-E7927_P40660.htm",
  hc: "https://www.angelone.in/news/share-market/tcs-infosys-hcl-tech-wipro-a-quick-look-at-attrition-rates-and-headcount-in-q1fy26",
  lets: "https://letsdatascience.com/news/indian-it-giants-face-ai-driven-fy26-reset-b29040ed",
  attr: "https://www.storyboard18.com/amp/how-it-works/infosys-employees-attrition-rate-rises-to-14-4-in-q1fy26-profit-jumps-by-9-76354.htm",
};
const iTest = (hard: boolean): RoundIn => ({
  name: "Online assessment (InfyTQ / HackWithInfy)", type: "dsa", minutes: hard ? 180 : 100, difficulty: hard ? "hard" : "easy",
  topics: hard
    ? ["Advanced coding", "Data structures and algorithms", "Pseudocode"]
    : ["Reasoning ability", "Mathematical ability", "Verbal ability", "Pseudocode"],
  guidance: hard
    ? "Coding-heavy test for the Specialist Programmer track."
    : "100-minute test: reasoning (15 questions, 25 min), mathematical ability (10 questions, 35 min), verbal ability (20 questions, 20 min) and pseudocode (5 questions, 10 min).",
  src: [I.unstop, I.clear, I.entri],
});
const iTech = (level: "se" | "dse" | "sp"): RoundIn => ({
  name: level === "se" ? "Technical interview" : level === "dse" ? "Technical interview (Digital Specialist track)" : "Technical interview (Specialist Programmer track)",
  type: "lld", minutes: level === "se" ? 30 : 45, difficulty: level === "sp" ? "hard" : "medium",
  topics: level === "se" ? ["Core subjects", "Projects", "Programming basics", "DBMS", "OOP"] : ["Data structures", "Coding", "Projects", "System basics"],
  guidance: "Technical interview of about 20-30 minutes testing core subject knowledge and projects. Upgrade rounds for DSE or SP carry no downside: failing keeps your SE offer.",
  src: [I.unstop, I.clear, I.final],
});
const iHr = (): RoundIn => ({
  name: "HR interview", type: "behavioural", minutes: 25, difficulty: "easy",
  topics: ["Why Infosys", "C-LIFE values", "Relocation", "Training agreement", "Joining logistics"],
  guidance: "About 25-minute HR round covering values and stability: why Infosys, awareness of the C-LIFE values, relocation and the training agreement.",
  src: [I.unstop, I.clear],
});

const infosys: CompanyIn = {
  name: "Infosys", slug: "infosys", tier: 3,
  tierRationale: "Fresher tracks run ₹3.6-4.5 LPA (Systems Engineer), ₹6.25-9.5 LPA (Digital Specialist Engineer) and ₹10-21 LPA (Specialist Programmer). A blended range of mostly Tier 3 outcomes at a mass recruiter that hires 30,000-40,000 freshers a year.",
  hq: "Bengaluru, India", size: "328,594 employees (31 March 2026)",
  website: "https://www.infosys.com/careers", aliases: ["Infosys Limited", "Infosys BPM", "InfyTQ"],
  sector: "it-services", businessModel: "service", headcountBand: "328,594 (FY26 end; net +5,016)",
  revenueBand: "FY26 ₹178,650 crore", fundingStage: "public",
  wlbRating: 3.7, wlbReviewCount: 36900,
  reviewSummary: "Work-life balance 3.7/5 on AmbitionBox from about 36,900 reviews (295 reviews cite poor work-life balance); 3.6/5 overall on Glassdoor from 122,810 reviews. Attrition was 14.4% in Q1 FY26.",
  reviewQuotes: [],
  overview: "Infosys is a Bengaluru IT-services company that hires freshers into Systems Engineer, Digital Specialist Engineer and Specialist Programmer tracks through the InfyTQ / online test, with an optional upgrade round.",
  culture: "Large services culture with a well-defined onboarding and training programme at Mysuru; the C-LIFE values are tested in HR rounds.",
  benefits: "Systems Engineer ₹3.6-4.5 LPA, Digital Specialist Engineer ₹6.25-9.5 LPA, Specialist Programmer ₹10-21 LPA.",
  src: [I.ab, I.gd, I.hc, I.lets, I.attr],
  roles: [
    {
      key: "se", title: "Systems Engineer", level: "fresher", spec: "systems-engineer",
      description: "Entry-level engineering role at Infosys delivery units. Trained at the Mysuru campus, then assigned to development, testing or support work on client projects.",
      stack: ["Java", "Python", "SQL", "OOP", "Aptitude"],
      yoe: [0, 1], ctc: [3.6, 4.5], src: [I.unstop, I.silpa, I.prep],
      rounds: [iTest(false), iTech("se"), iHr()],
    },
    {
      key: "dse", title: "Digital Specialist Engineer", level: "fresher", spec: "digital-specialist",
      description: "Higher-paid fresher track for candidates who clear the upgrade round. Works on digital-technology engagements with stronger programming expectations than Systems Engineer.",
      stack: ["Java", "Python", "Data Structures", "SQL", "Cloud basics"],
      yoe: [0, 1], ctc: [6.25, 9.5], src: [I.unstop, I.clear, I.entri],
      rounds: [iTest(false), iTech("dse"), iHr()],
    },
    {
      key: "sp", title: "Specialist Programmer", level: "fresher", spec: "specialist-programmer",
      description: "Top fresher track at Infosys (₹10-21 LPA) for strong competitive-programming performers, working on complex engineering problems. Reached through a hard coding test and an advanced technical interview.",
      stack: ["Data Structures", "Algorithms", "Java", "C++", "Python"],
      yoe: [0, 1], ctc: [10, 21], src: [I.unstop, I.clear, I.silpa],
      rounds: [iTest(true), iTech("sp"), iHr()],
    },
  ],
};

// ---- Accenture ----
const X = {
  gfg: "https://www.geeksforgeeks.org/interview-experiences/accenture-interview-experience-for-ase-on-campus-1/",
  gfg2: "https://www.geeksforgeeks.org/interview-experiences/accenture-interview-experience-ase-aase/",
  gfg3: "https://www.geeksforgeeks.org/interview-experiences/accenture-interview-experience-for-aase-advanced-associate-software-engineer-2026-batch-on-campus/",
  guvi: "https://www.guvi.in/blog/accenture-ase-interview-experience/",
  intern: "https://internshala.com/blog/accenture-associate-software-engineer-interview-questions/",
  fh: "https://freshershunt.in/accenture-ase-guide/",
  pi: "https://prepinsta.com/interview-preparation/accenture-ase-interview-experience/",
  salAase: "https://www.glassdoor.co.in/Salary/Accenture-Advanced-Associate-Software-Engineer-28AASE-29-Role-Salaries-E4138_DAO.htm?filter.jobTitleExact=Advanced+Associate+Software+Engineer+%28AASE%29+Role",
  salIn: "https://salaryinhand.in/companies/accenture",
  asmorix: "https://www.asmorix.com/accenture-salary-for-freshers/",
  felix: "https://www.felix-its.com/blog/accenture-freshers-salary-breakdown-what-you-need-to-know/",
  gd: "https://www.glassdoor.com/Overview/Working-at-Accenture-EI_IE4138.11,20.htm",
  nearshore: "https://nearshoreamericas.com/what-are-employees-saying-about-5-of-the-top-global-it-services-leaders",
  jobrise: "https://jobrise.io/en/blog/mass-hiring-companies-india-2026/",
};
const xRounds = (advanced: boolean): RoundIn[] => [
  {
    name: "Cognitive and technical assessment", type: "dsa", minutes: 90, difficulty: "easy",
    topics: ["English ability", "Critical reasoning", "Abstract reasoning", "Pseudocoding", "MS Office", "Networking, security and cloud"],
    guidance: "90 MCQs in 90 minutes. The cognitive section of about 50 questions covers English ability and logical and abstract reasoning; the technical section covers pseudocode, MS Office and networking, security and cloud.",
    src: [X.fh, X.gfg, X.guvi],
  },
  {
    name: "Coding assessment", type: "dsa", minutes: 45, difficulty: advanced ? "medium" : "easy",
    topics: ["Basic data structures", "Strings", "Arrays", "Simple algorithms"],
    guidance: "Two coding questions (one easy, one medium) in 45 minutes, in C, C++, Python or Java. Mandatory and an elimination round.",
    src: [X.fh, X.gfg2, X.pi],
  },
  {
    name: "Communication assessment", type: "behavioural", minutes: 30, difficulty: "easy",
    topics: ["Reading aloud", "Listen and repeat", "Story comprehension", "45-second speech"],
    guidance: "Spoken-English assessment: read sentences on screen, listen and repeat, answer questions on a story and give a 45-second speech on a random topic after thinking time.",
    src: [X.fh, X.guvi],
  },
  {
    name: "Technical and HR interview", type: "hiring-manager", minutes: 30, difficulty: "easy",
    topics: ["Projects and internships", "OOP", "DBMS", "Scenario questions", "Relocation and shift flexibility", "Why Accenture"],
    guidance: "Combined technical and HR discussion: your projects and internships, OOP and DBMS basics, scenario questions, flexibility on relocation and shifts, and why Accenture.",
    src: [X.fh, X.gfg3, X.intern],
  },
];

const accenture: CompanyIn = {
  name: "Accenture", slug: "accenture", tier: 3,
  tierRationale: "Entry packages of about ₹4.5 LPA (ASE) and ₹6.5 LPA (Advanced ASE) at one of India's largest fresher recruiters; a four-stage assessment-led process typical of Tier 3 IT services.",
  hq: "Delivery centres across India including Bengaluru, Hyderabad, Pune and Chennai (global HQ: Dublin, Ireland)", size: "About 300,000 employees in India (estimate)",
  website: "https://www.accenture.com/in-en/careers", aliases: ["Accenture India", "Accenture Solutions Pvt Ltd"],
  sector: "it-services", businessModel: "service", headcountBand: "~300,000 India (estimate)", revenueBand: "Global ~$70B USD (estimate)", fundingStage: "public",
  wlbRating: 3.6, wlbReviewCount: 5000,
  reviewSummary: "Glassdoor work-life balance score of 3.6/5 as of August 2026, about 9% above the management-consulting average (review count of 5,000 is an estimate). Accenture is a lead recruiter in India's 2026 fresher surge and the GenAI push.",
  reviewQuotes: [],
  overview: "Accenture is a global professional-services and IT-services company with large India delivery operations. Freshers join as Associate Software Engineer (CL-12) or Advanced Associate Software Engineer (CL-11) after an assessment-led process.",
  culture: "Large consulting-flavoured services culture with project-based staffing and structured training; communication skills are assessed explicitly in hiring.",
  benefits: "ASE about ₹4.5 LPA (take-home about ₹29,000-31,000 a month) and Advanced ASE about ₹6.5 LPA (take-home about ₹44,000-47,000 a month).",
  src: [X.gd, X.nearshore, X.salIn, X.jobrise],
  roles: [
    {
      key: "ase", title: "Associate Software Engineer (ASE, CL-12)", level: "fresher", spec: "ase",
      description: "Entry-level engineering role at Accenture India. Work on client application development, testing or maintenance after training, supported by project mentors.",
      stack: ["Java", "Python", "C++", "SQL", "OOP", "DBMS"],
      yoe: [0, 1], ctc: [4.5, 4.5], src: [X.asmorix, X.felix, X.salIn, X.fh],
      rounds: xRounds(false),
    },
    {
      key: "aase", title: "Advanced Associate Software Engineer (Advanced ASE, CL-11)", level: "fresher", spec: "advanced-ase",
      description: "Higher fresher track with stronger coding expectations. Works on advanced engineering assignments for clients, often involving cloud, data or modern application stacks.",
      stack: ["Java", "Python", "SQL", "Cloud basics", "Data Structures"],
      yoe: [0, 1], ctc: [6.5, 6.5], src: [X.salAase, X.salIn, X.fh, X.gfg3],
      rounds: xRounds(true),
    },
  ],
};

// ---- Wipro ----
const W = {
  ppProc: "https://www.placementpreparation.io/blog/wipro-elite-nth-recruitment-process/",
  ppExp: "https://placementpreparation.io/blog/wipro-elite-nth-interview-experience",
  turbo: "https://prepinsta.com/?p=1612860",
  diff: "https://prepinsta.com/?p=1612812",
  nth: "https://prepinsta.com/wipro-nlth/recruitment-process",
  weekday: "https://www.weekday.works/post/wipro-interview-questions",
  offCampus: "https://www.weekday.works/post/wipro-off-campus-drive-2026",
  gfg22: "https://www.geeksforgeeks.org/?p=682891",
  gfg22b: "https://www.geeksforgeeks.org/?p=720390",
  faceprep: "https://www.faceprep.in/article/wipro-interview-questions/",
  ab: "https://ambitionbox.com/overview/wipro-overview",
  fy25: "https://indiacsr.in/wipro-fy25-results-r-89088-cr-revenue-rs-13135-cr-net-profit-up-19/",
  hc: "https://www.storyboard18.com/how-it-works/wipro-adds-10000-freshers-in-fy25-remains-cautious-on-wage-hikes-amid-global-uncertainity-62561.htm",
};
const wTest = (turbo: boolean): RoundIn => ({
  name: turbo ? "Online assessment (Turbo): aptitude, essay and coding" : "Online assessment (Elite NTH): aptitude, essay and coding", type: "dsa",
  minutes: 120, difficulty: turbo ? "medium" : "easy",
  topics: ["Quantitative aptitude", "Logical reasoning", "Verbal ability", "Essay writing", "Coding"],
  guidance: turbo
    ? "Quant, logical reasoning, English, essay writing and coding sections. High scorers are invited to an extra coding round for the Turbo package; it cannot be applied for separately."
    : "Aptitude, essay writing and coding sections; sources disagree on whether the full process is three or four rounds. Commonly cited eligibility is 60%+ throughout academics with no active backlogs.",
  src: turbo ? [W.turbo, W.diff, W.ppProc] : [W.ppProc, W.nth, W.offCampus],
});
const wTech = (turbo: boolean): RoundIn => ({
  name: "Technical interview", type: "lld", minutes: turbo ? 45 : 30, difficulty: turbo ? "medium" : "easy",
  topics: ["Four pillars of OOP with real-world examples", "Encapsulation vs data hiding", "Tables vs views", "Types of joins",
    "Primary and foreign keys", "SQL (for example the second highest salary)", "Resume projects"],
  guidance: "Resume-driven technical interview, reported at 15-45 minutes. Candidates stress preparing your own projects in depth alongside OOP and DBMS basics.",
  src: [W.gfg22, W.gfg22b, W.ppExp, W.weekday],
});
const wHr = (): RoundIn => ({
  name: "HR interview", type: "behavioural", minutes: 15, difficulty: "easy",
  topics: ["Projects", "Why Wipro", "Relocation", "Service agreement"],
  guidance: "Short online HR round (about 10-15 minutes); HR is reported to ask about your projects as well.",
  src: [W.ppExp, W.gfg22b],
});

const wipro: CompanyIn = {
  name: "Wipro", slug: "wipro", tier: 3,
  tierRationale: "Fresher packages of about ₹3.5 LPA (Elite NTH) and up to ₹6.5 LPA (Turbo) at a mass recruiter that hired about 10,000 freshers in FY25; an assessment-led process typical of Tier 3 IT services.",
  hq: "Bengaluru, India", size: "232,346 employees (31 March 2025)",
  website: "https://careers.wipro.com", aliases: ["Wipro Limited", "Wipro Technologies", "Wipro Elite NTH", "Wipro Turbo"],
  sector: "it-services", businessModel: "service", headcountBand: "232,346 (FY25 end)",
  revenueBand: "FY25 revenue ₹89,088 crore", fundingStage: "public",
  wlbRating: 3.7, wlbReviewCount: 53400,
  reviewSummary: "Rated 3.7/5 on AmbitionBox from about 53,400 reviews, with work-life balance 3.7/5 and job security 3.8/5. Reviews describe flexible, manageable hours on many teams and long hours on some client projects.",
  reviewQuotes: [],
  overview: "Wipro is a Bengaluru IT-services company with about 232,000 employees and FY25 revenue of about ₹89,088 crore (IT services about $10.5 billion, down 2.7%). Freshers join through Elite NTH or the higher-paid Turbo track; attrition was 15% at the end of FY25.",
  culture: "Large services culture with mandatory pre-skilling before the final offer and project-dependent workload.",
  benefits: "Elite NTH about ₹3.5 LPA; Turbo reported at up to ₹6.5 LPA (one source lists ₹5.5 LPA plus a ₹1 lakh retention bonus).",
  src: [W.ab, W.fy25, W.hc],
  roles: [
    {
      key: "elite-nth", title: "Project Engineer (Wipro Elite NTH)", level: "fresher", spec: "elite-nth",
      description: "Entry-level Project Engineer hired through Wipro's Elite National Talent Hunt. After pre-skilling, work on development, testing or support for client projects. Expect an online assessment, a resume-driven technical interview on OOP, DBMS and SQL, and a short HR round.",
      stack: ["Java", "Python", "C", "SQL", "OOP", "Aptitude"],
      yoe: [0, 1], ctc: [3.5, 3.5], src: [W.ppProc, W.offCampus, W.diff],
      rounds: [wTest(false), wTech(false), wHr()],
    },
    {
      key: "turbo", title: "Project Engineer (Wipro Turbo)", level: "fresher", spec: "turbo",
      description: "Higher-band fresher track for strong online-assessment scorers, adding an extra coding round and a voice assessment of communication skills. Reported packages differ between ₹5.5 LPA plus a retention bonus and ₹6.5 LPA.",
      stack: ["Java", "Python", "Data Structures", "SQL", "OOP"],
      yoe: [0, 1], ctc: [5.5, 6.5], src: [W.turbo, W.diff, W.ppProc],
      rounds: [
        wTest(true),
        {
          name: "Additional coding round", type: "dsa", minutes: 60, difficulty: "medium",
          topics: ["Arrays", "Strings", "Basic data structures"],
          guidance: "Extra coding round for high scorers that decides the Turbo package.",
          src: [W.diff, W.ppProc],
        },
        {
          name: "Voice assessment", type: "behavioural", minutes: 20, difficulty: "easy",
          topics: ["Spoken English", "Communication"],
          guidance: "Communication assessment specific to the Turbo track.",
          src: [W.turbo],
        },
        wTech(true), wHr(),
      ],
    },
  ],
};

// ---- Cognizant ----
const CG = {
  drive: "https://www.talentd.in/articles/cognizant-2025-fresher-recruitment-drive-full-details-for-genc-genc-pro-genc-next-eligibility-salary-apply-link",
  reg: "https://www.talentd.in/articles/cognizant-freshers-hiring-2025-genc-registration-eligibility-and-deadline-details",
  campus: "https://offcampusjobs4u.com/cognizant-genc-campus-drive-2025/",
  ptu: "https://ptu.ac.in/wp-content/uploads/2024/10/Letter-Cognizant-GenC-campus-hiring-2025.pdf",
  ib: "https://www.interviewbit.com/genc-interview-questions/",
  lcNext: "https://leetcode.com/discuss/post/7323172/cognizant-genc-genc-pro-genc-next-interv-oxmt/",
  lcNext2: "https://leetcode.com/discuss/interview-experience/7328207",
  gdJava: "https://www.glassdoor.com/Interview/Cognizant-Interview-E8014-RVW53913521.htm",
  gdOop: "https://www.glassdoor.ie/Interview/Cognizant-Interview-E8014-RVW72131842.htm",
  gdSql: "https://www.glassdoor.com/Interview/Cognizant-Interview-E8014-RVW56937328.htm",
  ab: "https://ambitionbox.com/overview/cognizant-overview",
  fy25: "https://news.cognizant.com/2026-02-04-Cognizant-Reports-Fourth-Quarter-and-Full-Year-2025-Results?asPDF=1",
  hire: "https://www.outlookbusiness.com/corporate/cognizant-to-hire-20000-freshers-in-2025-after-q1-earnings-beat-estimates",
};
const cgScreen = (): RoundIn => ({
  name: "Communication, aptitude and technical assessment", type: "dsa", minutes: 120, difficulty: "easy",
  topics: ["Spoken and written English", "Quantitative aptitude", "Logical reasoning", "Programming basics"],
  guidance: "Online screening after one-stop registration: a communication and aptitude test followed by a technical assessment. Shortlisted candidates are told which track (GenC, GenC Pro or GenC Next) they will be interviewed for.",
  src: [CG.campus, CG.ptu, CG.drive],
});
const cgTech = (next: boolean): RoundIn => ({
  name: next ? "Technical interview 1 (GenC Next)" : "Technical / SME interview", type: "lld", minutes: next ? 45 : 30, difficulty: next ? "medium" : "easy",
  topics: ["OOP", "Programming logic", "Java (JDBC, Spring basics) or Python (memory management)", "SQL queries",
    "Small coding tasks (pattern printing, string reversal)", "Resume projects", ...(next ? ["Data structures", "Cloud fundamentals"] : [])],
  guidance: "Online technical interview (reported on the Superset platform) of about 30-45 minutes on computer fundamentals, your resume projects and small coding problems. Candidate reports list Java, OOP, SQL, data structures and cloud basics.",
  src: next ? [CG.ib, CG.gdSql, CG.gdOop, CG.lcNext] : [CG.gdJava, CG.gdOop, CG.gdSql, CG.ib],
});

const cognizant: CompanyIn = {
  name: "Cognizant", slug: "cognizant", tier: 3,
  tierRationale: "Fresher packages of about ₹4.0 LPA (GenC), ₹5.4 LPA (GenC Pro) and ₹6.75 LPA (GenC Next) at a mass recruiter that planned 20,000 fresher hires in 2025: Tier 3 IT services.",
  hq: "Teaneck, New Jersey, USA (large India delivery centres)", size: "351,600 employees (31 December 2025)",
  website: "https://careers.cognizant.com", aliases: ["Cognizant Technology Solutions", "CTS", "Cognizant GenC"],
  sector: "it-services", businessModel: "service", headcountBand: "351,600 (Dec 2025)",
  revenueBand: "2025 revenue $21.1B (+7%)", fundingStage: "public",
  wlbRating: null, wlbReviewCount: null,
  reviewSummary: "Rated 3.8/5 on AmbitionBox from about 49,900 reviews. Work-life balance reviews vary by project: many call it good, while others report long hours near project deadlines; no separate category score was found.",
  reviewQuotes: [],
  overview: "Cognizant is a US-headquartered IT-services company with most of its workforce in India. 2025 revenue was $21.1 billion (+7%) and year-end headcount 351,600. Freshers are hired into GenC, GenC Pro (enterprise platforms such as Salesforce, SAP and Pega) and GenC Next (advanced coding and full-stack) tracks.",
  culture: "Large services organisation where workload depends on the project; freshers go through structured training before project allocation.",
  benefits: "GenC (Programmer Analyst Trainee) about ₹4.0 LPA, GenC Pro about ₹5.4 LPA and GenC Next about ₹6.75 LPA; GenC Next is reported to include a paid three-month internship before the differential package.",
  src: [CG.ab, CG.fy25, CG.hire],
  roles: [
    {
      key: "genc", title: "Programmer Analyst Trainee (GenC)", level: "fresher", spec: "genc",
      description: "Entry-level Programmer Analyst Trainee in Cognizant delivery teams. After training, work on development, testing or support for client projects. The process is online screening followed by a technical or SME interview.",
      stack: ["Java", "Python", "SQL", "OOP", "Aptitude"],
      yoe: [0, 1], ctc: [4.0, 4.0], src: [CG.drive, CG.campus, CG.reg],
      rounds: [cgScreen(), cgTech(false)],
    },
    {
      key: "genc-pro", title: "Programmer Analyst (GenC Pro)", level: "fresher", spec: "genc-pro",
      description: "Fresher track for candidates with enterprise-platform skills such as Salesforce, SAP or Pega, at about ₹5.4 LPA.",
      stack: ["Salesforce", "SAP", "Pega", "SQL", "Java"],
      yoe: [0, 1], ctc: [5.4, 5.5], src: [CG.drive, CG.reg],
      rounds: [cgScreen(), { ...cgTech(false), topics: ["Enterprise platform basics", "OOP", "SQL", "Resume projects"] }],
    },
    {
      key: "genc-next", title: "Programmer Analyst (GenC Next)", level: "fresher", spec: "genc-next",
      description: "Top fresher track for advanced coders with full-stack skills, at about ₹6.75 LPA after a paid three-month internship. Candidates report two technical interviews, the second covering web basics.",
      stack: ["Java", "Python", "Data Structures", "HTML", "CSS", "JavaScript", "SQL"],
      yoe: [0, 1], ctc: [6.75, 6.75], src: [CG.drive, CG.lcNext, CG.lcNext2],
      rounds: [
        cgScreen(), cgTech(true),
        {
          name: "Technical interview 2 (GenC Next)", type: "lld", minutes: 30, difficulty: "medium",
          topics: ["HTML basics", "CSS basics", "JavaScript basics", "Resume projects"],
          guidance: "A second technical round of about 30 minutes, reported in November 2025, with web-fundamentals questions.",
          src: [CG.lcNext2, CG.lcNext],
        },
      ],
    },
  ],
};

export const TIER3: CompanyIn[] = [tcs, infosys, accenture, wipro, cognizant];
