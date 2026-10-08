# Admin validation controls

`GET /api/v1/admin/validation-controls` and
`PATCH /api/v1/admin/validation-controls` are ADMIN-only endpoints. The PATCH body is a strict
object containing one or more boolean fields:

```json
{
  "linkedinImportEnabled": true,
  "requireSectionReview": true
}
```

Both endpoints return `{ "settings": { ... }, "updatedAt": "..." }`; a missing singleton uses the
safe defaults above and returns `updatedAt: null`. PATCH records `lastUpdatedAt` and the admin user
id in MongoDB. Settings are a singleton and are updated atomically. They do not invalidate profile
scores or start a scoring job.

## LinkedIn semantics

- `linkedinImportEnabled=false` returns `503 linkedin_import_disabled` before the uploaded PDF is
  sent for extraction.
- `requireSectionReview=false` does not auto-confirm or publish a draft. Section selection and source
  publication remain explicit and review validation remains mandatory until a separate product
  decision changes that contract.

The Firecrawl-era controls `requireCanonicalUrl`, `requireExactProviderIdentity` and
`paidAttemptGuardEnabled` were retired with the move to PDF uploads (see `linkedin-import.md`).
PATCH rejects them as unknown fields, and values left in a stored singleton are ignored. The
setting response omits internal audit `updatedBy`.
