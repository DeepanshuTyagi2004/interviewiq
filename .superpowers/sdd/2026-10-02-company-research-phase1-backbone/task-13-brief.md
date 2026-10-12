## Task 13: Contract and generated web types

**Files:**
- Modify: `packages/contracts/openapi.yaml`
- Regenerate: `apps/web/lib/api-client/generated/schema.d.ts`

**Interfaces:**
- Produces generated `components["schemas"]` for the shapes Tasks 9 and 11 already return:
  - Company: `AdminCompany`, `AdminCompanyList`, `CompanyResearchState`, `CreateCompanyRequest`, `UpdateCompanyRequest`, `SeedResult`.
  - Enums: `ResearchMode`, `ResearchLevel`, `ResearchRunStatus`, `ResearchItemStatus`.
  - Runs: `ResearchRunCounters`, `ResearchBudget`, `ResearchRun`, `ResearchRunList`, `ResearchRunDetail`, `ResearchError`, `ResearchNodeProgress`, `ResearchItem`.
  - Events and spans: `ResearchEvent`, `ResearchEventPage`, `ResearchSpan`, `ResearchSpanList`, `ResearchSpanDetail`, `ResearchSpanDetailResponse`.
  - Requests and targets: `StartResearchRunRequest`, `ResearchBudgetUpdate`, `ResearchTarget`.

- [ ] **Step 1: Bump the version and add tags**

In `packages/contracts/openapi.yaml`:
- Set `info.version` to `0.4.0`.
- Append to the description: "Company research (admin): curated companies, research runs with pause/resume/stop and a full-verbosity trace (spans + events) is the surface added in 0.4.0. Research payloads are the ai-service's snake_case JSON passed through by interviewiq-api; admin company payloads are camelCase."
- Add to `tags`:

```yaml
  - name: admin-companies
    description: Curated company catalogue the research job works through (ADMIN only).
  - name: admin-research
    description: Company research runs, controls and their full trace (ADMIN only; snake_case passthrough).
  - name: internal-research
    description: Service-to-service research targets (ai-service → api).
```

- [ ] **Step 2: Add the paths**

Insert under `paths:`, before `/interview-plans:`:

