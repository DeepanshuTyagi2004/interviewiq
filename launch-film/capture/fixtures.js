const USER = { id: '0b9f8c3e-1111-4c4c-9a9a-000000000001', email: 'aarav@example.com', name: 'Aarav Sharma', role: 'CANDIDATE', onboardingComplete: true, emailVerified: true, hasPassword: true };
const now = new Date('2026-10-25T10:00:00Z');
const steps = ['context','selection','answer_keys','persona','personalization','playbooks','policies','validate'].map((id) => ({ id, state: 'done', elapsedMs: 1400 }));
const SESSION = (id, extra = {}) => ({
  id, candidateId: USER.id, jobDescriptionId: 'jd-1', company: 'meesho', companyName: 'Meesho', role: 'Software Development Engineer I', level: 'sde1', specialization: 'backend',
  roundType: 'dsa', scheduledAt: '2026-10-25T10:00:00Z', timezone: 'Asia/Kolkata', status: 'PREP_READY',
  prep: { step: null, steps, refreshing: false, preparedAt: '2026-10-24T18:00:00Z', errorCode: null },
  briefing: { interviewerName: 'Interviewer', interviewerStyle: 'Warm, direct, pushes on trade-offs', format: '40-minute coding interview with a shared editor', durationMins: 40 },
  liveAvailable: true, endReason: null, loopId: 'loop-1', nodeId: 'n2', roundMinutes: 40, passMark: 7.2, score: null, outcome: null, verdict: null, retakeAfter: null,
  evaluationStatus: null, createdAt: '2026-10-20T10:00:00Z', updatedAt: '2026-10-24T18:00:00Z', ...extra });
