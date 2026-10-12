Global constraints (verbatim from the plan):
- No commits. The user commits their own work (standing rule).
- No Docker. Run everything on the host against Supabase and the Atlas dev database.
- No new runtime dependencies in any app. LangGraph is already in apps/ai-service/requirements.txt. Do not add langgraph-checkpoint-mongodb.
- ai-service tests are synchronous. They use asyncio.run(...). The repo has no asyncio_mode, so never use @pytest.mark.asyncio.
- Error envelope everywhere: { "code": string, "message": string }.
- Research proxy payloads stay snake_case (the API passes ai-service JSON through).
- Slugs must be identical in Python and TypeScript: NFKD-fold, drop non-ASCII, lowercase, & → " and ", non-alphanumerics → -, trim -.
- NODE_ORDER = ("resolve", "write_draft") in app/research/models.py is mirrored in apps/web/lib/constants/research/index.ts. Keep the two in sync.
- Spec: docs/superpowers/specs/2026-10-02-company-research-pipeline-design.md is the binding authority (durable state lives on research_items, not a LangGraph Mongo checkpointer).