```yaml
  /api/v1/admin/companies:
    get:
      operationId: listAdminCompanies
      tags: [admin-companies]
      summary: Every company with its research state (research is null when the AI service is unreachable).
      security: [{ bearerAuth: [] }]
      responses:
        "200": { description: Companies., content: { application/json: { schema: { $ref: "#/components/schemas/AdminCompanyList" } } } }
        "401": { $ref: "#/components/responses/Unauthorized" }
    post:
      operationId: createCompany
      tags: [admin-companies]
      summary: Add a company to research. It starts unpublished (students see it after an admin approves its first draft).
      security: [{ bearerAuth: [] }]
      requestBody:
        required: true
        content: { application/json: { schema: { $ref: "#/components/schemas/CreateCompanyRequest" } } }
      responses:
        "201": { description: Created., content: { application/json: { schema: { $ref: "#/components/schemas/AdminCompany" } } } }
        "400": { description: "`invalid_company` | `invalid_website` | `invalid_aliases`.", content: { application/json: { schema: { $ref: "#/components/schemas/ApiError" } } } }
        "409": { description: "`company_exists` — the slug is taken.", content: { application/json: { schema: { $ref: "#/components/schemas/ApiError" } } } }
  /api/v1/admin/companies/seed:
    post:
      operationId: seedCompanies
      tags: [admin-companies]
      summary: Load the starter catalogue (upsert-only; never deletes).
      security: [{ bearerAuth: [] }]
      responses:
        "200": { description: Seed result., content: { application/json: { schema: { $ref: "#/components/schemas/SeedResult" } } } }
  /api/v1/admin/companies/{companyId}:
    parameters:
      - { name: companyId, in: path, required: true, schema: { type: string, format: uuid } }
    patch:
      operationId: updateCompany
      tags: [admin-companies]
      summary: Edit identity fields or archive. The slug never changes.
      security: [{ bearerAuth: [] }]
      requestBody:
        required: true
        content: { application/json: { schema: { $ref: "#/components/schemas/UpdateCompanyRequest" } } }
      responses:
        "200": { description: Updated., content: { application/json: { schema: { $ref: "#/components/schemas/AdminCompany" } } } }
        "400": { description: "`invalid_company` | `invalid_website` | `invalid_aliases` | `invalid_status`.", content: { application/json: { schema: { $ref: "#/components/schemas/ApiError" } } } }
        "404": { $ref: "#/components/responses/NotFound" }
    delete:
      operationId: deleteCompany
      tags: [admin-companies]
      summary: Delete the company with its JDs and role configs.
      security: [{ bearerAuth: [] }]
      responses:
        "204": { description: Deleted. }
        "404": { $ref: "#/components/responses/NotFound" }

  /api/v1/admin/research/runs:
    get:
      operationId: listResearchRuns
      tags: [admin-research]
      security: [{ bearerAuth: [] }]
      parameters:
        - { name: limit, in: query, schema: { type: integer, minimum: 1, maximum: 100, default: 20 } }
      responses:
        "200": { description: Newest first., content: { application/json: { schema: { $ref: "#/components/schemas/ResearchRunList" } } } }
        "502": { description: "`ai_service_unreachable`.", content: { application/json: { schema: { $ref: "#/components/schemas/ApiError" } } } }
    post:
      operationId: startResearchRun
      tags: [admin-research]
      summary: Start a run. Only one run may be active (queued, running, pausing, paused or stopping).
      security: [{ bearerAuth: [] }]
      requestBody:
        required: true
        content: { application/json: { schema: { $ref: "#/components/schemas/StartResearchRunRequest" } } }
      responses:
        "201": { description: The new run., content: { application/json: { schema: { $ref: "#/components/schemas/ResearchRun" } } } }
        "400": { description: "`no_companies` | `invalid_mode`.", content: { application/json: { schema: { $ref: "#/components/schemas/ApiError" } } } }
        "409": { description: "`run_active`.", content: { application/json: { schema: { $ref: "#/components/schemas/ApiError" } } } }
        "503": { description: "`targets_unavailable` | `research_disabled`.", content: { application/json: { schema: { $ref: "#/components/schemas/ApiError" } } } }
  /api/v1/admin/research/runs/{runId}:
    parameters: [{ $ref: "#/components/parameters/ResearchRunId" }]
    get:
      operationId: getResearchRun
      tags: [admin-research]
      security: [{ bearerAuth: [] }]
      responses:
        "200": { description: Run with its items., content: { application/json: { schema: { $ref: "#/components/schemas/ResearchRunDetail" } } } }
        "404": { $ref: "#/components/responses/NotFound" }
  /api/v1/admin/research/runs/{runId}/pause:
    parameters: [{ $ref: "#/components/parameters/ResearchRunId" }]
    post:
      operationId: pauseResearchRun
      tags: [admin-research]
      security: [{ bearerAuth: [] }]
      responses:
        "200": { description: Pausing., content: { application/json: { schema: { $ref: "#/components/schemas/ResearchRun" } } } }
        "409": { description: "`invalid_transition`.", content: { application/json: { schema: { $ref: "#/components/schemas/ApiError" } } } }
  /api/v1/admin/research/runs/{runId}/resume:
    parameters: [{ $ref: "#/components/parameters/ResearchRunId" }]
    post:
      operationId: resumeResearchRun
      tags: [admin-research]
      security: [{ bearerAuth: [] }]
      responses:
        "200": { description: Resumed., content: { application/json: { schema: { $ref: "#/components/schemas/ResearchRun" } } } }
        "409": { description: "`invalid_transition`.", content: { application/json: { schema: { $ref: "#/components/schemas/ApiError" } } } }
  /api/v1/admin/research/runs/{runId}/stop:
    parameters: [{ $ref: "#/components/parameters/ResearchRunId" }]
    post:
      operationId: stopResearchRun
      tags: [admin-research]
      security: [{ bearerAuth: [] }]
      responses:
        "200": { description: Stopping or stopped., content: { application/json: { schema: { $ref: "#/components/schemas/ResearchRun" } } } }
        "409": { description: "`invalid_transition`.", content: { application/json: { schema: { $ref: "#/components/schemas/ApiError" } } } }
  /api/v1/admin/research/runs/{runId}/budget:
    parameters: [{ $ref: "#/components/parameters/ResearchRunId" }]
    patch:
      operationId: updateResearchBudget
      tags: [admin-research]
      security: [{ bearerAuth: [] }]
      requestBody:
        required: true
        content: { application/json: { schema: { $ref: "#/components/schemas/ResearchBudgetUpdate" } } }
      responses:
        "200": { description: Updated run., content: { application/json: { schema: { $ref: "#/components/schemas/ResearchRun" } } } }
        "400": { description: "`invalid_budget` — negative, or below calls already made.", content: { application/json: { schema: { $ref: "#/components/schemas/ApiError" } } } }
  /api/v1/admin/research/runs/{runId}/events:
    parameters: [{ $ref: "#/components/parameters/ResearchRunId" }]
    get:
      operationId: listResearchEvents
      tags: [admin-research]
      summary: Trace events, ascending by seq. With beforeSeq, the newest `limit` events before it (still ascending).
      security: [{ bearerAuth: [] }]
      parameters:
        - { name: afterSeq, in: query, schema: { type: integer, minimum: 0 } }
        - { name: beforeSeq, in: query, schema: { type: integer, minimum: 1 } }
        - { name: limit, in: query, schema: { type: integer, minimum: 1, maximum: 500 } }
        - { name: level, in: query, schema: { $ref: "#/components/schemas/ResearchLevel" } }
        - { name: companyId, in: query, schema: { type: string } }
        - { name: node, in: query, schema: { type: string } }
        - { name: type, in: query, description: Event type prefix, e.g. `span.`, schema: { type: string } }
        - { name: spanId, in: query, schema: { type: string } }
        - { name: q, in: query, description: Case-insensitive substring of the message., schema: { type: string } }
      responses:
        "200": { description: A page of events., content: { application/json: { schema: { $ref: "#/components/schemas/ResearchEventPage" } } } }
  /api/v1/admin/research/runs/{runId}/spans:
    parameters: [{ $ref: "#/components/parameters/ResearchRunId" }]
    get:
      operationId: listResearchSpans
      tags: [admin-research]
      summary: The run's span tree, flat (parent_id links), without inputs/outputs.
      security: [{ bearerAuth: [] }]
      parameters:
        - { name: companyId, in: query, schema: { type: string } }
      responses:
        "200": { description: Spans by start time., content: { application/json: { schema: { $ref: "#/components/schemas/ResearchSpanList" } } } }
  /api/v1/admin/research/spans/{spanId}:
    parameters:
      - { name: spanId, in: path, required: true, schema: { type: string, pattern: "^[0-9a-f]{32}$" } }
    get:
      operationId: getResearchSpan
      tags: [admin-research]
      summary: One span with its full input/output (offloaded payloads resolved) and its log events.
      security: [{ bearerAuth: [] }]
      responses:
        "200": { description: The span., content: { application/json: { schema: { $ref: "#/components/schemas/ResearchSpanDetailResponse" } } } }
        "404": { $ref: "#/components/responses/NotFound" }
  /api/v1/internal/research-targets:
    get:
      operationId: listResearchTargets
      tags: [internal-research]
      summary: Every active company (published or not) for the research run.
      security: [{ internalApiKey: [] }]
      responses:
        "200":
          description: Targets.
          content: { application/json: { schema: { type: array, items: { $ref: "#/components/schemas/ResearchTarget" } } } }
        "401": { $ref: "#/components/responses/Unauthorized" }
```