const REPORT = {
  status: 'ready', version: 1,
  meta: { company: 'meesho', role: 'Software Development Engineer I', level: 'sde1', round: 'Round 2 · Problem Solving', roundMinutes: 40, minutesPlayed: 38, codeStandard: 'runnable', weightsVersion: 'w1', evalVersion: 'eval1' },
  outcome: 'passed', score: 8.4, passMark: 7.2, verdict: 'hire', cap: null, baseScore: 8.2, bonusTotal: 0.4, penaltyTotal: -0.2, practicalScore: 8.6, theoryScore: 8.1,
  retakeAfter: null, nextRound: { nodeId: 'n3', name: 'System Design (LLD)', type: 'lld' }, readiness: 'nearly_ready',
  areas: [
    { key: 'approach', label: 'Approach & optimisation', weight: 25, score: 8.5, reason: 'Moved the counter to a shared store unprompted and named the network-hop trade-off.', evidence: ['turn:12'], previousScore: 6.5 },
    { key: 'code', label: 'Code correctness', weight: 25, score: 8.8, reason: 'Allow() is correct for fixed windows; TTL set on first increment only.', evidence: ['code'] },
    { key: 'communication', label: 'Communication', weight: 20, score: 8.0, reason: 'Thought aloud clearly; one long silence before the fallback.', evidence: ['turn:18'] },
    { key: 'testing', label: 'Testing & edge cases', weight: 15, score: 7.6, reason: 'Covered the Redis outage; missed the window boundary burst.', evidence: ['turn:22'] },
    { key: 'depth', label: 'Depth & follow-ups', weight: 15, score: 8.2, reason: 'Good answer on a slow Redis; sliding-log trade-off came after a hint.', evidence: ['turn:26'] },
  ],
  adjustments: [
    { kind: 'hint', label: 'Hint: small nudge', delta: -0.2, turnId: 20, at: '2026-10-25T10:14:52Z', note: 'Rate limiter' },
    { kind: 'beyond_level', label: 'Named the fail-open vs fail-closed trade-off', delta: 0.4, turnId: 26, at: '2026-10-25T10:24:10Z', note: '' },
  ],
  questions: [
    { id: 'q1', part: 'coding', kind: 'dsa', title: 'Rate limiter for the order API', asked: 'Three pods, 50k requests a second. Where does the rate-limit state live?',
      answerQuotes: [{ turnId: 12, text: 'In a shared store — Redis. INCR a key per window with a TTL, so every pod sees one count.' }],
      verdict: 'correct', score: 8.8, strongAnswer: 'Keep one counter per seller per window in Redis: INCR, set EXPIRE on the first hit, and compare to the limit. Call out the extra network hop and decide fail-open vs fail-closed when Redis is slow.',
      gap: 'Did not mention the burst at a window boundary (up to 2× the limit) or a sliding log as the fix.', topics: [{ subject: 'System design', topic: 'Distributed counters' }, { subject: 'System design', topic: 'Token bucket' }],
      origin: 'asked', code: { language: 'go', text: 'func (l *Limiter) Allow(key string) bool {\n    k := fmt.Sprintf("rl:%s:%d", key, time.Now().UnixMilli()/l.window)\n    n, err := l.rdb.Incr(ctx, k).Result()\n    if err != nil {\n        return l.fallback(key)\n    }\n    if n == 1 {\n        l.rdb.Expire(ctx, k, l.ttl)\n    }\n    return n <= l.limit\n}', logicWorks: 'yes', syntaxSlips: [] } },
    { id: 'q2', part: 'coding', kind: 'dsa', title: 'Follow-up · Redis is slow', asked: 'Good. And what happens when Redis gets slow?',
      answerQuotes: [{ turnId: 26, text: 'Put a short timeout on the call and fail open with a local token bucket, so checkout never blocks on the limiter.' }],
      verdict: 'mostly', score: 8.0, strongAnswer: 'Short timeout, fail open for reads and fail closed for writes that cost money; a local token bucket as a degraded limiter; alert on fallback rate.',
      gap: 'Fail-closed for expensive endpoints was not considered.', topics: [{ subject: 'System design', topic: 'Graceful degradation' }], origin: 'asked' },
  ],
  delivery: { observations: [{ text: 'You started answering within two seconds on most questions.', examples: [12] }], stats: { medianAnswerLatencyS: 1.8, slowStarts: 1, fillers: { um: 2, like: 1 }, longSilences: 1, selfCorrections: 2 } },
  conduct: [], integrity: [],
  focus: [{ title: 'Window-boundary bursts', why: 'Fixed windows let up to twice the limit through at the edge.', exampleQuote: 'INCR a key per window with a TTL', exampleNote: 'Right idea; name the edge case.', moments: [12] }],
  topicGaps: [{ subject: 'System design', topics: [
    { topic: 'Distributed counters', why: 'The heart of this round.', practice: [{ slug: 'design-rate-limiter', title: 'Design a rate limiter', difficulty: 'Medium' }] },
    { topic: 'Token bucket', why: 'The usual degraded mode.', practice: [{ slug: 'token-bucket', title: 'Implement a token bucket', difficulty: 'Medium' }] }] }],
  strengths: ['Moved state to a shared store without a prompt', 'Clean, runnable Go with a fallback path', 'Named the fail-open trade-off unprompted'],
  summary: 'A strong round. You found the shared-state answer quickly, wrote correct, runnable code and handled the slow-Redis follow-up well. The one gap was the burst at a window boundary.',
  endQuestions: { quality: 'thoughtful', bonus: 0.2, note: 'Asked how the team handles noisy sellers.' },
  transcript: [
    { turnId: 1, speaker: 'interviewer', text: 'Hi Aarav, I read through your order-tracking service. Let’s start there.', at: '2026-10-25T10:00:10Z', cutOff: false, markers: [] },
    { turnId: 11, speaker: 'interviewer', text: 'Three pods, 50k requests a second. Where does the rate-limit state live?', at: '2026-10-25T10:08:40Z', cutOff: false, markers: [] },
    { turnId: 12, speaker: 'candidate', text: 'In a shared store — Redis. INCR a key per window with a TTL, so every pod sees one count.', at: '2026-10-25T10:08:58Z', cutOff: false, markers: [] },
    { turnId: 25, speaker: 'interviewer', text: 'Good. And what happens when Redis gets slow?', at: '2026-10-25T10:23:30Z', cutOff: false, markers: [] },
    { turnId: 26, speaker: 'candidate', text: 'Put a short timeout on the call and fail open with a local token bucket.', at: '2026-10-25T10:24:10Z', cutOff: false, markers: [] },
  ],
  disputes: [],
};

