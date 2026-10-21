# Is the candidate talking to the interviewer? (design, 2026-10-19)

Status: approved by the owner 2026-10-19. Owner decisions below were given on 2026-10-19.

## Problem

The live interviewer treats every candidate utterance as addressed to it. When the candidate reads the problem aloud, mutters, or thinks out loud, the interviewer answers (live round 6eeb5dae: a read-aloud was answered, "constraints" in the statement fired the constraints reveal, "what could zero decode to?" was treated as a bug). A real interviewer lets the candidate read and think, and asks if unsure.

## Decision (owner)

1. **Model for the check:** `deepseek/deepseek-v4.1-flash-1017` (the live interviewer's model), one fast structured call with a short timeout, same pattern as `app/interviewer/change_decision.py`.
2. **UI:** a one-line note when the problem goes up, and an **Ask interviewer** control that always gets a reply.
3. **Check-in wording:** fixed pool (not model-written), very rich (at least 10 wordings per pool), neutral tone, generic (never echoes what they said). Allowed in every round type.
4. **After the check-in:**
   - "I'm thinking" or they keep talking: stay quiet for similar remarks for the rest of that problem, never ask again.
   - "Yes" or they repeat the question: answer normally (a clarifying question costs nothing in the score).
   - Silence for about **10 seconds**: nudge again with a fixed line. **Never** treat the silence as a question.

## Classification

Each candidate utterance gets one of `to_interviewer`, `thinking_aloud`, `reading_problem`, `unclear`, decided in this order:

1. **Rules first** (no added delay), existing and new:
   - `reading_problem`: most of the words are the problem's own (existing `_reading_the_problem`), not a question.
   - `to_interviewer`: an answer right after an interviewer question; a direct request ("can you", "could you", "is it okay", "should I", "sorry"); the Ask interviewer control.
   - `thinking_aloud`: "hmm", "let me think", "so if I", "wait", first-person planning with no request word; narration while typing (existing).
2. **LLM check for what the rules cannot place.** Input: the last interviewer line, the candidate's words, the phase, a short excerpt of the problem on screen, whether they are typing, and the last two candidate turns. Output JSON `{"addressed": "to_interviewer|thinking_aloud|reading_problem|unclear", "confidence": 0-1}`. It runs in parallel with the reply request and cancels the reply before any word is spoken when the result is not `to_interviewer`; a timeout or failure falls back to the rules' lean (never blocks the reply for more than the timeout). `deepseek` ignores optional tools, so the check is a plain JSON request.
3. **Context lean:** the first 60 s after a problem goes up leans to `reading_problem`; right after an interviewer question leans to `to_interviewer`.

## Behaviour per result

| Result | Interviewer |
|---|---|
| `reading_problem` | Silent. At most one "Take your time" line per problem. |
| `thinking_aloud` | Silent. The utterance still goes to the director and the evaluation as evidence (Communication). |
| `to_interviewer` | Normal reply. |
| `unclear` | One fixed check-in line (pool `addressed:checkin`), at most once per problem. |

Rules of the check-in:
- Once per problem. After "I'm thinking", every later `unclear` on that problem is treated as `thinking_aloud`.
- After the check-in, 10 s of silence plays one fixed nudge line (pool `addressed:nudge`, for example "Take your time."), once; the silence is not read as a question.
- A wrongly silent real question costs more than an extra check-in, so ties go to the check-in.
- The constraints reveal, hint and change-problem detectors only fire on an utterance classified `to_interviewer` (today they run on raw text).
- The evaluation never penalises thinking aloud, reading the problem or the check-in exchange (they are not hints, not help requests, not bugs).

## Fixed pools (lines.py)

Each pool is drawn without repeats within a session (a line is never said twice in one round), seeded per session like the other realism pools, so two sessions rarely hear the same wording. None echoes the candidate's words. All are neutral, short, and spoken-English.

`addressed:checkin` (24):
1. "Is that one for me, or are you thinking it through?"
2. "Was that a question for me, or are you working it out?"
3. "Do you want me to answer that, or are you thinking out loud?"
4. "Is that for me, or just thinking aloud?"
5. "Are you asking me, or working through it yourself?"
6. "Should I jump in on that, or are you still thinking?"
7. "Is that something you'd like me to answer?"
8. "Was that aimed at me, or part of your thinking?"
9. "Do you want my input there, or are you mid-thought?"
10. "Is that for me, or are you talking it through?"
11. "Quick check: was that a question for me?"
12. "Just to be sure, are you asking me that?"
13. "Do you want me to weigh in, or are you still working on it?"
14. "Was that directed at me, or are you reasoning it out?"
15. "Should I answer that one, or let you think?"
16. "Is that a question for me, or one you're asking yourself?"
17. "Do you need something from me there, or are you thinking?"
18. "Was that for me? Happy to answer, or to let you think."
19. "Are you looking for an answer from me on that?"
20. "Is that you thinking out loud, or something for me?"
21. "Just checking, should I respond to that?"
22. "Is that one you want me to take, or are you on it?"
23. "Do you want me to step in there, or keep going?"
24. "Was that meant for me, or are you working through it?"

`addressed:nudge` (16), after 10 s of silence following a check-in, once:
1. "Take your time."
2. "No rush, I'm here whenever you want me."
3. "Go ahead whenever you're ready."
4. "Whenever you're ready, just say."
5. "I'm happy to wait."
6. "Whenever you want to continue, go ahead."
7. "Think it through, I'll wait."
8. "Let me know if you'd like me to weigh in."
9. "No pressure, keep going when you're ready."
10. "I'm here if you need me."
11. "Feel free to keep thinking."
12. "All good, carry on when you're ready."
13. "Take a moment, there's no hurry."
14. "Just say if you want me to jump in."
15. "Keep going at your own pace."
16. "I'll wait, carry on whenever you like."

`addressed:reading` (12), at most once per problem, while they read it aloud:
1. "Take your time reading it."
2. "No rush, read it through."
3. "Read it at your own pace."
4. "Take as long as you need with it."
5. "Go ahead and read it through."
6. "Take a moment with it."
7. "No hurry, have a good read."
8. "Read it through, I'll wait."
9. "Take your time with the problem."
10. "Have a read, no rush at all."
11. "Go through it at your own pace."
12. "Settle into it, take your time."

## UI (apps/web `features/interview-live`)

- When the problem goes up, one muted line under the problem header: "Think aloud freely. I'll only answer when you ask me directly."
- An **Ask interviewer** button next to the mic/status. Pressing it marks the next utterance as `to_interviewer` (sent to the agent as a `proctor`-style data message, like the existing events), expires after that utterance or 15 s. The phrase "quick question" does the same by rule.
- Tests: a component test for the note and the button; no live-region changes.

## Transition fix (also decided 2026-10-19)

Every move to a new part, in every round type (framing to introduction, introduction to coding, problem to problem, coding to fundamentals or projects, into the candidate's questions, into the closing), starts with a real one-sentence reaction to what the candidate just said (never a bare "okay then" or "alright", no praise, no summary: `REACT_FIRST` in `conductor.py`), then a 1 s breath (`BRIDGE_BREATH_S` in `run.py`), then the connecting line and the new part. A problem's put-up line keeps its fixed wording ("Here's your first question...").

## Where it goes

- Classification and gating: `apps/ai-service/app/interviewer/run.py`, in the reply decision beside `needs_no_reply` and `_still_talking`; a new module `addressed.py` for the rules, the LLM call (pattern of `change_decision.py`) and the state (per-problem check-in used, "thinking" flag, nudge timer).
- Pools: `lines.py`. Prompt for the check: `addressed.py` (short, versioned).
- Trace: every classification (rule or LLM, result, confidence, ms) is written to the turn trace so the judge and `tracecheck.py` can audit it.
- Rollout: first as a shadow (classify and log, still reply as today), compared against labelled turns from traces 6eeb5dae and 781a1f0a plus the persona rehearsals (`scripts/rehearse_flow.py`); switch to active when missed real questions are zero on the labelled set. An env flag `ADDRESSED_CHECK` (`off|shadow|on`).

## Cost and limits

One extra small call only for utterances the rules cannot place (expected a minority of turns). OpenRouter credit is low (project memory): the shadow run uses the persona rehearsals sparingly. No new dependency.

## Open items (not blocking)

- Exact timeout for the check call (start at 800 ms) and the confidence threshold below which `unclear` is chosen (start at 0.6).
- Whether `addressed:reading` should also fire in system design and LLD (starts on).
