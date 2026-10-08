/**
 * The JD fit dictionary (`docs/jd-fit.md`). Data only: adding a keyword is a one-line edit here.
 *
 * Keywords are matched case-insensitively as whole words (see `tagger.ts`), so `java` never matches
 * `javascript` and `go` never matches `google`. Keep keywords specific: a broad word (`student`,
 * `health`, `security`) tags far more resumes than it should.
 */

/** A canonical tag and the keywords that imply it. */
export interface VocabEntry {
  tag: string;
  keywords: string[];
}

/**
 * A canonical skill. `strict` aliases are common English words, so they only match in lists (tech,
 * skills, languages), never in prose. `impliedBy` lists skills whose use shows this one too: using
 * PostgreSQL is using SQL, a Terraform module is infrastructure as code.
 */
export interface SkillEntry {
  id: string;
  label: string;
  aliases: string[];
  strict?: string[];
  impliedBy?: string[];
  /** Role tags whose work shows this skill: every backend or frontend engineer works over HTTP. */
  impliedByRoles?: string[];
}

/** Company `sector` values that say nothing about the product domain: the domain part is dropped for them. */
export const GENERIC_SECTORS = ["it-services", "consumer-internet", "enterprise-software", "other"] as const;

/** Stack entries that are assessments or traits, not skills: left out of the skills part. */
export const NON_SKILL_STACK_TERMS: readonly string[] = ["aptitude", "operational excellence", "communication", "english", "reasoning", "leadership principles", "soft skills"];

/** Domains: the specific values of the company `sector` enum. */
export const DOMAINS: VocabEntry[] = [
  { tag: "fintech", keywords: ["fintech", "upi", "payment", "payments", "payment gateway", "payouts", "wallet", "wallets", "ledger", "kyc", "lending", "loan", "loans",
    "credit card", "credit cards", "credit line", "banking", "core banking", "neobank", "razorpay", "stripe", "paytm", "phonepe", "juspay", "trading", "stock market", "stock price",
    "brokerage", "invoice", "invoicing", "expense", "expenses", "split bill", "split bills", "splitwise", "insurance", "insurtech", "remittance", "nbfc", "emi", "upi payments",
    "transactions", "settlement", "settlements", "reconciliation", "refunds", "mutual fund", "mutual funds", "trades", "fraud detection"] },
  { tag: "e-commerce", keywords: ["e-commerce", "ecommerce", "online store", "shopping cart", "cart", "checkout", "product catalog", "product catalogue", "catalogue", "marketplace",
    "inventory", "order management", "flipkart", "amazon clone", "meesho", "myntra", "shopify", "seller", "sellers", "storefront", "listings", "fulfilment", "fulfillment", "returns"] },
  { tag: "edtech", keywords: ["edtech", "e-learning", "elearning", "lms", "learning management", "online learning", "online course", "online courses", "learning app",
    "quiz app", "quiz platform", "student management", "classroom", "byjus", "unacademy", "coursera", "adaptive practice", "knowledge tracing"] },
  { tag: "healthtech", keywords: ["healthtech", "healthcare", "hospital", "patient", "patients", "doctor", "doctors", "clinic", "medical", "telemedicine",
    "pharmacy", "disease", "diagnosis", "ehr", "diet plan", "dietitians"] },
  { tag: "gaming", keywords: ["gaming", "game", "games", "game engine", "unity3d", "unreal engine", "multiplayer", "fantasy sports"] },
  // Not the bare word "delivery": "delivery teams" and "software delivery" are IT services, not logistics.
  { tag: "logistics", keywords: ["logistics", "deliveries", "food delivery", "grocery delivery", "delivery app", "delivery platform", "delivery fleet", "delivery-assignment", "delivery assignment",
    "delivery partner", "delivery partners", "order delivery", "ev delivery", "hyperlocal", "parcel", "parcels", "shipment", "shipments", "shipping", "fleet", "route optimization", "route optimisation",
    "courier", "supply chain", "warehouse management", "last mile", "last-mile", "ride-hailing", "ride hailing", "cab booking", "dispatch", "routing engine", "serviceability"] },
  { tag: "telecom", keywords: ["telecom", "telecommunication", "telecommunications", "5g", "4g", "lte", "voip", "telephony", "sms gateway"] },
  { tag: "semiconductors", keywords: ["semiconductor", "semiconductors", "vlsi", "verilog", "systemverilog", "fpga", "asic", "rtl design", "chip design"] },
  { tag: "saas", keywords: ["saas", "multi-tenant", "multitenant", "subscription billing", "b2b", "crm", "erp", "ticketing", "customer-support", "customer support", "helpdesk"] },
];

