import type { RoundType } from "@/features/interview";
import { MOCK_ROUND_MINUTES } from "@/lib/constants/interview";
import type { RoundNode } from "./types";

type PresetDetails = {
  id: string;
  label: string;
  category: string;
  description: string;
  keywords: string[];
  topics: string[];
  instructions: string;
  difficulty: RoundNode["difficulty"];
};

export type NodePreset = PresetDetails & (
  | { kind: "round"; type: RoundType; durationMinutes: number }
  | { kind: "info"; note: string }
);

export const NODE_CATEGORIES: readonly { id: string; label: string; description: string }[] = [
  { id: "coding", label: "Coding foundations & algorithms", description: "Problem solving, data structures and implementation." },
  { id: "languages", label: "Programming languages", description: "Language idioms, runtimes and concurrency." },
  { id: "frontend", label: "Frontend & accessibility", description: "Web interfaces, browsers, performance and inclusive design." },
  { id: "backend", label: "Backend & APIs", description: "Service contracts, integration and application reliability." },
  { id: "fullstack", label: "Fullstack engineering", description: "End-to-end product flows and cross-layer trade-offs." },
  { id: "mobile", label: "Mobile development", description: "Native and cross-platform apps, offline behaviour and device constraints." },
  { id: "databases", label: "Databases & storage", description: "Queries, schemas, transactions and storage engines." },
  { id: "data-engineering", label: "Data engineering", description: "Batch, streaming, orchestration and data quality." },
  { id: "data-science", label: "Data science & analytics", description: "Statistics, experiments and decision-focused analysis." },
  { id: "ai", label: "AI, ML & LLMs", description: "Models, retrieval, evaluation and responsible AI systems." },
  { id: "cloud", label: "Cloud, platform & SRE", description: "Infrastructure, deployment, observability and operations." },
  { id: "security", label: "Security & privacy", description: "Threat modelling, secure engineering and privacy controls." },
  { id: "testing", label: "QA & testing", description: "Test strategy, automation, quality assurance and diagnosis." },
  { id: "systems", label: "Systems, embedded & games", description: "Low-level software, hardware constraints and interactive systems." },
  { id: "architecture", label: "Architecture & design", description: "Object design, distributed systems and technical trade-offs." },
  { id: "career", label: "Leadership, behavioural & career", description: "Ownership, collaboration, project discussion and career development." },
  { id: "reference", label: "Reference & external steps", description: "Planning notes for activities recorded outside a runnable practice round." },
];

const roles: Record<string, string> = {
  coding: "software engineer", languages: "language-focused developer", frontend: "frontend engineer",
  backend: "backend engineer", fullstack: "fullstack engineer", mobile: "mobile engineer",
  databases: "database engineer", "data-engineering": "data engineer", "data-science": "data scientist",
  ai: "AI/ML engineer", cloud: "platform or site reliability engineer", security: "security engineer",
  testing: "QA or test automation engineer", systems: "systems engineer", architecture: "software architect",
  career: "technical contributor or leader",
};

/** Each exercise is a starting point, rather than a claim about a company's hiring process. */
function round(
  id: string, label: string, category: string, type: RoundType, topics: string[], exercise: string,
  keywords: string[] = [], difficulty: RoundNode["difficulty"] = "medium",
): Extract<NodePreset, { kind: "round" }> {
  return {
    // Presets store the 45 maximum; the real length (30-45) is drawn per session at booking.
    id, label, category, kind: "round", type, topics, keywords, difficulty, durationMinutes: MOCK_ROUND_MINUTES,
    description: exercise,
    instructions: `Practise as a ${roles[category]}. ${exercise} Ask about the user's experience and preferred stack first; adapt scope, hints and follow-ups to their level. Start with a concrete example, clarify assumptions, and ask them to explain decisions and verify edge cases. Give feedback on correctness, trade-offs and communication using evidence from this exercise.`,
  };
}

