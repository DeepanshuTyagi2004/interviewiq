# Task 7 report

Implemented prompt (app/prompts/research/*), nodes (resolve, write_draft), graph.py, minimal targets.py/runner.py placeholders, tests/research/helpers.py, test_nodes.py, test_graph.py, verbatim from the brief. No commits.

## Controller rulings
- A: `ResearchIO.extract_json(..., validate=None)`. Cache hit is validated (failure -> warning, fall through to fresh call); fresh/replayed response validated inside the span before put_extract (failure -> not cached, span status "error", exception propagates). resolve passes `validate=ResolveOutput.model_validate`. Tests in test_gateway.py: test_response_failing_validate_is_not_cached, test_cached_value_failing_validate_is_asked_again; test_nodes also asserts store.extracts empty after invalid output.
- B: `domain_of` catches ValueError -> None. Test: test_domain_of_returns_none_for_malformed_urls ("http://[bad", "https://[::1").

## TDD evidence
RED (rulings tests, before implementing): `.venv/bin/python -m pytest tests/research/test_gateway.py tests/research/test_identity.py -q` -> 5 failed, 24 passed (validate kwarg unsupported / domain_of raised or returned a value; one extra param case I dropped because urlparse does not treat it as malformed).
Brief tests: RED = ModuleNotFoundError app.research.graph (as expected, modules absent).
GREEN: `.venv/bin/python -m pytest tests/research -q` -> 85 passed, 11 skipped (skips = Mongo contract tests, pre-existing).

## Deviations
None to brief code besides the two rulings. test_resolve_rejects_output_without_a_name gained one assertion (extracts empty).

## Files
app/prompts/research/{__init__,resolve_company}.py; app/research/{graph,targets,runner,gateway(edit)}.py; app/research/nodes/{__init__,resolve,write_draft}.py; app/research/normalize/identity.py (edit); tests/research/{helpers,test_nodes,test_graph}.py; test_gateway.py, test_identity.py (appended).