/** Role families. Specializations map onto these through `SPECIALIZATION_ROLES`. */
export const ROLES: VocabEntry[] = [
  { tag: "backend", keywords: ["backend", "back-end", "back end", "backend services", "server-side", "web server", "rest api", "rest apis", "restful", "api gateway",
    "microservice", "microservices", "service-oriented", "distributed systems", "distributed storage", "event-driven", "message queue", "pub/sub", "idempotent", "idempotency",
    "rate limiting", "sharding", "replication", "consensus", "raft", "paxos", "storage engine", "storage systems", "key-value store", "object store", "database internals",
    "payment gateway", "order management", "trading system", "matching engine", "reconciliation jobs", "tps", "qps", "p99", "p95", "high throughput", "high-throughput", "low latency", "low-latency",
    "spring boot", "springboot", "spring mvc", "express.js", "expressjs", "node.js", "nodejs", "nestjs", "django", "flask", "fastapi", "grpc", "graphql", "ruby on rails", "rails", "laravel",
    "asp.net", "ktor", "micronaut", "quarkus", "gin", "hibernate", "postgresql", "postgres", "mysql", "mongodb", "redis", "kafka", "rabbitmq", "cassandra", "dynamodb", "elasticsearch",
    "aerospike", "oracle", "sqs", "sns", "kinesis", "aws lambda", "lambda", "nats", "memcached"] },
  { tag: "frontend", keywords: ["frontend", "front-end", "front end", "react", "reactjs", "react.js", "next.js", "nextjs", "angular", "vue", "vue.js", "vuejs",
    "svelte", "html", "css", "tailwind", "tailwindcss", "redux", "user interface", "responsive design", "single page application", "web vitals", "lcp", "lighthouse",
    "ui components", "component library", "design system", "design systems", "storybook", "pwa", "service worker", "web performance", "ember", "vite", "webpack",
    "react server components", "electron", "dom", "web client"] },
  { tag: "fullstack", keywords: ["full stack", "full-stack", "fullstack", "mern", "mean stack", "mevn", "pern"] },
  { tag: "android", keywords: ["android", "kotlin", "jetpack compose", "jetpack", "android studio", "play store", "flutter", "react native", "room", "retrofit", "hilt", "dagger", "mvvm", "gradle"] },
  { tag: "ios", keywords: ["ios", "swiftui", "swift", "xcode", "app store", "objective-c", "flutter", "react native"] },
  { tag: "data-engineering", keywords: ["data engineering", "data engineer", "data pipeline", "data pipelines", "etl", "elt", "spark", "pyspark", "hadoop", "airflow",
    "data warehouse", "bigquery", "snowflake", "redshift", "dbt", "databricks", "hive", "kafka streams", "flink", "emr", "parquet", "data quality", "great expectations",
    "feature pipeline", "feature pipelines", "lakehouse", "delta lake", "iceberg", "metabase", "informatica", "data platform"] },
  { tag: "data-science", keywords: ["data science", "data scientist", "statistics", "statistical", "hypothesis", "a/b testing", "a/b test", "a/b tested", "experimentation",
    "experiment design", "pandas", "jupyter", "regression", "forecasting", "forecast", "analytics", "data analysis", "kaggle", "demand-forecasting", "demand forecasting"] },
  { tag: "ml", keywords: ["machine learning", "ml", "deep learning", "neural network", "neural networks", "nlp", "natural language processing",
    "computer vision", "tensorflow", "pytorch", "keras", "scikit-learn", "sklearn", "llm", "llms", "transformer", "transformers", "cnn", "rnn", "lstm",
    "rag", "langchain", "opencv", "yolo", "hugging face", "huggingface", "recommendation", "recommender", "ranking model", "ranking models", "two-tower", "jax",
    "fine-tuned", "fine-tuning", "vit", "resnet", "classifier", "knowledge tracing", "model serving", "torchserve", "lightgbm", "xgboost"] },
  { tag: "devops", keywords: ["devops", "sre", "site reliability", "kubernetes", "k8s", "terraform", "ansible", "jenkins", "helm", "prometheus", "grafana",
    "ci/cd pipeline", "ci/cd pipelines", "infrastructure as code", "argocd", "argo cd", "karpenter", "eks", "gke", "aks", "slo", "slos", "on-call", "incident", "incidents",
    "mttr", "cloudformation", "pulumi", "landing zone", "patching", "observability", "github actions"] },
  { tag: "embedded", keywords: ["embedded", "firmware", "microcontroller", "microcontrollers", "arduino", "raspberry pi", "esp32", "stm32", "rtos", "iot",
    "embedded c", "fpga", "verilog"] },
  { tag: "security", keywords: ["cybersecurity", "cyber security", "information security", "appsec", "penetration testing", "pentesting", "pentest",
    "vulnerability assessment", "owasp", "ctf", "malware", "siem", "intrusion detection", "ethical hacking"] },
  { tag: "qa", keywords: ["qa", "quality assurance", "test automation", "automation testing", "selenium", "cypress", "playwright", "appium", "testng",
    "manual testing", "sdet", "test engineer", "regression testing"] },
];