const COMPANIES = [['meesho','Meesho',1,'Bengaluru','5,000+'],['flipkart','Flipkart',1,'Bengaluru','10,000+'],['razorpay','Razorpay',1,'Bengaluru','3,000+'],['swiggy','Swiggy',1,'Bengaluru','5,000+'],
  ['cred','CRED',1,'Bengaluru','1,000+'],['phonepe','PhonePe',1,'Bengaluru','5,000+'],['zepto','Zepto',2,'Mumbai','1,000+'],['groww','Groww',2,'Bengaluru','1,000+']]
  .map(([slug, name, tier, hq, size], i) => ({ id: 'co-' + i, name, slug, tier, logoUrl: null, headquarterLocation: hq, companySize: size }));
const JDS = [
  ['jd-1','meesho','Meesho','Software Development Engineer I','sde1','backend',['Go','Java','Kafka','MySQL','Redis'],0,2,18,28,'rich',72],
  ['jd-2','meesho','Meesho','Software Development Engineer II','sde2','backend',['Java','Kafka','Kubernetes'],2,5,30,48,'available',54],
  ['jd-3','flipkart','Flipkart','SDE 1','sde1','backend',['Java','Spring','MySQL'],0,2,20,32,'rich',68],
  ['jd-4','razorpay','Razorpay','Software Engineer','sde1','backend',['Go','Postgres','AWS'],0,2,22,30,'rich',64],
  ['jd-5','swiggy','Swiggy','SDE 1 · Frontend','sde1','frontend',['React','TypeScript'],0,2,16,26,'available',41],
  ['jd-6','cred','CRED','Backend Engineer','sde1','backend',['Kotlin','Go'],1,3,24,36,'limited',58],
  ['jd-7','phonepe','PhonePe','Software Engineer','sde1','backend',['Java','Kafka'],0,2,18,26,'available',61],
  ['jd-8','zepto','Zepto','SDE 1','sde1','backend',['Go','Postgres'],0,2,20,30,'available',66],
  ['jd-9','groww','Groww','Software Engineer','fresher','backend',['Java','Spring'],0,1,14,20,'limited',70],
].map(([id, company, companyName, role, level, spec, techStack, yoeMin, yoeMax, ctcMinLpa, ctcMaxLpa, dataAvailability, fit]) => ({
  id, practiceTemplate: false, company, companyName, role, level, title: role, specialization: spec, techStack, yoeMin, yoeMax, ctcMinLpa, ctcMaxLpa,
  dataConfidence: dataAvailability === 'rich' ? 'high' : 'medium', dataAvailability, _fit: fit }));
const ROUNDS = [
  { id: 'r1', name: 'Online Assessment', round_number: 1, type: 'online_assessment', duration_minutes: 90, difficulty: 'medium', topics: ['Arrays', 'Strings', 'Greedy'], format: 'HackerRank, 3 problems' },
  { id: 'r2', name: 'Problem Solving', round_number: 2, type: 'dsa', duration_minutes: 60, difficulty: 'medium-hard', topics: ['Sliding window', 'Hashing', 'Graphs'], format: 'Live coding with one interviewer' },
  { id: 'r3', name: 'System Design (LLD)', round_number: 3, type: 'lld', duration_minutes: 60, difficulty: 'medium', topics: ['Object modelling', 'Rate limiting', 'Design patterns'], format: 'Low-level design of a service' },
  { id: 'r4', name: 'Hiring Manager', round_number: 4, type: 'hiring_manager', duration_minutes: 45, difficulty: 'medium', topics: ['Projects', 'Ownership', 'Trade-offs'], format: 'Discussion of your past work' },
];
const jdDetail = (id) => { const j = JDS.find((x) => x.id === id) || JDS[0]; const { _fit, ...rest } = j; return { ...rest,
  description: 'Build and scale the services behind Meesho’s order and seller platform: high-throughput APIs, event pipelines on Kafka and the data models behind them.',
  sourceUrl: null, sources: ['glassdoor', 'leetcode-discuss', 'reddit', 'youtube'],
  companyOverview: { overview: 'Meesho is an e-commerce platform for small businesses and first-time online shoppers across India.', culture: 'Ownership, speed and frugality.', benefits: '', sourceUrls: [], verified: true },
  interviewProcess: { rounds: ROUNDS } }; };
