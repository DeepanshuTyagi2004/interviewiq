# Final round, attempt 3 (after the swap/next_item/markup fixes).
- 00:16 provider slow at the opening: 'Give me a second. There.' filler+recovery then the greeting (fallback race live again).
- 00:50 the framing sentence ('quick picture of how this round will run: ... coding problem ... questions') was blocked by the announcement rule (false positive; fixed after: outline wording is exempt).
- 02:33 clean: one turn, ack + 'move to the coding problem now, I'll put it on your screen' + next_item + show_problem succeeded + invite questions (time-up order).
- 04:55 silent while I typed; plan stayed on core-1 (swap/mislabel fixes hold). 05:50 good probe: trace n=2, pair [1,0] (exposes my reversed edge).
- 06:55 it said 'before we wrap this slot' — internal plan vocabulary ('slot') leaked into speech. Add a rule: never say slot/item/phase/plan/blueprint/conductor.
- 07:37 attempt 3 stopped: after a fully correct solve at ~7 min, the talker said 'Let me move us on to your questions' and then 'that's the end of the coding part ... what would you like to ask me?' although the plan had the extra problem (item reserve-alternate) and the deep dive ahead. Fix: inviting the candidate's questions is blocked (and regenerated) until the plan reaches that part.