/** JD `specialization` (lowercased) → the role tags that satisfy it. Unknown specializations are generalist roles (any tag). */
export const SPECIALIZATION_ROLES: Record<string, string[]> = {
  "backend": ["backend", "fullstack"],
  "frontend": ["frontend", "fullstack"],
  "fullstack": ["fullstack"],
  "full-stack": ["fullstack"],
  "full stack": ["fullstack"],
  "android": ["android"],
  "ios": ["ios"],
  "mobile": ["android", "ios"],
  "data-engineering": ["data-engineering"],
  "data engineering": ["data-engineering"],
  "data": ["data-engineering", "data-science"],
  "data-science": ["data-science", "ml", "data-engineering"],
  "data science": ["data-science", "ml", "data-engineering"],
  "ml": ["ml", "data-science"],
  "ai": ["ml", "data-science"],
  "ai-ml": ["ml", "data-science"],
  "machine-learning": ["ml", "data-science"],
  "machine learning": ["ml", "data-science"],
  "devops": ["devops"],
  "sre": ["devops"],
  "platform": ["devops"],
  "infrastructure": ["devops"],
  "cloud": ["devops"],
  "embedded": ["embedded"],
  "firmware": ["embedded"],
  "security": ["security"],
  "qa": ["qa"],
  "sdet": ["qa"],
};

