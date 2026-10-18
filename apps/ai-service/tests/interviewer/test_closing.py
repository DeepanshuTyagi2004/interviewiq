import pytest
from app.interviewer.closing import claims_problem_on_screen_now, announces_coding_now, announces_problem, asks_for_introduction, gives_outline


def test_the_round_outline_is_recognised_and_ordinary_questions_are_not():
    assert gives_outline("It's about forty-five minutes, we'll do a bit of background, then some problem solving together, "
                         "and we'll keep time at the end for your questions.")
    assert gives_outline("Let me quickly frame how the next part will go. We'll spend most of the time on a couple of coding problems, "
                         "and after that a short chat about your projects, and I'll keep time at the end for any questions you have.")
    assert not gives_outline("Tell me a bit more about the Hisaab app, what was the hardest part to build?")
    assert not gives_outline("Let's get started with the technical part then.")


def test_saying_the_coding_part_starts_now_is_recognised_but_describing_the_round_is_not():
    for line in ("Let's get started with the technical part then.", "Alright, let's move on to the coding part.", "Time to jump into some coding."):
        assert announces_coding_now(line), line
    for line in ("We'll start with some background, then move to the coding part, and finish with your questions.",
                 "Tell me about the coding you did at Dunzo.", "How do you test your code?"):
        assert not announces_coding_now(line), line


def test_an_ordinary_question_that_says_end_up_and_problem_is_not_an_announcement_of_the_coding_problem():
    from app.interviewer.closing import announces_problem

    assert not announces_problem("How did you end up solving the singleton problem, what did you actually change?")
    assert not announces_problem("What problem did you run into when you set up the host shell?")
    assert announces_problem("Let me put the problem up for you now.")
    assert announces_problem("I'm pulling the problem up on your screen.")


def test_a_candidate_saying_they_are_about_to_write_the_code_is_recognised_and_a_question_or_a_thought_is_not():
    from app.interviewer.closing import starts_coding

    for line in ("Okay, writing it now.", "Okay writing.", "Let me write it.", "I'll code it up now.", "Starting to type it out.", "Okay, going to write the code.",
                 "Sure, writing the two-pointer version now.", "I'm coding the stack version now.", "Alright, typing out the solution now."):
        assert starts_coding(line), line
    for line in ("Should I write it in Python or Java?", "I wrote it like this and it returns the sum.", "So I loop and then write each result to a list."):
        assert not starts_coding(line), line


def test_a_bare_acknowledgement_needs_no_reply_but_an_answer_a_question_or_a_real_remark_does():
    from app.interviewer.closing import is_acknowledgement

    for text in ("Okay.", "Okay. Great.", "Got it, thanks.", "ok let me read it", "Yeah", "Sure.", "Hmm, let me think", "Alright, thank you"):
        assert is_acknowledgement(text), text
    for text in ("Okay. So what is the amount?", "Can you tell me the constraints?", "Okay, so I think the problem is about minimizing tokens",
                 "Yeah. Can you write the constraints?", "I don't understand", ""):
        assert not is_acknowledgement(text), text


def test_an_acknowledgement_of_a_question_is_an_answer_so_only_a_nod_to_a_statement_gets_silence():
    from app.interviewer.closing import asks_a_question, needs_no_reply

    assert needs_no_reply("Okay.", "Here's your first question. Give it a read, and let me know if you have any questions.")
    assert needs_no_reply("Got it.", "Take your time reading. When you're ready, tell me in your own words what the problem is asking for.")
    assert not needs_no_reply("Yeah.", "Does that make sense?")
    assert not needs_no_reply("Okay.", "Ready to move on to the next part?")
    assert asks_a_question("Right. Does that make sense?") and not asks_a_question("Right. Go ahead and write it.")


def test_a_request_for_a_different_problem_is_recognised_and_the_ordinary_ready_for_the_next_one_is_not():
    from app.interviewer.closing import asks_to_change_problem

    for text in ("Can you change the problem?", "I asked for another problem, actually.", "Can you give me a different problem", "Can we switch the question?"):
        assert asks_to_change_problem(text), text
    for text in ("Can I get the next problem? I'm done", "I'm done, ready for the next one", "Can you change the language to C++?", "Can you repeat the question?"):
        assert not asks_to_change_problem(text), text


def test_a_request_to_write_something_into_their_editor_is_recognised_but_asking_to_do_it_themselves_or_for_the_constraints_is_not():
    from app.interviewer.closing import asks_interviewer_to_edit

    for text in ("Can you add a comment in the editor", "Yeah. Can you write the constraints?", "can you leave a note at the top of the code",
                 "Could you put a comment above that line?"):
        assert asks_interviewer_to_edit(text), text
    for text in ("Can you tell me the constraints?", "Can I edit as a note in the problem?", "Can I add a comment in the editor?",
                 "What are the constraints on the amount?"):
        assert not asks_interviewer_to_edit(text), text


def test_the_line_that_puts_a_problem_up_counts_as_announcing_it():
    from app.interviewer.closing import announces_problem

    assert announces_problem("Here's your first question. Give it a read, and let me know if you have any questions.")
    assert not announces_problem("Tell me about the project you are most proud of.")


