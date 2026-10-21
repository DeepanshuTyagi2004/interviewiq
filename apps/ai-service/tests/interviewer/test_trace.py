from app.interviewer.trace import render

RUN = {"session_id": "s1", "started_at": "t0"}


def cand(addressed):
    return {"seq": 1, "at": 1.0, "speaker": "candidate", "text": "hmm so the array", "addressed": addressed}


def test_render_shows_addressed():
    out = render(RUN, [cand({"result": "thinking_aloud", "source": "model", "confidence": 0.8, "ms": 420, "mode": "on"})], [])
    assert any("addressed: thinking_aloud (model 0.80, 420 ms)" in line for line in out)


def test_render_addressed_without_ms():
    out = render(RUN, [cand({"result": "to_interviewer", "source": "rules", "confidence": 0.0, "ms": None, "mode": "on"})], [])
    assert any("addressed: to_interviewer (rules 0.00)" in line for line in out)


def test_render_shows_direct_only():
    out = render(RUN, [cand({"result": "unclear", "source": "model", "confidence": 0.5, "ms": 100, "mode": "on", "direct_only": True})], [])
    assert any("addressed: unclear (model 0.50, 100 ms), direct-only" in line for line in out)
    out = render(RUN, [cand({"result": "unclear", "source": "model", "confidence": 0.5, "ms": 100, "mode": "on"})], [])
    assert not any("direct-only" in line for line in out)