/** Canonical skills. JD stack terms not listed here fall back to an exact normalized-string match. */
export const SKILLS: SkillEntry[] = [
  // Languages
  { id: "java", label: "Java", aliases: ["java", "core java", "java ee"] },
  { id: "python", label: "Python", aliases: ["python", "python3", "jupyter notebook", "jupyter"] },
  { id: "javascript", label: "JavaScript", aliases: ["javascript", "js", "es6", "ecmascript"] },
  { id: "typescript", label: "TypeScript", aliases: ["typescript", "ts"] },
  { id: "go", label: "Go", aliases: ["golang", "go lang"], strict: ["go"] },
  { id: "c", label: "C", aliases: ["c language", "c programming", "embedded c"], strict: ["c"] },
  { id: "cpp", label: "C++", aliases: ["c++", "cpp"] },
  { id: "csharp", label: "C#", aliases: ["c#", "csharp", "c sharp"] },
  { id: "dotnet", label: ".NET", aliases: [".net", "dotnet", "asp.net", ".net core"] },
  { id: "kotlin", label: "Kotlin", aliases: ["kotlin"] },
  { id: "swift", label: "Swift", aliases: ["swiftui"], strict: ["swift"] },
  { id: "rust", label: "Rust", aliases: ["rust", "rustlang"] },
  { id: "ruby", label: "Ruby", aliases: ["ruby", "ruby on rails", "rails"] },
  { id: "php", label: "PHP", aliases: ["php", "laravel"] },
  { id: "scala", label: "Scala", aliases: ["scala"] },
  { id: "dart", label: "Dart", aliases: ["dart"] },
  { id: "haskell", label: "Haskell", aliases: ["haskell"] },
  // Mobile
  { id: "flutter", label: "Flutter", aliases: ["flutter"] },
  { id: "react-native", label: "React Native", aliases: ["react native", "react-native"] },
  { id: "android", label: "Android", aliases: ["android", "android sdk", "android studio", "jetpack compose"] },
  { id: "ios", label: "iOS", aliases: ["ios", "uikit"] },
  // Web
  { id: "nodejs", label: "Node.js", aliases: ["node.js", "nodejs", "node js"], strict: ["node"] },
  { id: "express", label: "Express", aliases: ["express.js", "expressjs"], strict: ["express"] },
  { id: "react", label: "React", aliases: ["react", "reactjs", "react.js", "react server components"] },
  { id: "nextjs", label: "Next.js", aliases: ["next.js", "nextjs"] },
  { id: "angular", label: "Angular", aliases: ["angular", "angularjs"] },
  { id: "vue", label: "Vue", aliases: ["vue", "vue.js", "vuejs", "nuxt"] },
  { id: "redux", label: "Redux", aliases: ["redux", "redux toolkit"] },
  { id: "html", label: "HTML", aliases: ["html", "html5"], impliedByRoles: ["frontend", "fullstack"] },
  { id: "css", label: "CSS", aliases: ["css", "css3", "tailwind", "tailwindcss", "sass", "scss"], impliedByRoles: ["frontend", "fullstack"] },
  { id: "accessibility", label: "Web accessibility", aliases: ["accessibility", "web accessibility", "a11y", "wcag", "aria", "screen reader", "keyboard navigation", "keyboard access"] },
  { id: "web-applications", label: "Web applications", aliases: ["web applications", "web application", "web app", "web apps", "web development"],
    impliedBy: ["react", "nextjs", "angular", "vue", "express", "django", "flask", "fastapi", "spring-boot", "ruby", "php", "dotnet", "nodejs"], impliedByRoles: ["frontend", "fullstack", "backend"] },
  { id: "websockets", label: "WebSockets", aliases: ["websocket", "websockets", "socket.io"] },
  // Backend frameworks and APIs
  { id: "spring-boot", label: "Spring Boot", aliases: ["spring boot", "springboot", "spring-boot", "spring framework", "spring mvc"], strict: ["spring"] },
  { id: "django", label: "Django", aliases: ["django", "django rest framework", "drf"] },
  { id: "flask", label: "Flask", aliases: ["flask"] },
  { id: "fastapi", label: "FastAPI", aliases: ["fastapi"] },
  { id: "graphql", label: "GraphQL", aliases: ["graphql", "apollo"] },
  { id: "grpc", label: "gRPC", aliases: ["grpc"] },
  { id: "rest", label: "REST APIs", aliases: ["rest", "rest api", "rest apis", "restful", "api", "apis", "api design", "api development", "api contracts", "webhook", "webhooks"],
    impliedBy: ["express", "spring-boot", "django", "flask", "fastapi", "ruby", "nodejs", "graphql", "grpc", "dotnet", "php"], impliedByRoles: ["backend", "fullstack"] },
  { id: "http", label: "HTTP", aliases: ["http", "https", "http/2", "http lifecycle"],
    impliedBy: ["rest", "express", "spring-boot", "django", "flask", "fastapi", "react", "nextjs", "angular", "vue", "nodejs", "graphql", "ruby", "php", "dotnet", "grpc", "websockets", "microservices"], impliedByRoles: ["backend", "fullstack", "frontend"] },
  { id: "microservices", label: "Microservices", aliases: ["microservices", "microservice", "service-oriented", "soa"] },
  { id: "oop", label: "Object-oriented programming", aliases: ["oop", "oops", "object-oriented programming", "object oriented programming", "object-oriented design", "object oriented design", "ood", "design patterns", "solid principles", "solid"],
    impliedBy: ["java", "csharp", "kotlin", "cpp"] },
  // Data stores and messaging
  { id: "sql", label: "SQL", aliases: ["sql", "dbms", "databases", "database", "rdbms", "data modelling", "data modeling", "schema design", "tsql", "plsql", "pl/sql", "sql queries", "basic sql", "sqlite", "jdbc"],
    impliedBy: ["postgresql", "mysql", "oracle"] },
  { id: "postgresql", label: "PostgreSQL", aliases: ["postgresql", "postgres", "psql", "pgvector", "prisma"] },
  { id: "mysql", label: "MySQL", aliases: ["mysql", "mariadb"] },
  { id: "oracle", label: "Oracle", aliases: ["oracle", "oracle db", "oracle database"] },
  { id: "mongodb", label: "MongoDB", aliases: ["mongodb", "mongo", "mongoose"] },
  { id: "redis", label: "Redis", aliases: ["redis"] },
  { id: "cassandra", label: "Cassandra", aliases: ["cassandra"] },
  { id: "dynamodb", label: "DynamoDB", aliases: ["dynamodb"] },
  { id: "aerospike", label: "Aerospike", aliases: ["aerospike"] },
  { id: "elasticsearch", label: "Elasticsearch", aliases: ["elasticsearch", "elastic search", "opensearch"] },
  { id: "kafka", label: "Kafka", aliases: ["kafka", "apache kafka", "kafka streams", "event streaming"] },
  { id: "rabbitmq", label: "RabbitMQ", aliases: ["rabbitmq"] },
  // Cloud and operations
  { id: "docker", label: "Docker", aliases: ["docker", "dockerfile", "docker compose", "docker-compose", "containers"] },
  { id: "kubernetes", label: "Kubernetes", aliases: ["kubernetes", "k8s", "helm", "eks", "gke", "aks"] },
  { id: "aws", label: "AWS", aliases: ["aws", "amazon web services", "ec2", "s3", "lambda", "aws lambda", "sqs", "sns", "kinesis", "ecs", "cloudwatch"] },
  { id: "gcp", label: "GCP", aliases: ["gcp", "google cloud", "google cloud platform"] },
  { id: "azure", label: "Azure", aliases: ["azure", "microsoft azure", "azure kubernetes service"] },
  { id: "cloud", label: "Cloud", aliases: ["cloud", "cloud basics", "cloud computing", "cloud platform"], impliedBy: ["aws", "gcp", "azure"] },
  { id: "terraform", label: "Terraform", aliases: ["terraform", "hcl"] },
  { id: "infrastructure-as-code", label: "Infrastructure as code", aliases: ["infrastructure as code", "iac", "pulumi", "cloudformation", "ansible"], impliedBy: ["terraform"] },
  { id: "linux", label: "Linux", aliases: ["linux", "unix", "bash", "shell", "shell scripting", "linux processes", "systemd", "ubuntu"], impliedBy: ["docker", "kubernetes"], impliedByRoles: ["devops"] },
  { id: "networking", label: "Networking", aliases: ["networking", "networking basics", "tcp/ip", "tcp", "udp", "dns", "load balancer", "load balancing", "vpc", "subnet", "firewall", "nginx", "envoy", "service mesh", "istio", "cdn"] },
  { id: "git", label: "Git", aliases: ["git", "github", "gitlab", "version control"] },
  { id: "ci-cd", label: "CI/CD", aliases: ["ci/cd", "cicd", "ci / cd", "ci/cd stages", "github actions", "jenkins", "gitlab ci", "circleci", "argocd", "argo cd", "continuous integration", "continuous delivery", "continuous deployment"] },
  { id: "observability", label: "Observability", aliases: ["observability", "prometheus", "grafana", "monitoring", "datadog", "opentelemetry", "tracing", "alerting", "on-call", "logging"] },
  { id: "testing", label: "Testing", aliases: ["testing", "test automation", "automation testing", "api testing", "unit testing", "unit tests", "integration testing", "integration tests", "end-to-end tests", "e2e", "postman", "jest", "pytest", "testng", "cypress", "playwright", "testcontainers", "test coverage"],
    impliedBy: ["selenium", "junit"] },
  { id: "selenium", label: "Selenium", aliases: ["selenium", "webdriver"] },
  { id: "junit", label: "JUnit", aliases: ["junit", "mockito"] },
  { id: "hibernate", label: "Hibernate", aliases: ["hibernate", "jpa"] },
  // Data and ML
  { id: "spark", label: "Spark", aliases: ["spark", "pyspark", "apache spark"] },
  { id: "flink", label: "Flink", aliases: ["flink", "apache flink"] },
  { id: "hadoop", label: "Hadoop", aliases: ["hadoop", "hdfs", "mapreduce", "hive"] },
  { id: "airflow", label: "Airflow", aliases: ["airflow", "apache airflow"] },
  { id: "dbt", label: "dbt", aliases: ["dbt"] },
  { id: "snowflake", label: "Snowflake", aliases: ["snowflake", "bigquery", "redshift", "data warehouse"] },
  { id: "pandas", label: "Pandas", aliases: ["pandas", "numpy"] },
  { id: "tensorflow", label: "TensorFlow", aliases: ["tensorflow", "keras", "jax"] },
  { id: "pytorch", label: "PyTorch", aliases: ["pytorch", "torch"] },
  { id: "scikit-learn", label: "scikit-learn", aliases: ["scikit-learn", "sklearn", "scikit learn", "lightgbm", "xgboost"] },
  { id: "huggingface", label: "Hugging Face", aliases: ["hugging face", "huggingface", "transformers"] },
  { id: "machine-learning", label: "Machine learning", aliases: ["machine learning", "ml", "deep learning", "machine learning basics", "neural network", "neural networks", "recommendation systems", "recommender", "ranking models", "nlp", "computer vision", "llm", "llms", "rag", "fine-tuned", "fine-tuning", "classifier", "classification model"],
    impliedBy: ["pytorch", "tensorflow", "scikit-learn", "huggingface"] },
  { id: "model-evaluation", label: "Model evaluation", aliases: ["model evaluation", "evaluation metrics", "cross-validation", "cross validation", "precision and recall", "f1 score", "auc", "offline evaluation", "evaluation framework", "evaluation harness", "mape", "test accuracy", "validation accuracy", "evaluation set", "baseline"] },
  { id: "inference-systems", label: "Inference systems", aliases: ["inference", "inference systems", "model serving", "serving", "torchserve", "triton", "onnx", "vllm", "tensorrt", "sagemaker", "model deployment"] },
  { id: "statistics", label: "Statistics", aliases: ["statistics", "statistical", "hypothesis testing", "hypothesis tests", "regression", "probability", "bayesian", "confidence interval", "statistical uncertainty", "sampling", "anova"] },
  { id: "experimentation", label: "Experimentation", aliases: ["experimentation", "experiment design", "experiments", "a/b testing", "a/b test", "a/b tests", "a/b tested", "ab testing"] },
  // Concepts
  { id: "system-design", label: "System design", aliases: ["system design", "distributed systems", "low level design", "lld", "hld", "architecture", "software architecture", "scalability", "scalable systems", "high availability", "fault tolerance", "fault-tolerant"],
    impliedBy: ["microservices", "kafka"] },
  { id: "data-structures", label: "Data structures", aliases: ["data structures", "dsa", "algorithms", "data structures and algorithms", "data structures & algorithms", "problem solving", "competitive programming"] },
];