/** Keep these first so the legacy type-to-default mapping remains stable. */
const originalPresets: Extract<NodePreset, { kind: "round" }>[] = [
  round("coding", "Coding & algorithms", "coding", "dsa", ["Arrays", "Trees", "Dynamic programming"], "Solve a bounded scheduling problem, explain complexity and test empty and duplicate inputs.", [], "medium"),
  round("architecture", "System architecture", "architecture", "system-design", ["Scalability", "Storage", "Trade-offs"], "Design a scalable notification service with storage choices, failure handling and capacity estimates.", [], "hard"),
  round("object-design", "Object-oriented design", "architecture", "lld", ["Object-oriented design", "Extensibility"], "Model a booking domain and show how an additional pricing rule can be added without breaking callers.", [], "medium"),
  round("behavioural", "Behavioural & ownership", "career", "behavioural", ["Ownership", "Collaboration"], "Discuss a real ownership challenge, identify your actions and reflect on collaboration and outcomes."),
  round("project", "Project deep-dive", "career", "hiring-manager", ["Project deep-dive", "Technical decisions"], "Walk through a project you contributed to, explain a key decision and separate your work from team outcomes."),
  round("frontend", "Frontend system design", "frontend", "system-design", ["Component architecture", "State management", "Accessibility"], "Design an accessible dashboard with component boundaries, asynchronous state and error recovery.", [], "medium"),
  round("browser", "Browser & JavaScript", "frontend", "lld", ["Event loop", "DOM", "Rendering performance"], "Diagnose an unresponsive browser interaction and explain event-loop scheduling and rendering work."),
  round("backend-api", "Backend & API design", "backend", "system-design", ["API contracts", "Authentication", "Reliability"], "Design an order API with authentication, idempotency and documented error contracts.", [], "medium"),
  { ...round("sql-data", "SQL & data modelling", "databases", "dsa", ["SQL", "Joins", "Indexes", "Data modelling"], "Write a sales aggregation query, verify joins and compare index choices."), instructions: "Focus on data reasoning, query correctness and trade-offs." },
  round("ml-ai", "ML & AI systems", "ai", "system-design", ["Model evaluation", "Inference", "Data pipelines"], "Design a prediction service with evaluation, serving constraints and data feedback loops.", [], "hard"),
  round("debugging", "Debugging & troubleshooting", "testing", "lld", ["Root cause analysis", "Observability", "Regression diagnosis"], "Investigate a reproducible regression from logs and a minimal example, then propose a fix and regression check."),
  round("devops", "DevOps & cloud", "cloud", "system-design", ["CI/CD", "Cloud infrastructure", "Incident response"], "Plan a service deployment with an observable rollout, rollback path and incident runbook.", [], "medium"),
  round("machine-coding", "Machine coding", "coding", "lld", ["Implementation", "Testing", "Maintainability"], "Implement a small task scheduler with a clear interface, tests and maintainable state transitions.", [], "hard"),
  round("leadership", "Technical leadership", "career", "hiring-manager", ["Mentoring", "Roadmap prioritisation", "Stakeholder alignment"], "Work through a roadmap conflict, propose priorities and show how you would mentor and align stakeholders.", ["staff", "principal"], "hard"),
];