def test_the_line_that_puts_a_problem_up_does_not_count_as_inviting_their_questions_now():
    from app.interviewer.closing import invites_questions_now, says_the_problem_line

    line = "Here's your first question. Give it a read, and let me know if you have any questions."
    assert not invites_questions_now(line) and says_the_problem_line(line)
    assert invites_questions_now("Do you have any questions for me?") and not says_the_problem_line("Any questions for me?")
    assert says_the_problem_line("Here's your second problem, it is up.") and not says_the_problem_line("Tell me about the project.")


def test_a_request_for_a_moment_a_line_check_and_a_granted_pause_are_told_apart():
    from app.interviewer.closing import asks_for_a_moment, grants_a_pause, is_line_check
    for line in ("I want a minute to settle in.", "Give me a sec.", "Hold on.", "Can I take a moment to think?", "I need some time to read this."):
        assert asks_for_a_moment(line), line
    for line in ("It takes a minute to run.", "I'm ready.", "Yes.", "My name is Bala."):
        assert not asks_for_a_moment(line), line
    for line in ("Hello?", "Are you there?", "Can you hear me?", "hello"):
        assert is_line_check(line), line
    for line in ("Hello, my name is Bala.", "Yes.", "Okay, I'm ready."):
        assert not is_line_check(line), line
    for line in ("Of course, take a minute.", "I'm here. Nothing new from my side — take the minute, I'll wait.", "No rush."):
        assert grants_a_pause(line), line
    for line in ("Tell me about yourself.", "Let me tell you how this round will run."):
        assert not grants_a_pause(line), line


def test_a_mention_of_the_tab_switch_names_it_and_the_problem_on_the_screen_does_not_count():
    from app.interviewer.closing import unsaid_warnings
    assert unsaid_warnings(["mention_violation"], "Let's get back to the problem: what do you make of what's on your screen?")
    assert not unsaid_warnings(["mention_violation"], "One quick thing: please stay on this screen for the rest of the interview.")
    assert not unsaid_warnings(["mention_violation"], "I saw you switch tabs just now; please keep this window up.")


def test_an_invitation_to_carry_on_hands_the_candidate_the_turn():
    """A live round said "Go ahead, finish your thought." and, counting it as asking nothing, talked straight over the candidate."""
    from app.interviewer.closing import addresses_the_candidate

    for line in ("Go ahead, finish your thought.", "Please, carry on.", "Sorry, you were saying.", "Keep going.",
                 "No, please continue."):
        assert addresses_the_candidate(line), line
    for line in ("That's fair.", "Okay, both ends then.", "Let me put the first problem on your screen."):
        assert not addresses_the_candidate(line), line


def test_a_sentence_that_ends_with_then_is_finished_but_and_then_trails_off():
    """A live round heard "Okay. So let's talk about Vibe then." as a sentence breaking off and said nothing; the candidate had to
    ask "Hello? Are you there?"."""
    from app.interviewer.closing import trails_off

    assert not trails_off("Okay. So let's talk about Vibe then.")
    assert not trails_off("Let's go with the hash map then.")
    assert trails_off("So we sort it and then")
    assert trails_off("First I check the length, so then...")
    assert trails_off("I would use a hash map and")


def test_a_direct_question_inviting_their_questions_before_we_close_is_an_invite_now():
    """A live round wrapped up with "Do you have any questions for me before we close?" while a problem was still ahead; "before we"
    was read as the outline's "there will be time before we finish" and the invite was let through."""
    from app.interviewer.closing import invites_questions_now

    assert invites_questions_now("Do you have any questions for me before we close?")
    assert not invites_questions_now("I'll keep a few minutes at the end for your questions.")


def test_asking_to_change_it_is_a_request_for_a_different_problem():
    """A live round heard "Can we change it?", "No. Change it." and "Can you please change it?" four times without counting one: the
    give-up flow never ran and the interviewer refused in its own words each time."""
    from app.interviewer.closing import asks_to_change_problem

    for line in ("This seems like a very hard problem for me. Can we change it?", "No. Change it.",
                 "Sorry. I can't understand this question. Can you please change it?", "Can we skip it?"):
        assert asks_to_change_problem(line), line
    for line in ("Can I change it to use a set instead?", "I'll change it so the loop starts at one.", "I'm done, what's next?"):
        assert not asks_to_change_problem(line), line


def test_saying_it_is_hard_even_with_hints_is_not_asking_for_one():
    from app.interviewer.closing import asks_for_hint

    assert not asks_for_hint("No. No. I think it's hard for me even with hints.")
    assert asks_for_hint("Can you give me a hint?")


def test_an_okay_after_the_interviewer_promised_something_is_owed_the_thing_promised():
    """A live round said "Let me give you a starting point instead." without giving it; "Okay." was taken as a nod needing no reply
    and the candidate waited in silence until "Hi. Are you there?"."""
    from app.interviewer.closing import needs_no_reply

    assert not needs_no_reply("Okay.", "Alright, I'm sticking with this one. Let me give you a starting point instead.")
    assert not needs_no_reply("Sure.", "I'll give you a small nudge.")
    assert needs_no_reply("Okay.", "Here's your first question. Give it a read, and let me know if you have any questions.")
    assert needs_no_reply("Okay.", "That's a fair point.")