const FIT_PARTS = [
  { key: 'skills', weight: 35, value: 0.78, status: 'scored', evidence: [{ source: 'github', item: 'order-tracking-svc', matched: 'Go', tag: 'Go' }, { source: 'resume', item: 'Skills', matched: 'Kafka', tag: 'Kafka' }, { source: 'resume', item: 'Internship', matched: 'Redis', tag: 'Redis' }], uncovered: ['MySQL'], hint: null, reason: null },
  { key: 'round_topics', weight: 25, value: 0.7, status: 'scored', evidence: [{ source: 'leetcode', item: '412 solved', matched: 'Hashing', tag: 'Hashing' }, { source: 'codeforces', item: 'Specialist', matched: 'Graphs', tag: 'Graphs' }], uncovered: ['Sliding window'], hint: 'Practise sliding-window problems.', reason: null },
  { key: 'domain', weight: 15, value: 0.8, status: 'scored', evidence: [{ source: 'resume', item: 'Backend intern · logistics startup', matched: 'E-commerce', tag: 'E-commerce' }], uncovered: [], hint: null, reason: null },
  { key: 'role', weight: 15, value: 0.75, status: 'scored', evidence: [{ source: 'github', item: 'order-tracking-svc', matched: 'Backend', tag: 'Backend' }], uncovered: [], hint: null, reason: null },
  { key: 'experience', weight: 10, value: 0.5, status: 'scored', evidence: [{ source: 'resume', item: '2 internships', matched: '0.5 years', tag: 'experience' }], uncovered: [], hint: null, reason: null },
];
const fitResult = (j) => ({ jdId: j.id, score: j._fit, levelGap: 'none', cap: null, levelFactor: 1 });

const GRAPH = { nodes: [
  { id: 'n1', kind: 'info', name: 'Online Assessment', note: 'Automated test on HackerRank: 3 problems in 90 minutes.', topics: ['Arrays', 'Strings', 'Greedy'], difficulty: 'medium', position: { x: 0, y: 0 } },
  { id: 'n2', kind: 'round', type: 'dsa', name: 'Problem Solving', durationMinutes: 45, difficulty: 'medium', topics: ['Sliding window', 'Hashing', 'Graphs'], position: { x: 320, y: 0 } },
  { id: 'n3', kind: 'round', type: 'lld', name: 'System Design (LLD)', durationMinutes: 45, difficulty: 'medium', topics: ['Object modelling', 'Rate limiting', 'Design patterns'], position: { x: 640, y: 0 } },
  { id: 'n4', kind: 'round', type: 'hiring-manager', name: 'Hiring Manager', durationMinutes: 45, difficulty: 'medium', topics: ['Projects', 'Ownership', 'Trade-offs'], position: { x: 960, y: 0 } },
], edges: [{ source: 'n1', target: 'n2' }, { source: 'n2', target: 'n3' }, { source: 'n3', target: 'n4' }] };
const jdBrief = (j) => ({ jdId: j.id, practiceTemplate: false, title: j.title, company: j.company, companyName: j.companyName, role: j.role, level: j.level, specialization: j.specialization, techStack: j.techStack });
const LOOP1 = { id: 'loop-1', name: 'Meesho · SDE I', level: 'sde1', jdId: 'jd-1', jd: jdBrief(JDS[0]), processId: null, kind: 'official', status: 'active', countsTowardReadiness: true,
  readiness: 'progressing', confirmedAt: '2026-10-12T10:00:00Z', graph: GRAPH,
  nodeStates: { n1: 'completed', n2: 'passed', n3: 'available', n4: 'locked' },
  nodeResults: { n2: { sessionId: 'done-1', score: 8.4, passMark: 7.2, outcome: 'passed', retakeAfter: null } },
  progress: { total: 3, completed: 1, nextNodeIds: ['n3'] },
  sessions: [{ id: 'done-1', nodeId: 'n2', status: 'COMPLETED', scheduledAt: '2026-10-25T10:00:00Z', score: 8.4, passMark: 7.2, outcome: 'passed', retakeAfter: null, evaluationStatus: 'ready' }] };
