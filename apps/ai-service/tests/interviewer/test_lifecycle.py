"""One interviewer worker at a time, and none left running once the servers beside it are gone."""
import socket
import threading

import pytest

from app.interviewer.lifecycle import AlreadyRunning, ServerWatch, parse_servers, reachable, single_instance, start_watchdog


def test_a_second_worker_for_the_same_agent_is_refused_and_a_released_lock_can_be_taken_again(tmp_path):
    lock = tmp_path / "w.lock"
    first = single_instance("interviewer", lock)
    with pytest.raises(AlreadyRunning, match="only one is needed"):
        single_instance("interviewer", lock)
    first.close()                                   # the process ended: the lock goes with it, nothing stale is left
    again = single_instance("interviewer", lock)
    assert again is not None
    again.close()


def test_the_lock_is_per_agent_name():
    from app.interviewer.lifecycle import lock_path

    assert lock_path("interviewer") != lock_path("other")
    assert lock_path("a/b c").name == "interviewiq-worker-a_b_c.lock"


def test_servers_are_read_from_a_comma_separated_list():
    assert parse_servers(" localhost:8080, http://localhost:3000 ,,") == ["localhost:8080", "http://localhost:3000"]
    assert parse_servers("") == []


def test_a_listening_port_is_up_and_a_closed_one_is_down():
    server = socket.socket()
    server.bind(("127.0.0.1", 0))
    server.listen()
    port = server.getsockname()[1]
    assert reachable(f"localhost:{port}") and reachable(f"http://127.0.0.1:{port}/anything")
    server.close()
    assert not reachable(f"127.0.0.1:{port}", timeout=1)


def test_a_server_is_down_only_after_several_misses_in_a_row_and_one_answer_starts_the_count_again():
    up = {"a": True, "b": True}
    watch = ServerWatch(["a", "b"], probe=lambda url: up[url], failures=3)
    assert watch.check() is None
    up["b"] = False
    assert [watch.check(), watch.check()] == [None, None]
    up["b"] = True                                  # a restart that took a moment: back before the third miss
    assert watch.check() is None
    up["b"] = False
    assert [watch.check(), watch.check(), watch.check()] == [None, None, "b"]


def test_the_watchdog_stops_the_worker_when_a_server_stays_down_and_does_nothing_with_an_empty_list():
    assert start_watchdog("") is None
    stopped = threading.Event()
    seen: list[str] = []
    watch = ServerWatch(["api"], probe=lambda url: False, failures=2)
    thread = start_watchdog("api", start_after_s=0, every_s=0.01, watch=watch, on_down=lambda url: (seen.append(url), stopped.set()))
    assert stopped.wait(2) and seen == ["api"]
    thread.join(2)
    assert not thread.is_alive()
