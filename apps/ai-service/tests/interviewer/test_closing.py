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