def test_a_greeting_and_are_you_there_together_is_still_only_a_line_check():
    from app.interviewer.closing import is_line_check

    assert is_line_check("Hi. Are you there?") and is_line_check("Hello? Hello?") and is_line_check("Hello?")
    assert not is_line_check("Hi. Can you give me a hint?")


def test_only_a_sentence_left_hanging_trails_off_not_an_ellipsis_or_a_filler_after_a_finished_thought():
    """Decided 2026-10-17: the speech-to-text writes "..." at any pause, and "um" closes finished thoughts too. A live round left a
    candidate in silence after "So..." at the end of a full introduction. Only a word nothing can end on is a sentence breaking off."""
    from app.interviewer.closing import trails_off

    assert not trails_off("I've touched Flutter and Spring Boot. So...")
    assert not trails_off("I'd use a hash map…")
    assert not trails_off("I think that's it, um.")
    assert not trails_off("Uh.")
    assert trails_off("I'd put them in a, um")          # the filler sits after a word nothing ends on: still mid-sentence
    assert trails_off("and then the…")
    assert trails_off("we sort it and then…")
    assert trails_off("One decision I would")


def test_a_sentence_that_defers_the_coding_is_not_an_announcement_of_the_problem():
    assert not announces_problem("That's alright. We'll get to the coding shortly — but first, give me your background.")
    assert not announces_problem("We'll get to the coding in a moment. First though, I asked about your sprint planning.")
    assert not announces_problem("Before we get to the problem, tell me about yourself.")
    assert announces_problem("Alright, let's get into the coding now. Let me put the first problem on your screen.")
    assert announces_problem("Here's your first question. Give it a read.")


def test_a_request_for_the_candidates_introduction_is_recognised_and_other_tell_me_requests_are_not():
    assert asks_for_introduction("Let's start with you properly then — tell me a bit more about that role.")
    assert asks_for_introduction("Give me a short introduction.")
    assert asks_for_introduction("Tell me about yourself.")
    assert not asks_for_introduction("Tell me about the time complexity.")


def test_describing_an_introduction_or_a_chat_about_their_background_is_not_asking_for_one():
    assert not asks_for_introduction("Today is an introduction to graphs.")
    assert not asks_for_introduction("I'll give you problems after a chat about your background.")


def test_a_promise_to_come_back_to_what_they_raised_is_recognised_and_ordinary_lines_are_not():
    from app.interviewer.closing import promises_to_return
    for line in ("Let's pick that up properly in a bit.", "Let's keep that thread for later.", "I'd like to come back to that later.",
                 "Let me park that for now.", "We can get into that story later on.",
                 "We'll get back to the Hisaab story.", "I want to dig into that later.",
                 "Keep that in mind, I'll ask about it again.", "That's worth a proper conversation.", "That sounds worth a chat later.",
                 "Let's pick that up after the coding."):
        assert promises_to_return(line), line
    for line in ("Tell me about the Hisaab app.", "That's a bit unusual, what happened next?", "I'll be back in a bit with the next question.",
                 "What did you do later on in the project?", "I'll explain later how the round runs."):
        assert not promises_to_return(line), line


def test_the_object_of_a_promise_is_named_when_the_sentence_names_one_and_otherwise_there_is_none():
    from app.interviewer.closing import promised_topic

    assert promised_topic("I hear you, and that side project sounds worth a chat later. Right now, please give me your introduction.") == "that side project"
    assert promised_topic("That CLI expense tracker sounds like a fun side project, and I'd like to hear more about it later.") == "that CLI expense tracker"
    assert promised_topic("Let's keep that thread for later.") is None
    assert promised_topic("That sounds worth a chat later.") is None


def test_sequencing_words_and_a_question_that_only_wants_the_problem_first_are_not_promises():
    from app.interviewer.closing import promises_to_return
    for line in ("Let's come back to the complexity once you've coded it.", "We'll get back to the tech stack when we get to your questions.",
                 "I'll walk you through how it works in a bit.", "I'd like to hear more about it, but first the problem.",
                 "Let's come back to the round format now.", "We can circle back to your background after the coding."):
        assert not promises_to_return(line), line


def test_a_noun_phrase_of_their_own_words_is_a_promise_only_when_they_said_it_recently():
    from app.interviewer.closing import promises_to_return
    said = "We had a database migration fail once and I rolled it back over a weekend."
    assert promises_to_return("We'll come back to the migration later.", said)
    assert not promises_to_return("We'll come back to the migration later.", "I like Java and SQL.")
    assert not promises_to_return("We'll come back to the migration once you've coded it.", said)
    assert not promises_to_return("We'll come back to the migration later.")


def test_a_yes_no_question_is_recognised_and_other_questions_are_not():
    from app.interviewer.closing import asks_yes_no
    assert asks_yes_no("Is it okay if I use Python for this?") and asks_yes_no("Thanks. Can I use a set here?")
    assert not asks_yes_no("What is the time complexity of this?") and not asks_yes_no("I think I would use a hash map.")


