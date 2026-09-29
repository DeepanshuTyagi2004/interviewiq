from app.interview_prep.schema import InterviewPlan, ReserveSet, QuestionLadder


def _min_plan_kwargs():
    from app.interview_prep.schema import InterviewerPersona, PlanProvenance
    from app.models.brief import utcnow
    return dict(
        session_id="s1", candidate_id="c1", company="razorpay", role="software-engineer",
        level="sde2", specialization="backend", round_type="dsa",
        provenance=PlanProvenance(plan_version="v1", input_hash="h", model="m", generated_at=utcnow()),
        persona=InterviewerPersona(name="Ada", seniority="senior", disposition="warm"),
    )


def test_plan_reserve_defaults_empty():
    plan = InterviewPlan(**_min_plan_kwargs())
    assert plan.reserve == []


def test_plan_reserve_accepts_ladders_and_roundtrips_camel():
    plan = InterviewPlan(reserve=[QuestionLadder(base_prompt="Design a rate limiter")], **_min_plan_kwargs())
    doc = plan.model_dump(by_alias=True, mode="json")
    assert doc["reserve"][0]["basePrompt"] == "Design a rate limiter"


def test_reserve_set_wrapper():
    rs = ReserveSet.model_validate({"ladders": [{"base_prompt": "harder q"}]})
    assert rs.ladders[0].base_prompt == "harder q"
