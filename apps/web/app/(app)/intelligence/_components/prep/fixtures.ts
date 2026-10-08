/**
 * Test fixtures for the Interview prep diagnostics tab. Shapes follow the generated OpenAPI types;
 * the selection and validate `detail` payloads follow SelectionSlotTrace / InvariantCheck.
 */
import type {
  Blueprint,
  BlueprintBenchCandidate,
  BlueprintDiff,
  BlueprintRunDetail,
  BlueprintRunSummary,
  BlueprintSlot,
  BlueprintStage,
  BlueprintVersionList,
  SelectionSlotTrace,
} from "@/features/blueprints";

export function makeRunSummary(over: Partial<BlueprintRunSummary> = {}): BlueprintRunSummary {
  return {
    run_id: "run_aaaaaaaaaaaa",
    session_id: "sess-1",
    candidate_id: "11111111-1111-4111-8111-111111111111",
    candidate_label: "Asha Verma",
    trigger: "booking",
    status: "completed",
    stage: null,
    company: "Meesho",
    role: "SDE I",
    level: "sde1",
    round_type: "dsa",
    error: null,
    blueprint_version: 2,
    cached: false,
    duration_ms: 48200,
    rerun_of: null,
    created_at: "2026-10-07T10:00:00Z",
    ended_at: "2026-10-07T10:00:48Z",
    ...over,
  };
}

export const dsaKey: Record<string, unknown> = {
  approaches: [
    { name: "Brute force", idea: "Check every pair of prices", time_complexity: "O(n^2)", space_complexity: "O(1)" },
    { name: "Hash map", idea: "Store each price's index and look up the complement", time_complexity: "O(n)", space_complexity: "O(n)" },
  ],
  complexity_target: "O(n) time",
  key_insights: ["The complement of a price is budget minus price.", "One pass is enough."],
  common_wrong_paths: [{ path: "Sorting first", why_wrong: "Loses the original indices", nudge: "What do you need to return?" }],
  edge_cases: ["Duplicate prices", "Negative prices"],
  reference_solution: { language: "python", entry_point: "two_sum", code: "def two_sum(prices, budget):\n    seen = {}\n    return [0, 1]\n", verified_against_examples: true },
};

export const selectionTrace: SelectionSlotTrace[] = [
  {
    slot_id: "core-1",
    kind: "core",
    purpose: "warm-up array problem",
    picked: "two-sum",
    relaxations: ["drop_company_preference"],
    swaps: [{ slug: "three-sum", reason: "example 1: expected [0, 1], got []" }],
    candidates: [
      {
        slug: "two-sum", title: "Two Sum", difficulty: "easy", category: null, primary: "hash-table", score: 72.5,
        breakdown: { named: 40, company: 25, difficulty: 4, popularity: 3.5 }, outcome: "picked", reason: "swapped in after an answer-key failure",
      },
      {
        slug: "three-sum", title: "3Sum", difficulty: "medium", category: null, primary: "two-pointers", score: 52.5,
        breakdown: { company: 25, topic: 12.5, difficulty: 10, popularity: 5 }, outcome: "swapped_out", reason: "example 1 mismatch",
      },
      {
        slug: "valid-anagram", title: "Valid Anagram", difficulty: "easy", category: null, primary: "strings", score: 8,
        breakdown: { topic: 8 }, outcome: "not_drawn", reason: "the weighted draw picked another",
      },
    ],
  },
];

