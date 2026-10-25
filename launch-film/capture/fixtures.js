const USER = { id: '0b9f8c3e-1111-4c4c-9a9a-000000000001', email: 'aarav@example.com', name: 'Aarav Sharma', role: 'CANDIDATE', onboardingComplete: true, emailVerified: true, hasPassword: true };
const now = new Date('2026-10-25T10:00:00Z');
const steps = ['context','selection','answer_keys','persona','personalization','playbooks','policies','validate'].map((id) => ({ id, state: 'done', elapsedMs: 1400 }));
const SESSION = (id, extra = {}) => ({
  id, candidateId: USER.id, jobDescriptionId: 'jd-1', company: 'meesho', companyName: 'Meesho', role: 'Software Development Engineer I', level: 'sde1', specialization: 'backend',
  roundType: 'dsa', scheduledAt: '2026-10-25T10:00:00Z', timezone: 'Asia/Kolkata', status: 'READY',
  prep: { step: null, steps, refreshing: false, preparedAt: '2026-10-24T18:00:00Z', errorCode: null },
  briefing: { interviewerName: 'Asha', interviewerStyle: 'Warm, direct, pushes on trade-offs', format: '40-minute coding interview with a shared editor', durationMins: 40 },
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
const routes = [
  ['POST', /^\/api\/v1\/auth\/refresh$/, { accessToken: 'stub.token.x', expiresIn: 3600, tokenType: 'Bearer' }],
  ['GET', /^\/api\/v1\/users\/me$/, USER],
  ['GET', /^\/api\/v1\/main\/wake$/, null],
  ['GET', /^\/api\/v1\/interviews\/sessions\/[^/]+\/report$/, REPORT],
  ['GET', /^\/api\/v1\/interviews\/sessions\/done-1$/, SESSION('done-1', { status: 'COMPLETED', score: 8.4, outcome: 'passed', verdict: 'hire', evaluationStatus: 'ready', endReason: 'completed' })],
  ['GET', /^\/api\/v1\/interviews\/sessions\/([^/]+)$/, (p) => SESSION(p.split('/').pop())],
  ['GET', /^\/api\/v1\/interviews\/sessions$/, { sessions: [SESSION('demo-1'), SESSION('done-1', { status: 'COMPLETED', score: 8.4, outcome: 'passed', evaluationStatus: 'ready' })] }],
];
module.exports = {
  THEME_KEY: 'iq-theme', REPORT, SESSION,
  match(m, path) { for (const [mm, re, body] of routes) if (mm === m && re.test(path)) return typeof body === 'function' ? body(path) : body; return undefined; },
};