const specialistPresets: Extract<NodePreset, { kind: "round" }>[] = [
  // Foundations and algorithmic problem solving.
  round("coding-foundations", "Coding foundations", "coding", "dsa", ["Control flow", "Functions", "Testing"], "Implement a text frequency counter and test empty input, punctuation and case sensitivity.", ["graduate", "junior", "entry level"], "easy"),
  round("arrays-hashing", "Arrays & hash maps", "coding", "dsa", ["Arrays", "Hash maps", "Complexity"], "Find duplicate events within a time window and compare a naive approach with a hash-based one."),
  round("linked-lists", "Linked lists & pointers", "coding", "dsa", ["Linked lists", "Pointer invariants", "Cycles"], "Reverse segments of a linked list and explain pointer invariants and cycle detection."),
  round("trees-graphs", "Trees & graph traversal", "coding", "dsa", ["BFS", "DFS", "Topological sorting"], "Find an execution order for dependent tasks and report a cycle with a concrete example."),
  round("dynamic-programming", "Dynamic programming", "coding", "dsa", ["Recurrences", "Memoisation", "State design"], "Solve a constrained resource allocation problem and derive the recurrence before optimising memory.", [], "hard"),
  round("search-sort", "Searching & sorting", "coding", "dsa", ["Binary search", "Sorting", "Invariants"], "Locate the first feasible capacity for a workload and prove the search boundary conditions."),
  round("heaps-intervals", "Heaps & interval scheduling", "coding", "dsa", ["Priority queues", "Intervals", "Greedy algorithms"], "Schedule overlapping meetings using a heap and explain why the greedy choice is correct."),
  round("coding-review", "Code review & refactoring", "coding", "lld", ["Code review", "Refactoring", "Behaviour preservation"], "Review a small parser, identify risky changes and refactor it while preserving tested behaviour."),
  // Language-specific practice.
  round("python", "Python engineering", "languages", "lld", ["Iterators", "Typing", "Exceptions"], "Build a streaming CSV validator using iterators, typed records and explicit error handling."),
  round("java", "Java engineering", "languages", "lld", ["Collections", "Generics", "Concurrency"], "Implement a bounded worker queue and reason about collection choice and thread safety."),
  round("typescript", "TypeScript engineering", "languages", "lld", ["Union types", "Generics", "Runtime validation"], "Model an API result with discriminated unions and validate untrusted runtime input.", ["ts"]),
  round("javascript", "JavaScript engineering", "languages", "lld", ["Closures", "Promises", "Async cancellation"], "Implement cancellable asynchronous search and diagnose a stale response race.", ["js"]),
  round("go", "Go engineering", "languages", "lld", ["Goroutines", "Channels", "Context"], "Implement a concurrent fetch worker with context cancellation and bounded goroutines.", ["golang"]),
  round("rust", "Rust engineering", "languages", "lld", ["Ownership", "Lifetimes", "Error handling"], "Write a record parser and explain ownership choices, error propagation and allocation costs."),
  round("cpp", "C++ engineering", "languages", "lld", ["RAII", "Move semantics", "Memory safety"], "Implement an RAII resource wrapper and explain copy, move and exception-safety behaviour.", ["c++", "cpp"]),
  round("csharp", "C# & .NET engineering", "languages", "lld", ["LINQ", "Async await", "Dependency injection"], "Implement an asynchronous repository service with cancellation and testable dependencies.", ["c#", "dotnet"]),
  // Web interfaces and inclusive design.
  round("react", "React component engineering", "frontend", "lld", ["Hooks", "Components", "Async state"], "Build a searchable list with loading, empty and error states, then explain effect cleanup."),
  round("css-layout", "CSS & responsive layout", "frontend", "lld", ["Grid", "Flexbox", "Responsive design"], "Implement a responsive settings layout and debug overflow at narrow widths."),
  round("accessibility", "Accessibility & inclusive UI", "frontend", "lld", ["Keyboard navigation", "ARIA", "WCAG", "Focus management"], "Audit a modal and form, repair keyboard focus and labels, and demonstrate a screen-reader-friendly flow.", ["a11y", "accessibility"]),
  round("web-performance", "Web performance", "frontend", "system-design", ["Core Web Vitals", "Bundles", "Caching"], "Investigate a slow product page and propose measurable improvements to loading and interaction latency."),
  round("design-systems", "Design system engineering", "frontend", "system-design", ["Tokens", "Component APIs", "Accessibility"], "Design reusable form primitives with tokens, accessible states and a versioning strategy."),
  round("frontend-state", "Frontend state & data fetching", "frontend", "lld", ["Server state", "Optimistic updates", "Race conditions"], "Implement an optimistic edit flow with rollback and cache invalidation when requests overlap."),
  // Backend service boundaries.
  round("rest-contracts", "REST API contracts", "backend", "system-design", ["HTTP", "Pagination", "Versioning"], "Specify a paginated inventory API, including status codes, validation and compatible evolution."),
  round("graphql", "GraphQL service design", "backend", "system-design", ["Schemas", "Resolvers", "N+1 queries"], "Design a product graph and resolve N+1 queries while enforcing field-level access."),
  round("grpc", "gRPC & service integration", "backend", "system-design", ["Protobuf", "Deadlines", "Compatibility"], "Define a service contract and work through deadlines, retries and backward-compatible field changes."),
  round("backend-concurrency", "Backend concurrency", "backend", "lld", ["Locks", "Idempotency", "Race conditions"], "Prevent duplicate reservations under concurrent requests and explain the correctness boundary."),
  round("event-services", "Event-driven backend", "backend", "system-design", ["Messaging", "Outbox", "Retries"], "Design reliable order events using an outbox, consumer deduplication and poison-message handling."),
  round("backend-caching", "Backend caching", "backend", "system-design", ["TTL", "Invalidation", "Cache stampedes"], "Add a cache to a catalogue service and reason through stale data and a traffic spike."),
  // End-to-end product implementation.
  round("fullstack-feature", "Fullstack feature delivery", "fullstack", "lld", ["UI", "API", "Persistence"], "Implement a saved-items flow across UI, API and database, including duplicate and offline errors.", [], "medium"),
  round("fullstack-auth", "Fullstack authentication", "fullstack", "system-design", ["Sessions", "Authorisation", "CSRF"], "Design a sign-in and protected-resource flow with session expiry and permission checks."),
  round("fullstack-debug", "Cross-layer debugging", "fullstack", "lld", ["Network traces", "Logs", "Data consistency"], "Trace a missing form submission across browser, API and storage and isolate the failing boundary."),
  round("realtime-product", "Realtime product design", "fullstack", "system-design", ["WebSockets", "Presence", "Reconnection"], "Design a collaborative board with reconnect handling, presence and conflicting edits."),
  round("payments-flow", "Payments & checkout engineering", "fullstack", "system-design", ["Webhooks", "Idempotency", "Reconciliation"], "Design a checkout state machine that handles delayed webhooks, duplicate callbacks and refunds."),
  // Mobile platforms.
  round("ios", "iOS & Swift engineering", "mobile", "lld", ["Swift", "SwiftUI", "App lifecycle"], "Implement a SwiftUI list with cancellable loading and explain lifecycle-driven state updates."),
  round("android", "Android & Kotlin engineering", "mobile", "lld", ["Kotlin", "Compose", "Lifecycle"], "Implement a Compose screen with lifecycle-aware collection and rotation-safe state."),
  round("react-native", "React Native engineering", "mobile", "lld", ["Native bridges", "Navigation", "Performance"], "Build a paginated mobile list and diagnose unnecessary renders and native-boundary costs."),
  round("flutter", "Flutter engineering", "mobile", "lld", ["Dart", "Widgets", "State management"], "Implement a Flutter form with asynchronous validation and testable state transitions."),
  round("mobile-offline", "Offline-first mobile systems", "mobile", "system-design", ["Local storage", "Sync", "Conflict resolution"], "Design an offline field-reporting app with queued edits, conflict resolution and battery constraints."),
  // Databases.
  round("sql-queries", "SQL query reasoning", "databases", "dsa", ["Window functions", "Joins", "NULL semantics"], "Calculate customer retention by cohort and validate duplicates, NULLs and date boundaries."),
  round("database-transactions", "Transactions & isolation", "databases", "system-design", ["ACID", "Isolation", "Deadlocks"], "Prevent overselling stock and compare anomalies under different transaction isolation levels."),
  round("database-indexing", "Database indexing & tuning", "databases", "lld", ["Query plans", "Composite indexes", "Cardinality"], "Read a slow query plan, select an index and explain the effect on writes and storage."),
  round("nosql", "NoSQL data modelling", "databases", "system-design", ["Document stores", "Partition keys", "Access patterns"], "Model an activity feed from its read patterns and plan for hot partitions and schema evolution."),
  round("database-migrations", "Database migrations", "databases", "system-design", ["Expand-contract", "Backfills", "Rollback"], "Plan a zero-downtime column migration with a resumable backfill and compatibility checks."),
  // Data engineering.
  round("batch-pipelines", "Batch data pipelines", "data-engineering", "system-design", ["ETL", "Partitioning", "Idempotency"], "Design a daily ingestion pipeline that safely reprocesses late and duplicate files."),
  round("streaming-data", "Streaming data engineering", "data-engineering", "system-design", ["Kafka", "Watermarks", "Event time"], "Compute streaming window aggregates and handle late events, replay and consumer failures."),
  round("data-orchestration", "Data orchestration", "data-engineering", "system-design", ["DAGs", "Airflow", "Backfills"], "Build a dependency-aware pipeline plan with retry policies and a historical backfill."),
  round("warehouse-modelling", "Warehouse & analytics modelling", "data-engineering", "system-design", ["Dimensional modelling", "dbt", "Slowly changing dimensions"], "Model sales facts and customer dimensions and preserve historical changes for reporting."),
  round("data-quality", "Data quality & lineage", "data-engineering", "lld", ["Contracts", "Quality checks", "Lineage"], "Implement checks for a customer feed and explain how schema drift reaches downstream reports."),
  round("spark", "Spark & distributed processing", "data-engineering", "system-design", ["Shuffles", "Skew", "Partitioning"], "Diagnose a skewed join job and compare repartitioning, broadcast joins and incremental processing."),
  // Data science and statistical reasoning.
  round("statistics", "Statistics & inference", "data-science", "dsa", ["Distributions", "Confidence intervals", "Bias"], "Analyse a sampled conversion dataset and explain uncertainty, bias and what cannot be concluded."),
  round("experimentation", "Experimentation & A/B testing", "data-science", "system-design", ["Hypothesis testing", "Power", "Guardrail metrics"], "Design a checkout experiment with sample sizing, primary metrics and stopping rules."),
  round("product-analytics", "Product analytics", "data-science", "hiring-manager", ["Funnels", "Cohorts", "Decision making"], "Investigate a drop in activation using a funnel, segmentation and a concrete decision recommendation."),
  round("data-wrangling", "Data wrangling with Python", "data-science", "dsa", ["Pandas", "Missing values", "Data validation"], "Clean a messy tabular dataset and verify joins, missingness and transformations against sample rows."),
  round("causal-inference", "Causal inference", "data-science", "system-design", ["Confounding", "Counterfactuals", "Observational studies"], "Evaluate a policy change using observational data and identify confounders and sensitivity checks.", [], "hard"),
  // Machine learning and language model systems.
  round("ml-foundations", "Machine learning foundations", "ai", "dsa", ["Train-test splits", "Overfitting", "Metrics"], "Build a baseline classifier plan and choose splits and metrics without target leakage.", ["ai/ml"]),
  round("ml-features", "Feature engineering & evaluation", "ai", "lld", ["Features", "Leakage", "Cross validation"], "Construct features for a churn model and design evaluation that respects time and customer boundaries."),
  round("deep-learning", "Deep learning engineering", "ai", "lld", ["Training loops", "Gradients", "Regularisation"], "Diagnose an unstable training loop using loss curves, gradient checks and a small reproducible batch."),
  round("rag", "RAG & retrieval systems", "ai", "system-design", ["Retrieval augmented generation", "Embeddings", "Vector search"], "Design a document question-answering system with chunking, citations and retrieval evaluation.", ["rag", "retrieval"]),
  round("llm-evaluation", "LLM evaluation & reliability", "ai", "system-design", ["Evaluation datasets", "Hallucinations", "Monitoring"], "Create a task-specific evaluation set and compare model outputs for correctness, cost and latency.", ["llm", "generative ai"]),
  round("ai-agents", "AI agents & tool use", "ai", "system-design", ["Tool contracts", "State", "Recovery"], "Design a bounded tool-using assistant with validated inputs, explicit permissions and failure recovery.", ["llm", "agents"]),
  round("mlops", "MLOps & model serving", "ai", "system-design", ["Model registry", "Drift", "Serving"], "Plan a model rollout with versioned features, drift monitoring and rollback criteria."),
  // Operations and infrastructure.
  round("cloud-architecture", "Cloud infrastructure architecture", "cloud", "system-design", ["Networking", "IAM", "Availability zones"], "Design a cloud service across availability zones and explain network, identity and cost boundaries.", ["aws", "azure", "gcp"], "hard"),
  round("kubernetes", "Kubernetes operations", "cloud", "system-design", ["Deployments", "Probes", "Resource limits"], "Diagnose a failing Kubernetes rollout and adjust probes, resource requests and rollback strategy.", ["k8s"]),
  round("infrastructure-code", "Infrastructure as code", "cloud", "lld", ["Terraform", "State", "Drift"], "Review an infrastructure change and plan safe state handling, drift detection and environment separation.", ["iac"]),
  round("sre-reliability", "SRE reliability engineering", "cloud", "system-design", ["SLIs", "SLOs", "Error budgets"], "Define a service-level objective and use an error budget to prioritise reliability work.", ["sre"]),
  round("incident-response", "Production incident response", "cloud", "behavioural", ["Triage", "Communication", "Postmortems"], "Work through a production latency incident, prioritise mitigation and draft a blameless learning review."),
  round("observability", "Observability & diagnosis", "cloud", "system-design", ["Metrics", "Logs", "Tracing"], "Instrument a distributed request path and use traces and metrics to locate a latency bottleneck."),
  round("cicd", "CI/CD & release engineering", "cloud", "system-design", ["Build pipelines", "Canary releases", "Rollback"], "Design a deployment pipeline with meaningful checks, a canary and a tested rollback.", ["ci cd", "delivery"]),
  // Security and privacy.
  round("threat-modelling", "Threat modelling", "security", "system-design", ["Trust boundaries", "Abuse cases", "Mitigations"], "Threat-model a file-sharing service, identify trust boundaries and prioritise concrete mitigations."),
  round("application-security", "Application security", "security", "lld", ["OWASP", "Injection", "Secure coding"], "Review a vulnerable request handler and fix injection and access-control flaws with targeted checks.", ["appsec"]),
  round("identity-security", "Identity & access security", "security", "system-design", ["OAuth", "OIDC", "Least privilege"], "Design delegated access for an integration and work through token expiry and least-privilege scopes."),
  round("privacy-engineering", "Privacy engineering", "security", "system-design", ["Data minimisation", "Retention", "Deletion"], "Map personal data through a service and design minimisation, retention and verifiable deletion."),
  round("security-detection", "Security detection & response", "security", "system-design", ["Audit logs", "Detection rules", "Triage"], "Investigate suspicious login events and propose a detection rule with false-positive analysis."),
  // Quality engineering.
  round("test-strategy", "QA test strategy", "testing", "hiring-manager", ["Risk-based testing", "Coverage", "Exploratory testing"], "Create a risk-based test strategy for a checkout release and explain which failures matter most.", ["qa", "quality assurance"]),
  round("test-automation", "SDET & test automation", "testing", "lld", ["Fixtures", "Assertions", "Test isolation"], "Implement a maintainable API test suite with isolated data and useful failure diagnostics.", ["sdet", "qa"]),
  round("browser-testing", "Browser end-to-end testing", "testing", "lld", ["Playwright", "Selectors", "Async assertions"], "Test an asynchronous booking flow using stable selectors and meaningful assertions.", ["e2e", "qa"]),
  round("performance-testing", "Performance & load testing", "testing", "system-design", ["Workload modelling", "Latency percentiles", "Bottlenecks"], "Design a representative load test and distinguish saturation, client limits and service regressions.", ["qa"]),
  round("flaky-tests", "Flaky test diagnosis", "testing", "lld", ["Race conditions", "Isolation", "Determinism"], "Reproduce an intermittent failure and repair shared state or timing assumptions without hiding errors.", ["sdet", "qa"]),
  // Low-level and interactive software.
  round("operating-systems", "Operating systems fundamentals", "systems", "dsa", ["Processes", "Virtual memory", "Scheduling"], "Trace a process under memory pressure and explain paging, scheduling and context-switch costs.", ["os"]),
  round("networking", "Networking fundamentals", "systems", "system-design", ["TCP", "DNS", "TLS"], "Diagnose a connection timeout by tracing DNS, transport and TLS handshake boundaries."),
  round("embedded", "Embedded C & firmware", "systems", "lld", ["Interrupts", "Memory budgets", "Hardware interfaces"], "Design a sensor firmware loop with interrupt-safe state and a fixed memory budget.", ["embedded", "firmware"]),
  round("realtime-systems", "Realtime & RTOS design", "systems", "system-design", ["Deadlines", "Priority inversion", "Scheduling"], "Schedule control tasks with deadlines and analyse priority inversion and worst-case execution.", ["rtos"], "hard"),
  round("game-engineering", "Game systems engineering", "systems", "lld", ["Game loops", "Entity systems", "Frame budgets"], "Implement a simple entity update system and reason about deterministic updates and frame time.", ["unity", "unreal"]),
  round("graphics", "Graphics & rendering systems", "systems", "system-design", ["Rendering pipelines", "GPU", "Profiling"], "Diagnose a frame-time spike and compare CPU submission, GPU work and resource lifetime choices."),
  // Software architecture and design decisions.
  round("distributed-systems", "Distributed systems reasoning", "architecture", "system-design", ["Consistency", "Partitions", "Replication"], "Design replicated configuration storage and explain behaviour during a network partition.", [], "hard"),
  round("domain-design", "Domain-driven design", "architecture", "lld", ["Bounded contexts", "Aggregates", "Invariants"], "Model order and fulfilment contexts and place invariants at explicit aggregate boundaries."),
  round("architecture-review", "Architecture review & trade-offs", "architecture", "system-design", ["ADRs", "Constraints", "Evolution"], "Compare two service designs against real constraints and write a concise decision rationale.", ["staff", "principal"], "hard"),
  round("legacy-modernisation", "Legacy modernisation", "architecture", "system-design", ["Strangler pattern", "Compatibility", "Migration"], "Plan an incremental replacement of a legacy service with measurable checkpoints and rollback paths."),
  round("capacity-planning", "Capacity planning & resilience", "architecture", "system-design", ["Estimation", "Failure domains", "Backpressure"], "Estimate a bursty workload and design backpressure and degradation when capacity is exceeded."),
  // Technical communication and career practice.
  round("collaboration", "Collaboration & conflict", "career", "behavioural", ["Disagreement", "Feedback", "Alignment"], "Discuss a technical disagreement, explain how you listened and describe a constructive next step."),
  round("mentoring", "Mentoring & feedback", "career", "behavioural", ["Coaching", "Feedback", "Growth"], "Role-play feedback on a struggling project and propose a specific, supportive growth plan."),
  round("staff-influence", "Staff engineer influence", "career", "hiring-manager", ["Cross-team influence", "Strategy", "Technical leverage"], "Resolve a cross-team technical dependency and show how you would build alignment without authority.", ["staff", "principal"], "hard"),
  round("engineering-management", "Engineering management", "career", "hiring-manager", ["Team health", "Delivery", "Delegation"], "Balance a delivery deadline with team capacity and explain delegation and stakeholder communication.", ["em", "manager"]),
  round("graduate-career", "Graduate & early-career discussion", "career", "hiring-manager", ["Learning", "Projects", "Motivation"], "Explain a study, personal or work project and connect what you learned to the role you want.", ["graduate", "junior", "entry level"], "easy"),
  round("technical-communication", "Technical communication", "career", "behavioural", ["Audience adaptation", "Written reasoning", "Clarity"], "Explain a technical trade-off to both an engineer and a non-technical stakeholder using a concrete example."),
];