export function makeStages(): BlueprintStage[] {
  return [
    {
      id: "context", label: "Context", status: "done", duration_ms: 12,
      summary: {
        round_type: "dsa", family: "dsa", duration_mins: 45, level: "sde1", level_label: "SDE I", difficulty_target: "medium",
        difficulty_window: ["easy", "hard"], target_topics: ["arrays", "hash-table"], named_problems: ["two sum"], exclusions: 3, company: "Meesho",
      },
      detail: {
        topic_sources: { round: ["arrays"], company: ["hash-table"], jd: [] },
        input_parts: { jd: "sha256:1111aaaa2222bbbb", profile: "sha256:3333cccc4444dddd" },
        input_hash: "sha256:abcdef1234567890abcdef",
      },
      llm_calls: [],
      error: null,
    },
    {
      id: "selection", label: "Problem selection", status: "done", duration_ms: 40,
      summary: { pool: 120, excluded_seen: 3, slots: 1, relaxed_slots: ["core-1"] },
      detail: { slots: selectionTrace, weights: { named: 40, company_reported: 25 } },
      llm_calls: [],
    },
    {
      id: "answer_keys", label: "Answer keys", status: "done", duration_ms: 9000,
      summary: { hits: 0, misses: 1, swaps: 1 },
      detail: { keys: { "core-1": { slug: "two-sum", key: dsaKey, key_version: "k1", cache_hit: false } } },
      llm_calls: [
        {
          label: "answer_key:two-sum", attempt: 1, provider: "groq", model: "llama-3.3-70b", latency_ms: 2100,
          tokens: { prompt: 1800, completion: 600 }, valid: true, validation_errors: [], system: "You write answer keys.", user: "Problem: Two Sum", raw: "{\"approaches\":[]}",
        },
        { label: "sandbox:two-sum", attempt: 1, sandbox: true, valid: false, validation_errors: ["example 1: expected [0, 1], got []"] },
      ],
    },
    {
      id: "persona", label: "Persona and arc", status: "done", duration_ms: 3000,
      summary: { name: "Ravi Iyer", style: "calm" },
      detail: { persona: { name: "Ravi Iyer" } },
      llm_calls: [
        {
          label: "persona", attempt: 1, provider: "groq", model: "llama-3.3-70b", latency_ms: 2400,
          tokens: { prompt: 1200, completion: 300 }, valid: true, validation_errors: [],
          system: "You design an interviewer persona.", user: "Company: Meesho", raw: "{\"name\":\"Ravi Iyer\"}",
        },
      ],
    },
    { id: "personalization", label: "Personalization", status: "done", duration_ms: 2000, summary: { rapport_hooks: 1, resume_probes: 0 }, llm_calls: [] },
    {
      id: "playbooks", label: "Playbooks", status: "failed", duration_ms: 5000,
      summary: {},
      llm_calls: [
        {
          label: "playbook:core-1", attempt: 2, provider: "groq", model: "llama-3.3-70b", latency_ms: 4100,
          tokens: { prompt: 3000, completion: 900 }, valid: false, validation_errors: ["branches: missing nervous"],
          system: "You write playbooks.", user: "Slot core-1", raw: "{}",
        },
      ],
      error: { code: "playbook_failed", message: "playbook:core-1: branches: missing nervous" },
    },
    { id: "policies", label: "Policies", status: "pending" },
    { id: "validate", label: "Assemble and validate", status: "pending" },
  ];
}

export const slot: BlueprintSlot = {
  slot_id: "core-1",
  kind: "core",
  order: 1,
  purpose: "warm-up array problem",
  timebox_mins: 20,
  problem: { round_type: "dsa", slug: "two-sum", title: "Two Sum", difficulty: "easy", content_hash: "sha256:123456", content: { statement: "Ticket prices and a budget." } },
  answer_key: { key: dsaKey, key_version: "k1", cache_hit: false },
  ask: { opening: "Let's start with a warm-up about ticket prices.", clarifications: [{ question: "Can prices repeat?", answer: "Yes." }] },
  hint_ladder: [
    { step: 1, hint: "Think about complements." },
    { step: 2, hint: "A map can remember what you have seen." },
    { step: 3, hint: "Store price to index, then look up budget minus price." },
  ],
  branches: [
    { condition: "correct_optimal", action: "ask_complexity", say: "Nice. What is the time complexity?" },
    { condition: "stuck", action: "give_hint", say: "What would you need to know about each price?", notes: "first rung of the ladder" },
    { condition: "asks_for_answer", action: "decline_politely", say: "I'd rather see how you think it through." },
  ],
  probes: ["Why a hash map?"],
  follow_ups: ["What if the prices were sorted?"],
  expectations: { must_show: ["An O(n) solution"], strong_signals: ["Handles duplicates"], weak_signals: ["Only nested loops"] },
  evaluation_signals: [{ signal: "Problem solving", observe: "Breaks the problem down before coding" }],
};