Under `components.parameters`, add:

```yaml
    ResearchRunId:
      name: runId
      in: path
      required: true
      schema: { type: string, pattern: "^[0-9a-f]{32}$" }
```

- [ ] **Step 3: Add the schemas**

Append under `components.schemas`:

```yaml
    CompanyResearchState:
      type: object
      required: [lastRunId, lastResearchedAt, lastStatus, latestDraftId, latestDraftStatus]
      properties:
        lastRunId: { type: string, nullable: true }
        lastResearchedAt: { type: string, format: date-time, nullable: true }
        lastStatus: { type: string, nullable: true, description: The company's item status in its latest run (ResearchItemStatus). }
        latestDraftId: { type: string, nullable: true }
        latestDraftStatus: { type: string, nullable: true, description: "pending_review | approved | rejected | superseded" }
    AdminCompany:
      type: object
      required: [id, name, slug, website, aliases, status, origin, tier, publishedVersion, publishedAt, createdAt, research]
      properties:
        id: { type: string, format: uuid }
        name: { type: string }
        slug: { type: string }
        website: { type: string, nullable: true }
        aliases: { type: array, items: { type: string } }
        status: { type: string, enum: [active, archived] }
        origin: { type: string, enum: [seed, admin] }
        tier: { type: integer, nullable: true }
        publishedVersion: { type: integer, nullable: true }
        publishedAt: { type: string, format: date-time, nullable: true }
        createdAt: { type: string, format: date-time }
        research:
          allOf: [{ $ref: "#/components/schemas/CompanyResearchState" }]
          nullable: true
    AdminCompanyList:
      type: object
      required: [companies, researchAvailable]
      properties:
        companies: { type: array, items: { $ref: "#/components/schemas/AdminCompany" } }
        researchAvailable: { type: boolean, description: false when the AI service could not be reached (research is null on every row). }
    CreateCompanyRequest:
      type: object
      required: [name]
      properties:
        name: { type: string, maxLength: 255 }
        website: { type: string, nullable: true, description: "http(s) URL; a bare domain gets https://." }
        aliases: { type: array, maxItems: 10, items: { type: string, maxLength: 100 } }
    UpdateCompanyRequest:
      type: object
      properties:
        name: { type: string, maxLength: 255 }
        website: { type: string, nullable: true }
        aliases: { type: array, maxItems: 10, items: { type: string, maxLength: 100 } }
        status: { type: string, enum: [active, archived] }
    SeedResult:
      type: object
      required: [companies, inserted, backfilled, total]
      properties:
        companies: { type: integer }
        inserted: { type: integer }
        backfilled: { type: integer }
        total: { type: integer }
    ResearchTarget:
      type: object
      required: [id, name, slug, website, aliases]
      properties:
        id: { type: string, format: uuid }
        name: { type: string }
        slug: { type: string }
        website: { type: string, nullable: true }
        aliases: { type: array, items: { type: string } }

    ResearchMode: { type: string, enum: [live, record, replay] }
    ResearchLevel: { type: string, enum: [trace, debug, info, warn, error] }
    ResearchRunStatus: { type: string, enum: [queued, running, pausing, paused, stopping, stopped, completed, failed] }
    ResearchItemStatus: { type: string, enum: [queued, running, paused, done, failed, skipped, cancelled] }
    ResearchRunCounters:
      type: object
      required: [total, queued, running, paused, done, failed, skipped, cancelled]
      properties:
        total: { type: integer }
        queued: { type: integer }
        running: { type: integer }
        paused: { type: integer }
        done: { type: integer }
        failed: { type: integer }
        skipped: { type: integer }
        cancelled: { type: integer }
    ResearchBudget:
      type: object
      required: [exa_used, exa_cap, llm_used, llm_cap, tokens_in, tokens_out]
      properties:
        exa_used: { type: integer }
        exa_cap: { type: integer }
        llm_used: { type: integer }
        llm_cap: { type: integer }
        tokens_in: { type: integer }
        tokens_out: { type: integer }
    ResearchRun:
      type: object
      required: [run_id, trigger, mode, scope, company_ids, status, control, pause_reason, counters, budget, last_seq, created_at, started_at, finished_at, error]
      properties:
        run_id: { type: string }
        trigger: { type: string, enum: [admin, cron, cli] }
        mode: { $ref: "#/components/schemas/ResearchMode" }
        scope: { type: string, enum: [all, selected] }
        company_ids: { type: array, items: { type: string } }
        status: { $ref: "#/components/schemas/ResearchRunStatus" }
        control: { type: string, enum: [none, pause, stop] }
        pause_reason: { type: string, nullable: true, description: "admin | budget_exhausted" }
        requested_by: { type: string, nullable: true }
        counters: { $ref: "#/components/schemas/ResearchRunCounters" }
        budget: { $ref: "#/components/schemas/ResearchBudget" }
        last_seq: { type: integer }
        created_at: { type: string, format: date-time }
        started_at: { type: string, format: date-time, nullable: true }
        finished_at: { type: string, format: date-time, nullable: true }
        error: { type: string, nullable: true }
        pipeline_version: { type: string }
    ResearchRunList:
      type: object
      required: [runs]
      properties:
        runs: { type: array, items: { $ref: "#/components/schemas/ResearchRun" } }
    ResearchError:
      type: object
      required: [type, message]
      properties:
        type: { type: string }
        message: { type: string }
        traceback: { type: string }
        code_ref: { type: string, nullable: true, description: "Innermost pipeline frame, e.g. app/research/nodes/resolve.py:resolve." }
    ResearchNodeProgress:
      type: object
      properties:
        status: { type: string, enum: [running, ok, error] }
        started_at: { type: string, format: date-time }
        finished_at: { type: string, format: date-time }
        exa_calls: { type: integer }
        llm_calls: { type: integer }
        error: { type: string }
    ResearchItem:
      type: object
      required: [run_id, company_id, company_name, company_slug, position, status, attempts, current_node, last_node, nodes, draft_id, error]
      properties:
        run_id: { type: string }
        company_id: { type: string }
        company_name: { type: string }
        company_slug: { type: string }
        position: { type: integer }
        status: { $ref: "#/components/schemas/ResearchItemStatus" }
        attempts: { type: integer }
        current_node: { type: string, nullable: true }
        last_node: { type: string, nullable: true }
        nodes:
          type: object
          additionalProperties: { $ref: "#/components/schemas/ResearchNodeProgress" }
        draft_id: { type: string, nullable: true }
        error:
          allOf: [{ $ref: "#/components/schemas/ResearchError" }]
          nullable: true
        started_at: { type: string, format: date-time, nullable: true }
        finished_at: { type: string, format: date-time, nullable: true }
    ResearchRunDetail:
      type: object
      required: [run, items]
      properties:
        run: { $ref: "#/components/schemas/ResearchRun" }
        items: { type: array, items: { $ref: "#/components/schemas/ResearchItem" } }
    StartResearchRunRequest:
      type: object
      properties:
        scope: { type: string, enum: [all, selected], default: all, description: all = every company not researched in RESEARCH_STALE_AFTER_DAYS. }
        companyIds: { type: array, items: { type: string } }
        mode: { $ref: "#/components/schemas/ResearchMode" }
    ResearchBudgetUpdate:
      type: object
      properties:
        exaCap: { type: integer, minimum: 0 }
        llmCap: { type: integer, minimum: 0 }
    ResearchEvent:
      type: object
      required: [run_id, seq, ts, level, level_rank, type, message, span_id, company_id, node]
      properties:
        run_id: { type: string }
        seq: { type: integer }
        ts: { type: string, format: date-time }
        level: { $ref: "#/components/schemas/ResearchLevel" }
        level_rank: { type: integer }
        type: { type: string, description: "run.* | item.* | span.start | span.end | log | cache.hit | conflict.detected | budget.* | draft.created | control.*" }
        message: { type: string }
        span_id: { type: string, nullable: true }
        company_id: { type: string, nullable: true }
        node: { type: string, nullable: true }
        data: { description: Structured detail (any JSON). }
        data_ref: { type: string, nullable: true, description: Payload id when data exceeded 32 KB. }
    ResearchEventPage:
      type: object
      required: [events, last_seq]
      properties:
        events: { type: array, items: { $ref: "#/components/schemas/ResearchEvent" } }
        last_seq: { type: integer }
    ResearchSpan:
      type: object
      required: [span_id, parent_id, run_id, company_id, node, kind, name, status, started_at, ended_at, duration_ms, attrs, error]
      properties:
        span_id: { type: string }
        parent_id: { type: string, nullable: true }
        run_id: { type: string }
        company_id: { type: string, nullable: true }
        node: { type: string, nullable: true }
        kind: { type: string, enum: [run, company, node, exa, llm, cache, merge, normalize, db] }
        name: { type: string }
        status: { type: string, enum: [running, ok, error, cancelled] }
        started_at: { type: string, format: date-time }
        ended_at: { type: string, format: date-time, nullable: true }
        duration_ms: { type: integer, nullable: true }
        attrs: { type: object, additionalProperties: true }
        input_ref: { type: string, nullable: true }
        output_ref: { type: string, nullable: true }
        error:
          allOf: [{ $ref: "#/components/schemas/ResearchError" }]
          nullable: true
    ResearchSpanList:
      type: object
      required: [spans]
      properties:
        spans: { type: array, items: { $ref: "#/components/schemas/ResearchSpan" } }
    ResearchSpanDetail:
      allOf:
        - $ref: "#/components/schemas/ResearchSpan"
        - type: object
          properties:
            input: { description: Full input (any JSON). }
            output: { description: Full output (any JSON). }
    ResearchSpanDetailResponse:
      type: object
      required: [span, logs]
      properties:
        span: { $ref: "#/components/schemas/ResearchSpanDetail" }
        logs: { type: array, items: { $ref: "#/components/schemas/ResearchEvent" } }
```

- [ ] **Step 4: Regenerate and typecheck**

Run: `pnpm contracts:types && pnpm --filter @interviewiq/web typecheck`
Expected:
- `apps/web/lib/api-client/generated/schema.d.ts` gains the new schemas;
- the typecheck passes (nothing consumes them yet).

If the generator rejects the YAML, fix the indentation it names. Don't loosen the schemas.

- [ ] **Step 5: Checkpoint**

Run `git status`; leave the changes uncommitted.

---