function reference(id: string, label: string, topics: string[], note: string, keywords: string[] = []): Extract<NodePreset, { kind: "info" }> {
  return {
    id, label, category: "reference", kind: "info", topics, note, keywords, difficulty: "medium",
    description: note,
    instructions: "Use this non-runnable reference step to record your own preparation, questions and external activity. Adapt the checklist to your experience and role. Do not infer assessment completion or hiring outcomes from this note.",
  };
}

const referencePresets: Extract<NodePreset, { kind: "info" }>[] = [
  reference("recruiter-screen", "Recruiter conversation (reference)", ["Role scope", "Logistics", "Questions"], "Record role expectations, scheduling constraints and questions for an external recruiter conversation. This is a planning note, not a simulated recruiter assessment.", ["recruiter", "screen"]),
  reference("online-assessment", "Online assessment (reference)", ["Format", "Time budget", "Preparation"], "Record the externally provided assessment format and preparation plan. Complete any actual assessment through its provider; this step does not run or certify it.", ["oa", "assessment"]),
  reference("take-home", "Take-home assignment (reference)", ["Scope", "Time budget", "Deliverables"], "Record an external assignment's brief, assumptions, deadline and submission checklist. Keep its real completion and feedback separate from this planning step.", ["take home", "assignment"]),
  reference("portfolio", "Portfolio review (reference)", ["Projects", "Evidence", "Presentation"], "Collect project links, describe your contribution and prepare an evidence-based walkthrough. This reference note does not independently evaluate or approve a portfolio."),
  reference("resume-review", "Resume preparation (reference)", ["Experience", "Impact", "Role alignment"], "Prepare concise, truthful experience examples and questions about role alignment. Record any external review feedback yourself.", ["cv", "resume"]),
  reference("pairing-session", "External pairing session (reference)", ["Setup", "Collaboration", "Notes"], "Record environment setup and collaboration goals for an externally arranged pairing session. Its delivery and feedback occur outside this step.", ["pair programming"]),
  reference("presentation", "Presentation preparation (reference)", ["Audience", "Narrative", "Questions"], "Plan the audience, technical narrative and questions for an external presentation. Add your own rehearsal notes; no presentation outcome is inferred."),
  reference("references-check", "References coordination (reference)", ["Contacts", "Consent", "Logistics"], "Record reference-contact logistics and obtain each person's consent externally. Add questions and follow-up dates from that external coordination.", ["references"]),
  reference("offer-discussion", "Offer discussion (reference)", ["Terms", "Questions", "Decision criteria"], "Record questions about externally supplied offer terms and your decision criteria. This step does not generate, accept or certify an offer.", ["offer", "negotiation"]),
  reference("career-plan", "Career planning checkpoint (reference)", ["Goals", "Skills", "Next steps"], "Write your current role goals and identify practical learning steps. Track your own progress here without treating it as a hiring decision.", ["graduate", "career"]),
  reference("accommodations", "Interview accommodations (reference)", ["Access needs", "Logistics", "Questions"], "Record questions about access needs and coordinate any arrangements directly with the organiser. This note does not request or confirm accommodations.", ["a11y", "accessibility"]),
  reference("external-feedback", "External feedback & follow-up (reference)", ["Feedback", "Reflection", "Follow-up"], "Record feedback actually received, distinguish observations from assumptions and choose a learning follow-up. This note does not imply passing an assessment.", ["debrief"]),
];