def test_sequencing_inside_the_part_and_in_part_deferrals_are_not_promises_but_parking_their_topic_is():
    from app.interviewer.closing import promises_to_return
    for line in ("Let's get back to this problem.", "Let's come back to this question in a moment.", "Let's get back to it.",
                 "Let's go back to this approach.", "Let's go back to this part of your code.", "Let me put that aside and show you the problem.",
                 "Let me put that aside for a moment.", "Okay, I'll keep that in mind, I'll see how you handle the edge cases.",
                 "Worth a chat about the edge cases after the code works.", "Keep your code simple for now; we can get to it later."):
        assert not promises_to_return(line), line
    assert not promises_to_return("Let's go back to the array and check the indices.", "I used an array of integers")
    assert not promises_to_return("Let's go back to the array later and check the indices.", "I used an array of integers", exclude="Given an array of integers")
    for line in ("Let's park that and get to the coding.", "Let's keep that thread for later.", "We can come back to that story after the coding."):
        assert promises_to_return(line), line


def test_a_noun_phrase_of_their_own_words_needs_a_deferral_and_is_not_the_problems_or_a_plan_word():
    from app.interviewer.closing import promises_to_return
    said = "We had a database migration fail once and I rolled it back."
    assert promises_to_return("We'll come back to the migration later.", said)
    assert not promises_to_return("Let's go back to the migration and check it.", said)                       # no deferral past the part
    assert not promises_to_return("We'll come back to the migration later.", said, exclude="Migration of records between two tables")


def test_coming_back_to_it_or_getting_to_that_is_a_promise_only_with_a_deferral_that_is_not_sequencing():
    from app.interviewer.closing import promises_to_return

    for line in ("Okay, I'll come back to it after you've had a go at the code.", "I'd like to get to that now: what about duplicates?",
                 "We'll come back to this soon, first read the statement."):
        assert not promises_to_return(line), line
    assert promises_to_return("Let's get back to that after the coding.")
    assert promises_to_return("I'll come back to it later.")


def test_a_bare_that_is_for_later_after_coding_talk_is_the_plans_own_sequencing_not_a_promise():
    """A rehearsal (2026-10-17): to a candidate starting on "the time and space cost of this first version" before any problem was
    up, the interviewer said "That's for later — there's still nothing on your screen to time." It was filed as a topic to come back
    to, under the projects discussion. The coding part comes anyway; what they raised was not a topic of theirs."""
    from app.interviewer.closing import promises_to_return

    line = "That's for later — there's still nothing on your screen to time."
    coding = "Now I will walk through the time and space cost of this first version."
    story = "Honestly the funniest part was when I built a chat app during my internship and it crashed."
    assert not promises_to_return(line, coding, "")
    assert not promises_to_return("That's for later. Let's stay with your background.", "I would start with a brute force and then improve it.", "")
    assert promises_to_return("That's for later, let's keep going with the intro.", story, "")


def test_ends_with_goodbye_is_true_only_when_the_last_sentence_takes_leave():
    from app.interviewer.closing import ends_with_goodbye
    for yes in ("Thanks, bye!", "Goodbye.", "You too, take care.", "Thank you for your time today, Asha. Take care, and goodbye.",
                "That's all from me. Have a great day!", "See you around.", "Thanks for your time today.", "Thanks for the interview.",
                "Great work. All the best."):
        assert ends_with_goodbye(yes), yes
    for no in ("Let's close out the first problem and look at the second.", "Best of luck with the second one.",
               "I'll take care of the null case first.", "Thanks, that helps. Now what about duplicates?",
               "Thanks for your time on that one, so the cache is keyed by user and then by key.", "Take care of the edge case, then go on."):
        assert not ends_with_goodbye(no), no


def test_a_goodbye_phrase_that_carries_on_past_itself_is_not_a_goodbye():
    # The re-review's probes: "see you've", "the time complexity", "the best case" are not leave-takings.
    from app.interviewer.closing import ends_with_goodbye
    for text in ("I see you've used a hash map.", "Thank you for the time complexity analysis.", "So the all the best case is O(n)."):
        assert not ends_with_goodbye(text), text
    for text in ("Thanks for your time today, Divya.", "See you soon!", "You too, take care.", "Have a great day, Ananya!",
                 "Thanks, that was a good chat. Take care and all the best."):
        assert ends_with_goodbye(text), text


def test_a_present_tense_claim_that_a_problem_is_on_screen_is_found_and_the_future_forms_are_not():
    for claim in ("Alright, let's get into the coding now \u2014 give me your approach to the problem on your screen.",
                  "Here's your first question. Give it a read.", "Give it a read and tell me what you think.",
                  "The problem on your screen is a stack one.", "Let's get into the coding now.",
                  "Go ahead and give me your approach to the problem."):
        assert claims_problem_on_screen_now(claim), claim
    for fine in ("A problem will come up on your screen later, so keep that in mind.", "I'll put a problem up for you after that.",
                 "We'll start with a short chat, then I'll put a problem on your screen, and we'll finish with your questions.",
                 "Tell me a bit about yourself.", "Let's start with the background."):
        assert not claims_problem_on_screen_now(fine), fine


