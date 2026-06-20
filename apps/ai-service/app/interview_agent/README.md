# interview_agent (stub — not implemented in this task)

Home for the **live voice interview agent**. When built, this module will:

- Orchestrate the real-time voice loop (STT → LLM dialogue → TTS), likely via LiveKit.
- Use `LLMClient.complete_text` (freeform generation) — already part of the LLM
  abstraction so no client change is needed here.
- Pull the `InterviewBrief` for the session's company/role/level at session start
  (from the `interview_briefs` collection / the `/briefs` endpoint) to ground the
  interviewer in real interview intelligence.

Out of scope for the scraping/intelligence task. Left as a stub so the service
folder structure already reflects its full intended scope.