/**
 * DSA topics. `keywords` hold each platform's tag names (LeetCode, Codeforces, TUF, all lowercased)
 * and the free-text names interview rounds use. A platform topic maps by exact name first; round
 * topics are scanned, so "Graphs (BFS/DFS)" maps to graphs.
 */
export const DSA_TOPICS: (VocabEntry & { label: string })[] = [
  { tag: "arrays", label: "Arrays", keywords: ["array", "arrays", "matrix", "prefix sum", "subarray", "subarrays"] },
  { tag: "strings", label: "Strings", keywords: ["string", "strings", "string matching", "string suffix structures", "kmp"] },
  { tag: "hashing", label: "Hashing", keywords: ["hash table", "hashing", "hash map", "hash maps", "hashmap", "hashmaps"] },
  { tag: "two-pointers", label: "Two pointers", keywords: ["two pointers", "two pointer", "sliding window", "sliding window & two pointer", "sliding window and two pointer"] },
  { tag: "sorting", label: "Sorting", keywords: ["sorting", "sortings", "merge sort", "quick sort"] },
  { tag: "binary-search", label: "Binary search", keywords: ["binary search", "binary search on answer"] },
  { tag: "linked-lists", label: "Linked lists", keywords: ["linked list", "linked lists", "linkedlist"] },
  { tag: "stacks-queues", label: "Stacks and queues", keywords: ["stack", "stacks", "queue", "queues", "monotonic stack", "monotonic queue",
    "stack and queues", "stacks and queues", "stack & queues", "stacks & queues"] },
  { tag: "heaps", label: "Heaps", keywords: ["heap", "heaps", "heap (priority queue)", "priority queue", "priority queues"] },
  { tag: "trees", label: "Trees", keywords: ["tree", "trees", "binary tree", "binary trees", "binary search tree", "binary search trees", "bst",
    "segment tree", "fenwick tree", "binary indexed tree", "trie", "tries"] },
  { tag: "graphs", label: "Graphs", keywords: ["graph", "graphs", "dfs and similar", "shortest path", "shortest paths", "dfs", "bfs", "depth-first search",
    "breadth-first search", "topological sort", "union find", "dsu", "disjoint set", "minimum spanning tree", "graph matchings", "flows"] },
  { tag: "dynamic-programming", label: "Dynamic programming", keywords: ["dynamic programming", "dp", "memoization"] },
  { tag: "greedy", label: "Greedy", keywords: ["greedy", "greedy algorithms"] },
  { tag: "backtracking", label: "Recursion and backtracking", keywords: ["backtracking", "recursion", "recursion & backtracking", "recursion and backtracking"] },
  { tag: "bit-manipulation", label: "Bit manipulation", keywords: ["bit manipulation", "bitmasks", "bitmask", "bitwise"] },
  { tag: "math", label: "Math", keywords: ["math", "maths", "number theory", "combinatorics", "probabilities", "geometry"] },
];

/**
 * Broad DSA asks: round topics that name DSA without a specific topic. Matched as the whole topic
 * (not scanned), so "Coding assignment" is not DSA. A round of type "dsa" with no specific topic is
 * one too. Each is scored on total problems solved, not per topic.
 */
export const GENERAL_DSA_TOPICS: readonly string[] = [
  "dsa", "data structures", "algorithms", "data structures and algorithms", "data structures & algorithms", "data structures and algorithm",
  "basic data structures", "data structure design", "problem solving", "problem-solving", "basic problem solving", "complexity", "complexity analysis", "time complexity",
  "coding", "coding problems", "coding questions", "coding round", "coding test", "live coding", "advanced coding", "programming", "basic programming",
  "programming fundamentals", "programming basics", "coding fundamentals", "simple algorithms", "collections", "javascript collections", "python collections", "java collections",
];