def test_a_coding_now_line_that_has_then_and_starting_with_is_a_claim_but_the_round_outline_is_not():
    line = "Let's get into the coding now, starting with brute force, then optimize it to linear time over the next ten minutes."
    assert announces_coding_now(line) and claims_problem_on_screen_now(line)
    p20 = ("That works well. So, let me tell you how this round will run \u2014 it'll be a fairly full round, starting with a bit "
           "about your background and your projects, then one or two coding problems where I'll be more interested in how you think than in "
           "perfect syntax, and we'll finish with your questions for me.")
    assert gives_outline(p20) and not claims_problem_on_screen_now(p20)


def test_a_future_word_cancels_only_the_phrase_it_governs():
    assert claims_problem_on_screen_now("Give it a read and then walk me through it.")
    assert claims_problem_on_screen_now("Once it's up, give it a read.")
    assert not claims_problem_on_screen_now("I'll put the problem on your screen later.")
    assert not claims_problem_on_screen_now("The problem on your screen will come up later.")
    assert not claims_problem_on_screen_now("Tell me an approach to the problem of caching.")


# ---- interviewer style: verdict budget

@pytest.mark.parametrize("text", ["I'd use a stack. Is that right?", "Does that work?", "So the answer is 13, correct?", "Is this correct?",
                                  "Am I on the right track?", "Does that make sense?"])
def test_a_candidate_asking_whether_something_is_right_is_recognised(text):
    from app.interviewer.closing import asks_if_right

    assert asks_if_right(text)


@pytest.mark.parametrize("text", ["I'd use a stack.", "What does the problem say about negatives?", "Okay.", "Can I use Python?", ""])
def test_other_turns_are_not_asking_whether_something_is_right(text):
    from app.interviewer.closing import asks_if_right

    assert not asks_if_right(text)


def test_an_assumption_and_a_request_to_trace_are_recognised():
    from app.interviewer.closing import asks_to_trace, states_assumption

    for text in ("I assume the input is valid.", "I'll assume it's sorted.", "Assuming no duplicates, I scan once.", "Can I assume ascii?"):
        assert states_assumption(text), text
    assert not states_assumption("I'd use a stack.")
    for text in ("Run it through your code with the input 5, negative 6.", "Can you trace it on all zeros?", "Walk me through that input.", "Try the input zero, zero, zero."):
        assert asks_to_trace(text), text
    assert not asks_to_trace("What does it cost in time?")


@pytest.mark.parametrize("text", ["Sure, writing the two-pointer version now.", "Okay, I'll write it.", "Let me code it.", "Okay, writing it now.", "Alright, typing out the solution now."])
def test_a_pure_statement_that_they_are_starting_to_code_is_recognised(text):
    from app.interviewer.closing import says_starting_to_code

    assert says_starting_to_code(text)


@pytest.mark.parametrize("text", ["I'm coding this but I'm stuck, give me a hint", "I'm writing it but I don't understand the second example",
                                  "Coding is hard under pressure right now", "Okay I'm writing the loop now, can I use a set",
                                  "I am writing the brute force first then I will optimize", "Should I write it in Python?",
                                  "I'll write it, wait, is the input sorted", "Okay, let me write the whole thing out now with all the helper functions"])
def test_a_help_request_a_question_a_caveat_or_a_long_plan_is_not_a_pure_start(text):
    from app.interviewer.closing import says_starting_to_code

    assert not says_starting_to_code(text)


def test_the_widened_now_phrase_is_narrowed_to_a_statement_that_starts_with_the_writing():
    from app.interviewer.closing import starts_coding

    assert not starts_coding("Coding is hard under pressure right now")
    assert not starts_coding("I am writing the brute force first then I will optimize")
    assert starts_coding("Sure, writing the two-pointer version now.")


def test_saying_okay_new_problem_when_the_second_problem_goes_up_is_not_asking_for_another():
    """b1 struggler_gives_up: "Okay, new problem. So I need all triplets..." was counted as a change request on the second problem and
    the plan swapped it for a reserve the candidate never saw."""
    from app.interviewer.closing import asks_to_change_problem

    for line in ("Okay, new problem. So I need all triplets of transactions that add up to zero, and no duplicates.",
                 "Alright, a new problem. My first idea is to try every combination of three.",
                 "This is a different problem from the last one, so I will start with the brute force."):
        assert not asks_to_change_problem(line), line
    for line in ("Can I get a new problem?", "I want another problem, please.", "Could you give me an easier question?",
                 "Can you change the problem?", "I asked for another problem, actually."):
        assert asks_to_change_problem(line), line


def test_a_sentence_that_closes_the_coding_part_is_recognised_and_ordinary_coding_talk_is_not():
    from app.interviewer.closing import closes_coding_part

    for line in ("That wraps up the coding part.", "That wraps up the coding part. Now a couple of questions about your projects.",
                 "That's the coding done.", "Alright, the coding part is done.", "Let's leave the coding there.", "We're done with the coding.",
                 "Now a couple of questions about your projects, then some quick fundamentals."):
        assert closes_coding_part(line), line
    for line in ("Walk me through the coding approach.", "Start the coding when you are ready.", "That wraps up the first case, now the second.",
                 "How does the coding of the loop change for sorted input?"):
        assert not closes_coding_part(line), line