export const blueprint: Blueprint = {
  blueprint_id: "bp_1",
  session_id: "sess-1",
  candidate_id: "11111111-1111-4111-8111-111111111111",
  version: 2,
  status: "current",
  input_hash: "sha256:abcdef1234567890abcdef",
  input_parts: { jd: "sha256:1111aaaa2222bbbb", profile: "sha256:3333cccc4444dddd" },
  run_id: "run_aaaaaaaaaaaa",
  created_at: "2026-10-07T10:00:48Z",
  round: { type: "dsa", duration_mins: 45, company: "Meesho", role: "SDE I", level: "sde1", source: "brief", format: "coding interview", difficulty_target: "medium" },
  persona: {
    name: "Ravi Iyer", seniority: "Senior engineer", style: "Calm and Socratic", disposition: "Patient",
    opening: "Hi, I'm Ravi.", closing: "Thanks for your time today.", grounded_in: ["brief: interviewers are collaborative"],
  },
  arc: [
    { phase: "greeting", timebox_mins: 2, scored: false, guidance: "Say hello." },
    { phase: "core", timebox_mins: 40, scored: true, guidance: "Two problems." },
    { phase: "wrap_up", timebox_mins: 3, scored: false, guidance: "Close warmly." },
  ],
  personalization: {
    rapport_hooks: [{ line: "You built an inventory app", source: "resume project: StockPilot" }],
    resume_probes: [],
    level_expectations: "Clean O(n) code with a clear explanation.",
  },
  slots: [slot],
  policies: {
    version: "policies-v1",
    requests: [{ kind: "ask_solution", decision: "decline", how: "Nudge with the next hint instead." }],
    off_topic: "Steer back to the problem.",
    time_management: "Watch the slot's timebox.",
    integrity: "No internet or AI tools.",
    fallback: "Move to the reserve.",
  },
  evaluation: { global_signals: [{ signal: "Communication", observe: "Thinks aloud" }], note: "Factors to collect." },
  briefing: {
    interviewer_name: "Ravi Iyer",
    interviewer_style: "Calm and collaborative",
    format: "45-minute coding interview with a shared editor",
    duration_mins: 45,
  },
  provenance: {
    models: ["llama-3.3-70b"], prompt_versions: { persona: "p1" }, policy_version: "policies-v1", key_version: "k1",
    selection_seed: "sess-1", answer_key_hits: 0, answer_key_misses: 1,
  },
};

export function makeRunDetail(over: Partial<BlueprintRunDetail> = {}): BlueprintRunDetail {
  return {
    ...makeRunSummary(),
    stages: makeStages(),
    input_hash: "sha256:abcdef1234567890abcdef",
    input_parts: { jd: "sha256:1111aaaa2222bbbb", profile: "sha256:3333cccc4444dddd" },
    blueprint,
    briefing: blueprint.briefing,
    ...over,
  };
}

export const versions: BlueprintVersionList = {
  versions: [
    { version: 2, status: "current", created_at: "2026-10-07T10:00:48Z", run_id: "run_aaaaaaaaaaaa", input_hash: "sha256:abcdef1234567890abcdef", input_parts: { jd: "sha256:1111aaaa2222bbbb", profile: "sha256:3333cccc4444dddd" } },
    { version: 1, status: "superseded", created_at: "2026-10-06T09:00:00Z", run_id: "run_bbbbbbbbbbbb", input_hash: "sha256:0000", input_parts: { jd: "sha256:1111aaaa2222bbbb", profile: "sha256:9999eeee" } },
  ],
};

export const diff: BlueprintDiff = {
  from_version: 1,
  to_version: 2,
  inputs_changed: ["profile"],
  problems_changed: { "core-1": { from: "valid-anagram", to: "two-sum" } },
  persona_changed: false,
  changes: [{ path: "slots[0].problem.slug", from: "valid-anagram", to: "two-sum" }],
  truncated: true,
};

export const candidates: BlueprintBenchCandidate[] = [
  { id: "11111111-1111-4111-8111-111111111111", name: "Asha Verma", email: "asha@example.com" },
  { id: "22222222-2222-4222-8222-222222222222", name: "Rohit Das", email: "rohit@example.com" },
];
