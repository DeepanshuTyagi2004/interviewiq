from app.interviewer.closing import announces_coding_now, gives_outline


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

    for line in ("Okay, writing it now.", "Okay writing.", "Let me write it.", "I'll code it up now.", "Starting to type it out.", "Okay, going to write the code."):
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