def test_a_claim_that_the_problem_or_screen_failed_to_show_is_recognised_and_ordinary_screen_talk_is_not():
    from app.interviewer.closing import claims_screen_failed

    for line in ("I don't think the problem made it onto your screen properly.", "Let me put it up again.", "It looks like the problem didn't load on your screen.",
                 "The problem isn't showing on your screen, let me try again.", "Sorry, the problem did not come up on your screen."):
        assert claims_screen_failed(line), line
    for line in ("Take a moment to read the problem on your screen.", "What does the problem say about duplicates?", "Let me put the second problem on your screen.",
                 "Can you see the problem now?", "If the screen doesn't load for you, tell me."):
        assert not claims_screen_failed(line), line


def test_opening_another_topic_while_they_write_is_recognised():
    from app.interviewer.closing import opens_topic_while_coding

    for line in ("While you do, let me ask something else.", "While you write that, tell me about your projects.", "Meanwhile, can I ask about your last job?",
                 "In the meantime, a different question: what is a mutex?", "Let me ask you something unrelated."):
        assert opens_topic_while_coding(line), line
    for line in ("Take your time to write that out.", "Go ahead and write it, I will be here.", "While you type, I am just following along.",
                 "Please think aloud while you work and ask me anything that isn't clear."):
        assert not opens_topic_while_coding(line), line


def test_the_problem_lines_are_recognised_as_such():
    from app.interviewer.closing import problem_line_part

    assert problem_line_part("Let me put the second problem on your screen.") == "put_up"
    assert problem_line_part("Here's your second question.") == "intro"
    assert problem_line_part("Give it a read, and let me know if you have any questions.") == "intro_end"
    assert problem_line_part("What is your first idea?") is None


def test_a_duration_or_minutes_is_never_spoken_but_ordinary_time_words_are():
    from app.interviewer.closing import says_duration

    for t in ["We'll spend about twenty-two minutes on problems.", "You have 10 minutes left.", "This round is forty-five minutes long.",
              "Take a couple of minutes to read it.", "We have half an hour.", "This is a five minute part.", "Take a ten-minute pass at it.",
              "We are at the forty-five minute mark.", "twenty minute left", "You have thirty seconds.", "It is a 45-minute round.", "About 5 mins left."]:
        assert says_duration(t), t
    for t in ["What's the time complexity?", "That's O(n) time.", "Take your time.", "Say it one more time.", "Is this your first time?",
              "We're short on time, so I'll skip the React questions.", "Why a min heap here?", "Could you use a min-heap instead?",
              "What is the min of the window?", "Keep a running min and max.", "Push it onto the min stack.", "So you track the mins of each row?",
              "I spent hours debugging it.", "Take your minute, then give me your answer.", "Give me a second.", "Two min heaps, one per half?"]:
        assert not says_duration(t), t


def test_a_candidate_announcing_what_they_will_do_next_is_recognised():
    from app.interviewer.closing import announces_next_step

    for line in ("Let me trace it on minus one, zero, one, two.", "I'll test it with an empty array.", "Okay, let me run that quickly.",
                 "I'm going to add a check for the empty case.", "Let me try fixing the off by one first.", "I can write the two pointer version now."):
        assert announces_next_step(line), line
    for line in ("I think the complexity is n squared.", "I traced it and it gives two.", "We tried that last week at work."):
        assert not announces_next_step(line), line


def test_the_screen_failed_claim_keeps_its_precision_on_the_review_probes():
    """Polish review finding 2: ordinary talk about what the example shows is not a claim that the screen failed."""
    from app.interviewer.closing import claims_screen_failed

    for line in ("The example doesn't show duplicates, so ask me if it matters.", "Your code doesn't show the base case yet, does it?",
                 "That wasn't shown in the example, but it's allowed.", "The output isn't displayed until you run it.",
                 "Let me put the example up again if that helps."):
        assert not claims_screen_failed(line), line
    assert not claims_screen_failed("Let me pull that up again for you.", "Can you show the constraints again?")
    assert not claims_screen_failed("Let me put it up again.", "Could you repeat the problem?")
    assert not claims_screen_failed("Let me put it up again.", "I can't see anything.")
    for line in ("I don't think the problem made it onto your screen properly.", "The problem didn't load on the screen, it seems.",
                 "The problem hasn't come up on your screen.", "Your screen went blank.", "It looks like your screen is blank."):
        assert claims_screen_failed(line), line
    assert claims_screen_failed("Let me put it up again.", "I think it is O of n.")


def test_asks_to_change_problem_keeps_recall_on_terse_requests_and_drops_non_requests():
    """Polish review finding 3."""
    from app.interviewer.closing import asks_to_change_problem

    for text in ("Different problem.", "Another problem?", "Another one.", "Another problem. I can't solve this.", "This is too hard, a different question?",
                 "Hmm, different problem then.", "A different problem, please.", "Can I get a new problem?", "I want another problem, please.",
                 "Could you give me an easier question?", "Can we try a different one?", "Let's try another problem.", "Give me a different question.",
                 "Skip to another problem."):
        assert asks_to_change_problem(text), text
    for text in ("I have a different problem: my code fails on the empty array.", "Okay, new problem, I'd like to understand it first.",
                 "Okay, new problem. So I need all triplets of transactions that add up to zero.", "This new problem looks like the earlier one.",
                 "The new problem has duplicates, so I need to handle them.", "Okay, new problem. So I need triplets.",
                 "Alright, a new problem. My first idea is to try every combination of three."):
        assert not asks_to_change_problem(text), text