export const NODE_PRESETS: readonly NodePreset[] = [...originalPresets, ...specialistPresets, ...referencePresets];

/** Compatibility export: only runnable presets, in the same default-first order. */
export const ROUND_PRESETS: readonly Extract<NodePreset, { kind: "round" }>[] = NODE_PRESETS.filter(
  (preset): preset is Extract<NodePreset, { kind: "round" }> => preset.kind === "round",
);

function normalise(text: string): string {
  return text.toLowerCase()
    .replace(/c\+\+/g, " cpp ")
    .replace(/c#/g, " csharp ")
    .replace(/\.net\b/g, " dotnet ")
    .replace(/[^\p{L}\p{N}]+/gu, " ").trim().replace(/\s+/g, " ");
}

const searchIndex = NODE_PRESETS.map((preset) => ({
  preset,
  text: normalise([
    preset.label, preset.description, ...preset.topics, ...preset.keywords,
    NODE_CATEGORIES.find((category) => category.id === preset.category)?.label ?? preset.category,
  ].join(" ")),
}));

/** AND all query tokens; category and text constraints intersect. Guidance is intentionally excluded. */
export function filterNodePresets(query: string, category = "all"): NodePreset[] {
  const tokens = normalise(query).split(" ").filter(Boolean);
  return searchIndex.filter(({ preset, text }) =>
    (category === "all" || preset.category === category) && tokens.every((token) => text.includes(token)),
  ).map(({ preset }) => preset);
}