const LOOP2 = { ...LOOP1, id: 'loop-2', name: 'Flipkart · SDE 1', jdId: 'jd-3', jd: jdBrief(JDS[2]), readiness: 'getting_started', nodeStates: { n1: 'completed', n2: 'booked', n3: 'locked', n4: 'locked' }, nodeResults: {},
  progress: { total: 3, completed: 0, nextNodeIds: ['n2'] }, sessions: [{ id: 'demo-1', nodeId: 'n2', status: 'PREP_READY', scheduledAt: '2026-10-28T10:00:00Z', score: null, passMark: 7.0, outcome: null, retakeAfter: null, evaluationStatus: null }] };
const LOOP3 = { ...LOOP1, id: 'loop-3', name: 'Razorpay · Software Engineer', jdId: 'jd-4', jd: jdBrief(JDS[3]), readiness: 'nearly_ready', nodeStates: { n1: 'completed', n2: 'passed', n3: 'passed', n4: 'available' }, progress: { total: 3, completed: 2, nextNodeIds: ['n4'] } };

const routes = [
  ['POST', /^\/api\/v1\/auth\/refresh$/, { accessToken: 'stub.token.x', expiresIn: 3600, tokenType: 'Bearer' }],
  ['GET', /^\/api\/v1\/users\/me$/, USER],
  ['GET', /^\/api\/v1\/main\/wake$/, null],
  ['GET', /^\/api\/v1\/interviews\/sessions\/[^/]+\/report$/, REPORT],
  ['GET', /^\/api\/v1\/interviews\/sessions\/done-1$/, SESSION('done-1', { status: 'COMPLETED', score: 8.4, outcome: 'passed', verdict: 'hire', evaluationStatus: 'ready', endReason: 'completed' })],
  ['GET', /^\/api\/v1\/interviews\/sessions\/prep-1$/, () => SESSION('prep-1', { status: 'PREP_QUEUED', roundType: 'lld', nodeId: 'n3', briefing: null,
    prep: { step: 'playbooks', refreshing: false, preparedAt: null, errorCode: null, steps: steps.map((s, i) => ({ ...s, state: i < 5 ? 'done' : i === 5 ? 'active' : 'pending', elapsedMs: i < 5 ? 900 + i * 400 : null })) } })],
  ['GET', /^\/api\/v1\/interviews\/sessions\/([^/]+)$/, (p) => SESSION(p.split('/').pop())],
  ['GET', /^\/api\/v1\/interviews\/sessions$/, { sessions: [SESSION('demo-1'), SESSION('done-1', { status: 'COMPLETED', score: 8.4, outcome: 'passed', evaluationStatus: 'ready' })] }],
  ['GET', /^\/api\/v1\/companies$/, COMPANIES],
  ['GET', /^\/api\/v1\/jds$/, JDS.map(({ _fit, ...j }) => j)],
  ['GET', /^\/api\/v1\/jds\/([^/]+)$/, (p) => jdDetail(p.split('/').pop())],
  ['GET', /^\/api\/v1\/jd-fit$/, { configVersion: 'fit1', userLevel: 'sde1', results: JDS.map(fitResult) }],
  ['GET', /^\/api\/v1\/jd-fit\/([^/]+)$/, (p) => { const j = JDS.find((x) => x.id === p.split('/').pop()) || JDS[0]; return { ...fitResult(j), userLevel: 'sde1', jdLevel: j.level, configVersion: 'fit1', parts: FIT_PARTS }; }],
  ['GET', /^\/api\/v1\/processes\/official\/([^/]+)$/, { graph: GRAPH }],
  ['GET', /^\/api\/v1\/targets\/status\/jd-1$/, { targeted: true, loopId: 'loop-1' }],
  ['GET', /^\/api\/v1\/targets\/status\/([^/]+)$/, { targeted: false, loopId: null }],
  ['GET', /^\/api\/v1\/loops$/, { loops: [LOOP1, LOOP2, LOOP3] }],
  ['GET', /^\/api\/v1\/loops\/loop-1$/, LOOP1],
  ['GET', /^\/api\/v1\/loops\/loop-2$/, LOOP2],
  ['GET', /^\/api\/v1\/loops\/loop-3$/, LOOP3],
];
module.exports = {
  THEME_KEY: 'iq-theme', REPORT, SESSION,
  match(m, path) { for (const [mm, re, body] of routes) if (mm === m && re.test(path)) return typeof body === 'function' ? body(path) : body; return undefined; },
};