def test_a_conditional_coding_is_done_is_not_a_close():
    from app.interviewer.closing import closes_coding_part

    assert not closes_coding_part("The coding is done when your tests pass, so run them.")
    assert not closes_coding_part("Once the coding is done, we will look at the complexity.")
    assert closes_coding_part("That wraps up the coding part.")


def test_round2_screen_failure_needs_the_screen_in_the_sentence():
    """Re-review A: "make it" and bare "showing" in ordinary talk about the problem are not a claim that the screen failed."""
    from app.interviewer.closing import claims_screen_failed

    for line in ("The problem didn't make it clear whether the array is sorted, good question.", "This question didn't come up in my last round.",
                 "The problem isn't showing the constraint on n, but it's up to 10^5."):
        assert not claims_screen_failed(line), line
    for line in ("I don't think the problem made it onto your screen properly. Let me put it up again.", "The problem didn't load on your screen.",
                 "It didn't show up on the screen, it seems.", "The problem is not showing on your screen."):
        assert claims_screen_failed(line), line


def test_round2_a_clarifying_question_is_not_a_request_for_another_problem():
    """Re-review B."""
    from app.interviewer.closing import asks_to_change_problem

    for text in ("Another question, can the array be empty?", "Another question: are the numbers sorted?", "Can I ask a different question about the input?",
                 "Can I ask another question?"):
        assert not asks_to_change_problem(text), text
    for text in ("Another question?", "Can I get a different question?", "A different question please, this one is too hard.",
                 "This is too hard, a different question?", "Another problem?", "Another problem, can we do that?"):
        assert asks_to_change_problem(text), text


def test_here_is_your_second_or_third_question_is_a_present_tense_screen_claim():
    for n in ("first", "second", "third", "next"):
        assert claims_problem_on_screen_now(f"Here's your {n} question."), n
        assert claims_problem_on_screen_now(f"Here is your {n} problem. Take a look."), n


def test_the_coding_part_closing_phrases_are_recognised_with_part_curly_apostrophes_and_done_with():
    """b6b drifter seq 35: "That's the coding part done, both problems wrapped up cleanly." The shared predicate is the one the talker guard and
    tracecheck use."""
    from app.interviewer.closing import closes_coding_part

    for line in ("That's the coding part done, both problems wrapped up cleanly.", "That\u2019s the coding part done.", "The coding part is done.",
                 "We're done with the coding part.", "We\u2019re done with the coding part.", "I'm done with the coding part, thanks.",
                 "That's it for the coding part.", "That wraps up the coding part."):
        assert closes_coding_part(line), line
    assert not closes_coding_part("Once the coding part is done we move on.")


def test_a_change_request_that_speech_to_text_cut_off_at_to_is_a_request_but_changing_their_code_is_not():
    """Live round 2a2cb5c2 turn 19: "Can we change it too?" was transcribed "Can we change it to" and was not seen as a request."""
    from app.interviewer.closing import asks_to_change_problem

    for text in ("Can we change it to", "Can we change it to.", "Can we change it too?", "Can we change this one too?", "can we swap it to...",
                 "Okay. Can we change it too"):
        assert asks_to_change_problem(text), text
    for text in ("Can we change it to a set?", "change it to a hash set", "I will change it to use a set", "Let me change it to",
                 "Okay so I'll change it to", "Maybe I can change it to"):
        assert not asks_to_change_problem(text), text


def test_leaving_the_problem_is_told_apart_from_putting_up_the_one_that_is_on_screen():
    from app.interviewer.closing import abandons_problem, announces_leaving, puts_up_problem_again

    for text in ("Alright, since you'd like a change, let's leave this one there too.", "Looks like we're not getting much coding going today.",
                 "Let me shift gears, and we'll talk about your projects and some fundamentals instead.", "That wraps up the coding part.",
                 "Let's move on to your projects."):
        assert announces_leaving(text) and abandons_problem(text), text
    assert announces_leaving("I have another problem for you.") and not abandons_problem("I have another problem for you.")
    for text in ("Walk me through your approach.", "Let's go deeper into the complexity.", "Let's get into the edge cases.", "What would you move on to next in your loop?"):
        assert not announces_leaving(text), text
    assert puts_up_problem_again("Let me put the second problem on your screen.", 2) and puts_up_problem_again("Here's your second question.", 2)
    assert puts_up_problem_again("The problem should be up now.", 2) and puts_up_problem_again("Give it a read and tell me what you think.", 2)
    assert not puts_up_problem_again("Let me put the second problem on your screen.", 1)             # the next problem's line, said while on problem 1
    assert not puts_up_problem_again("Walk me through the second example.", 2)


def test_a_farewell_phrase_followed_by_a_question_to_the_candidate_is_not_a_farewell():
    """bf82d318 turn 37: "...thank you for your time today. What questions do you have for me?" ended a 45-minute round at 5 minutes."""
    from app.interviewer.closing import is_farewell
    opening = ("No problem. Let's move on - that's fine. That's everything I wanted to ask, so now it's your turn - thank you for your time today. "
               "What questions do you have for me about the role or the team?")
    assert not is_farewell(opening)
    assert not is_farewell("Thanks for your time today. Any questions for me?")
    assert not is_farewell("Thank you for your time today, so the floor is yours")
    for yes in ("Thanks for your time today. Take care.", "Any questions? Thanks for your time today, take care.", "Thank you for your time today.",
                "That's all from my side. Have a great day!"):
        assert is_farewell(yes), yes
    assert not is_farewell("How would you scan the array once?")


