"""Keeping exactly one interviewer worker alive, and only while the servers it works beside are.

`single_instance` takes an exclusive lock on a file for the life of the process: a second worker for the same agent name exits at
once, and a worker that dies (or is killed) frees the lock by itself, so there is never a stale pid file to clean up.
`start_watchdog` is a dev safety net: it checks that the given servers still accept connections and, once one has been unreachable
for several checks in a row, stops the worker. Both are small and have no LiveKit in them, so they are unit-tested."""
from __future__ import annotations

import logging
import os
import signal
import socket
import tempfile
import threading
import time
from pathlib import Path
from typing import Callable, Iterable
from urllib.parse import urlparse

try:
    import fcntl
except ImportError:  # Windows: no lock, the worker still runs
    fcntl = None  # type: ignore[assignment]

logger = logging.getLogger(__name__)
START_AFTER_S = 60.0       # servers started together with the worker need time to come up before they count as down
CHECK_EVERY_S = 10.0
FAILURES_TO_STOP = 4       # unreachable this many checks in a row (about 40 s): a restart on a file change is not "down"
FORCE_EXIT_AFTER_S = 20.0  # a worker that has been asked to stop and is still there after this long is ended


class AlreadyRunning(Exception):
    """Another interviewer worker for this agent name holds the lock."""


def lock_path(agent_name: str) -> Path:
    safe = "".join(c if c.isalnum() or c in "-_" else "_" for c in agent_name) or "interviewer"
    return Path(tempfile.gettempdir()) / f"interviewiq-worker-{safe}.lock"


def ready_path(agent_name: str) -> Path:
    safe = "".join(c if c.isalnum() or c in "-_" else "_" for c in agent_name) or "interviewer"
    return Path(tempfile.gettempdir()) / f"interviewiq-worker-{safe}.ready"


def mark_ready(agent_name: str, path: Path | None = None) -> None:
    """Record that this worker has registered with LiveKit (its pid, so a dead worker's marker is not believed)."""
    (path or ready_path(agent_name)).write_text(str(os.getpid()))


def clear_ready(agent_name: str, path: Path | None = None) -> None:
    try:
        (path or ready_path(agent_name)).unlink()
    except OSError:
        pass


def worker_ready(agent_name: str, path: Path | None = None) -> bool:
    """Whether a worker for this agent name has registered and its process is alive. Reads only the .ready file, never the .lock
    (probing the lock from the HTTP side could make a starting worker exit with AlreadyRunning). Any error reads as not ready."""
    try:
        pid = int((path or ready_path(agent_name)).read_text().strip())
        os.kill(pid, 0)
        return True
    except (OSError, ValueError):
        return False


def single_instance(agent_name: str, path: Path | None = None):
    """Take the lock for this process's lifetime (keep the returned file object alive). Raises AlreadyRunning if it is held."""
    if fcntl is None:
        return None
    target = path or lock_path(agent_name)
    handle = open(target, "a+")
    try:
        fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except OSError:
        handle.seek(0)
        holder = handle.read().strip() or "unknown"
        handle.close()
        raise AlreadyRunning(f"an interviewer worker is already running (pid {holder}); only one is needed") from None
    handle.seek(0)
    handle.truncate()
    handle.write(str(os.getpid()))
    handle.flush()
    return handle


def parse_servers(raw: str) -> list[str]:
    return [u.strip() for u in (raw or "").split(",") if u.strip()]


def reachable(url: str, timeout: float = 3.0) -> bool:
    """Whether something accepts connections at the url's host and port. A TCP connect, not an HTTP request: a dev server that is busy
    compiling still accepts connections, and that is all "up" means here."""
    parsed = urlparse(url if "//" in url else f"//{url}")
    port = parsed.port or (443 if parsed.scheme == "https" else 80)
    try:
        with socket.create_connection((parsed.hostname or "localhost", port), timeout=timeout):
            return True
    except OSError:
        return False


class ServerWatch:
    def __init__(self, urls: Iterable[str], *, probe: Callable[[str], bool] = reachable, failures: int = FAILURES_TO_STOP) -> None:
        self.urls, self.probe, self.failures = list(urls), probe, failures
        self._misses = {u: 0 for u in self.urls}

    def check(self) -> str | None:
        """Probe every server once. Returns the first one that has now been unreachable `failures` checks in a row, else None."""
        down: str | None = None
        for url in self.urls:
            if self.probe(url):
                self._misses[url] = 0
                continue
            self._misses[url] += 1
            if down is None and self._misses[url] >= self.failures:
                down = url
        return down


def _stop_this_process(url: str) -> None:
    logger.warning("%s has been unreachable for a while: stopping the interviewer worker", url)
    force = threading.Timer(FORCE_EXIT_AFTER_S, os._exit, args=(1,))
    force.daemon = True
    force.start()
    os.kill(os.getpid(), signal.SIGTERM)


def start_watchdog(raw_servers: str, *, start_after_s: float = START_AFTER_S, every_s: float = CHECK_EVERY_S,
                   on_down: Callable[[str], None] = _stop_this_process, watch: ServerWatch | None = None) -> threading.Thread | None:
    """Watch the comma-separated servers in a daemon thread; None (nothing started) when the list is empty."""
    urls = parse_servers(raw_servers)
    if not urls and watch is None:
        return None
    watch = watch or ServerWatch(urls)

    def loop() -> None:
        time.sleep(start_after_s)
        while True:
            down = watch.check()
            if down is not None:
                on_down(down)
                return
            time.sleep(every_s)

    thread = threading.Thread(target=loop, name="server-watchdog", daemon=True)
    thread.start()
    return thread
