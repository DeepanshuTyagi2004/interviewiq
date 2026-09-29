# profile_synthesis (stub — not implemented in this task)

Home for **candidate profile synthesis** — turning normalized GitHub/LeetCode/resume
fragments into the descriptive profile summary (the `ProfileSummary` contract).

Today this logic lives in interviewiq-api (`synthesis` package). The longer-term
plan is to move all LLM orchestration here so the backend holds no LLM calls. When
that move happens it lands in this module and reuses the shared `LLMClient`
(`complete_json`) — descriptive only, no scoring, per project rules.

Out of scope for the scraping/intelligence task. Stub kept so the structure
reflects the service's full intended scope.