def test_has_leave_taking_sees_a_farewell_phrase_anywhere_in_the_text():
    from app.interviewer.closing import has_leave_taking
    assert has_leave_taking("It's your turn - thank you for your time today. What questions do you have?")
    assert has_leave_taking("Take care.")
    assert not has_leave_taking("What questions do you have for me about the role?")


def test_refusal_points_names_the_family_of_each_point_a_refusal_makes():
    from app.interviewer.closing import refusal_points
    assert refusal_points("I'd like you to stay with this one. A partial solution is perfectly fine, I'd just like to see how far you get.") \
        == {"partial_fine", "see_how_far"}               # holding firm is the refusal itself, not a point
    assert refusal_points("Give it a good try first.") == {"give_it_a_try"}
    assert refusal_points("Start with something simple and build from there.") == {"start_small"}
    assert refusal_points("What is your approach?") == set()


# ------------------------------------------------------------------ final review wave (decided 2026-10-18)

def test_every_length_of_time_is_blocked_except_one_that_exactly_matches_the_current_problems_text():
    """Owner-approved: no round-time cue and no candidate exemption; a length passes only as a whole length the current problem states."""
    from app.interviewer.closing import says_duration

    problem = "The cache entries expire after 10 minutes. Count the hits in the past 5 minutes. What if a request takes 2 seconds? Allow 45 minutes of data."
    for t in ("The cache entries expire after 10 minutes.", "Count the hits in the past five minutes.", "What if a request takes 2 seconds?",
              "The cache entries expire after ten minutes.", "Say it holds forty-five minutes of data."):
        assert not says_duration(t, problem), t
    for t in ("That leaves us ten minutes.", "Five minutes to go.", "In ten minutes we will switch to design.", "For the next 15 minutes, focus on code.",
              "This should take fifteen minutes.", "We are about thirty minutes in.", "The next twenty minutes are for coding.", "You have ten minutes left.",
              "Okay, we're aiming to finish everything in about forty-five minutes, so keep going.", "We'll spend about twenty-two minutes on problems.",
              "This round is forty-five minutes.", "We have half an hour.", "Take a couple of minutes to read it.", "That is about 1 million requests an hour."):
        assert says_duration(t), t
        assert says_duration(t, "the entries expire after 99 minutes, 2 seconds, 24 hours"), t
    # whole-length comparison, never a substring: "5 minutes" is not "15 minutes", "10 minutes" is not "110 minutes"
    assert says_duration("Count the hits in the past 5 minutes.", "Entries expire after 15 minutes.")
    assert says_duration("Entries expire after 10 minutes.", "The window is 110 minutes.")
    assert says_duration("Wait for 10 seconds.", "Entries expire after 10 minutes.")
    # a length spelled another way is the same length; units are unified ("mins", "hrs", "secs"; "an hour" = "one hour" = "1 hour")
    for spoken, stated in (("It takes 10 mins.", "after ten minutes"), ("It takes ten minutes.", "after 10 mins"), ("Wait an hour.", "within 1 hour"),
                           ("Wait one hour.", "within an hour"), ("Wait 30 secs.", "up to thirty seconds"), ("Wait 2 hrs.", "up to two hours")):
        assert not says_duration(spoken, stated), (spoken, stated)
    # the candidate's words never exempt a length (they are not part of `allowed` any more)
    assert says_duration("You said thirty seconds per request, so what is your part of the budget there?")
    # ordinary time words stay unblocked
    for t in ("What's the time complexity?", "That's O(n) time.", "Take your time.", "Say it one more time.", "Is this your first time?",
              "We're short on time, so I'll skip the React questions.", "Why a min heap here?", "Give me a second.", "Take a minute, then answer."):
        assert not says_duration(t, problem), t


def test_a_word_like_next_or_done_hides_an_ask_only_in_the_sentence_that_asks_run_a_seq_22():
    """I8: "...the parcel does carry into the next day now ... Could I please get a different problem?" was not read as a change request because
    "next" appeared anywhere in the turn."""
    from app.interviewer.closing import asks_to_change_problem

    seq22 = ("Okay, so I did fix the rollover, the parcel does carry into the next day now, but I'm really stuck on how to avoid trying every "
             "capacity one by one. Just going up by one feels too slow and I don't know the trick here. Could I please get a different problem?")
    assert asks_to_change_problem(seq22)
    assert asks_to_change_problem("I'm done with the first part. Can we change the problem?")          # "done" is in another sentence
    for text in ("Can I get the next problem? I'm done", "I'm done, ready for the next one", "I'm done, can I get another problem?",
                 "Can you change the language to C++?", "I solved this one, can we do the next question?", "Okay, I'm ready for the next problem, can we move on?",
                 "I'm done, what's next?"):
        assert not asks_to_change_problem(text), text
