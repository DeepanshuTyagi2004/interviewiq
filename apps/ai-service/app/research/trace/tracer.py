"""Full-verbosity trace for research runs (spec §10): spans carrying their complete input and
output, an append-only event log with a per-run monotonic `seq`, large values offloaded to
research_payloads, and redaction applied before anything is persisted.

Spans are written immediately (at start and at end) so the debugger shows work in flight. Events
are buffered and flushed every `flush_interval` seconds or every `flush_max` events, so a chatty
node never costs one Mongo write per log line."""
from __future__ import annotations

import asyncio
import json
import logging
import time
import uuid
from collections.abc import AsyncIterator, Callable
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from typing import Any

from app.research.store import LEVEL_RANK, DuplicateKey, ResearchStore
from app.research.trace.context import CURRENT_COMPANY, CURRENT_NODE, CURRENT_SPAN
from app.research.trace.errors import error_info
from app.research.trace.redact import redact

# app.research.trace.* records are NOT forwarded by ResearchLogHandler: a failing flush that logged
# into the trace would just retry forever.
logger = logging.getLogger(__name__)

INLINE_LIMIT_BYTES = 32 * 1024
_MAX_MESSAGE_CHARS = 4000


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def new_id() -> str:
    return uuid.uuid4().hex


def _size(value: Any) -> int:
    return len(json.dumps(value, default=str, ensure_ascii=False).encode())


class SpanHandle:
    """Yielded by Tracer.span(): the body attaches its output and any extra attributes."""

    def __init__(self, span_id: str):
        self.span_id = span_id
        self.output: Any = None
        self.has_output = False
        self.attrs: dict[str, Any] = {}

    def set_output(self, value: Any) -> None:
        self.output = value
        self.has_output = True

    def set_attrs(self, **attrs: Any) -> None:
        self.attrs.update(attrs)


class Tracer:
    def __init__(self, store: ResearchStore, run_id: str, *, secrets: dict[str, str], start_seq: int = 0,
                 flush_interval: float = 0.25, flush_max: int = 200,
                 echo: Callable[[dict], None] | None = None):
        self._store = store
        self.run_id = run_id
        self._secrets = secrets
        self._seq = start_seq
        self._flush_interval = flush_interval
        self._flush_max = flush_max
        self._echo = echo
        self._buffer: list[dict] = []
        self._pending_payloads: list[dict] = []
        self._lock = asyncio.Lock()
        self._task: asyncio.Task | None = None
        self._kick_pending = False

    @property
    def last_seq(self) -> int:
        return self._seq

    def _redact(self, value: Any) -> Any:
        return redact(value, self._secrets)

    def redact(self, value: Any) -> Any:
        """Scrub configured secrets from `value` (for writers that bypass the tracer, e.g. node status)."""
        return self._redact(value)

    # --- lifecycle -------------------------------------------------------------------------------
    async def start(self) -> None:
        if self._task is None:
            self._task = asyncio.create_task(self._flush_loop(), name=f"research-trace-flush-{self.run_id}")

    async def close(self) -> None:
        if self._task is not None:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
            self._task = None
        await self.flush()

    async def _flush_loop(self) -> None:
        while True:
            await asyncio.sleep(self._flush_interval)
            try:
                # Shielded: close() cancels this loop, and a cancel must never interrupt a flush that has
                # already swapped out its batch (those events would be neither stored nor re-queued).
                await asyncio.shield(self.flush())
            except Exception:  # noqa: BLE001 — a failed flush is retried on the next tick
                logger.exception("research trace flush failed (run %s)", self.run_id)

    async def flush(self) -> None:
        async with self._lock:
            # Payloads first (events reference them via data_ref); a payload leaves the queue only
            # once written, so a failure keeps it and every later one pending and skips the events.
            while self._pending_payloads:
                await self._store.put_payload(self._pending_payloads[0])
                self._pending_payloads.pop(0)
            batch, self._buffer = self._buffer, []
            if not batch:
                return
            try:
                await self._store.insert_events(batch)
                await self._store.update_run(self.run_id, fields={"last_seq": batch[-1]["seq"]})
            except DuplicateKey:
                # Re-queueing would fail identically forever; drop the batch and say so.
                logger.error("dropping %d trace events (run %s, seq %d-%d): duplicate (run_id, seq)",
                             len(batch), self.run_id, batch[0]["seq"], batch[-1]["seq"])
            except Exception:
                self._buffer = batch + self._buffer   # keep them for the next tick
                raise

    # --- events ----------------------------------------------------------------------------------
    def emit(self, type_: str, message: str, *, level: str = "info", data: Any = None,
             span_id: str | None = None, company_id: str | None = None, node: str | None = None) -> dict:
        self._seq += 1
        event: dict[str, Any] = {
            "run_id": self.run_id,
            "seq": self._seq,
            "ts": utcnow(),
            "level": level,
            "level_rank": LEVEL_RANK[level],
            "type": type_,
            "message": self._redact(str(message))[:_MAX_MESSAGE_CHARS],
            "span_id": span_id or CURRENT_SPAN.get(),
            "company_id": company_id or CURRENT_COMPANY.get(),
            "node": node or CURRENT_NODE.get(),
        }
        if data is not None:
            clean = self._redact(data)
            if _size(clean) <= INLINE_LIMIT_BYTES:
                event["data"] = clean
            else:
                payload_id = new_id()
                event["data_ref"] = payload_id
                self._pending_payloads.append(self._payload_doc(payload_id, event["span_id"], clean))
        self._buffer.append(event)
        if self._echo is not None:
            self._echo(event)
        if len(self._buffer) >= self._flush_max and not self._kick_pending:
            try:
                loop = asyncio.get_running_loop()
            except RuntimeError:
                return event   # emitted from a thread with no loop: the timer flush picks it up
            self._kick_pending = True
            loop.create_task(self._kicked_flush())
        return event

    async def _kicked_flush(self) -> None:
        try:
            await self.flush()
        except Exception:  # noqa: BLE001
            logger.exception("research trace flush failed (run %s)", self.run_id)
        finally:
            self._kick_pending = False

    # --- spans -----------------------------------------------------------------------------------
    @asynccontextmanager
    async def span(self, kind: str, name: str, *, input: Any = None,  # noqa: A002 — mirrors the UI's Input tab
                   attrs: dict | None = None, company_id: str | None = None,
                   node: str | None = None) -> AsyncIterator[SpanHandle]:
        span_id = new_id()
        company = company_id or CURRENT_COMPANY.get()
        node_name = node or CURRENT_NODE.get()
        doc: dict[str, Any] = {
            "span_id": span_id,
            "parent_id": CURRENT_SPAN.get(),
            "run_id": self.run_id,
            "company_id": company,
            "node": node_name,
            "kind": kind,
            "name": name,
            "status": "running",
            "started_at": utcnow(),
            "ended_at": None,
            "duration_ms": None,
            "attrs": self._redact(attrs or {}),
            "error": None,
            "output": None,
            "output_ref": None,
        }
        doc["input"], doc["input_ref"] = await self._inline_or_payload(span_id, input)
        await self._store.put_span(doc)
        self.emit("span.start", f"{kind} · {name}", level="debug", span_id=span_id, company_id=company, node=node_name)

        handle = SpanHandle(span_id)
        span_token = CURRENT_SPAN.set(span_id)
        company_token = CURRENT_COMPANY.set(company)
        node_token = CURRENT_NODE.set(node_name)
        started = time.monotonic()
        try:
            yield handle
            doc["status"] = "ok"
        except asyncio.CancelledError:
            doc["status"] = "cancelled"
            raise
        except Exception as exc:
            doc["status"] = "error"
            doc["error"] = self._redact(error_info(exc))
            raise
        finally:
            CURRENT_NODE.reset(node_token)
            CURRENT_COMPANY.reset(company_token)
            CURRENT_SPAN.reset(span_token)
            await self._finish_span(doc, handle, started)

    async def _finish_span(self, doc: dict, handle: SpanHandle, started: float) -> None:
        doc["ended_at"] = utcnow()
        doc["duration_ms"] = int((time.monotonic() - started) * 1000)
        if handle.attrs:
            doc["attrs"] = {**doc["attrs"], **self._redact(handle.attrs)}
        try:
            if handle.has_output:
                doc["output"], doc["output_ref"] = await self._inline_or_payload(doc["span_id"], handle.output)
            await self._store.put_span(doc)
        except Exception:  # noqa: BLE001 — never mask the body's own outcome
            logger.exception("could not persist span %s", doc["span_id"])
        message = f"{doc['kind']} · {doc['name']} · {doc['status']} · {doc['duration_ms']}ms"
        if doc["error"]:
            message += f" · {doc['error']['type']}: {doc['error']['message'][:300]}"
        self.emit(
            "span.end", message, level="error" if doc["status"] == "error" else "debug",
            span_id=doc["span_id"], company_id=doc["company_id"], node=doc["node"],
            data={"status": doc["status"], "duration_ms": doc["duration_ms"]},
        )

    # --- payload offload -------------------------------------------------------------------------
    def _payload_doc(self, payload_id: str, span_id: str | None, body: Any) -> dict:
        return {"payload_id": payload_id, "run_id": self.run_id, "span_id": span_id,
                "content_type": "application/json", "size_bytes": _size(body), "body": body,
                "created_at": utcnow()}

    async def _inline_or_payload(self, span_id: str, value: Any) -> tuple[Any, str | None]:
        if value is None:
            return None, None
        clean = self._redact(value)
        if _size(clean) <= INLINE_LIMIT_BYTES:
            return clean, None
        payload_id = new_id()
        await self._store.put_payload(self._payload_doc(payload_id, span_id, clean))
        return None, payload_id


async def hydrate_span(store: ResearchStore, span: dict) -> dict:
    """Return the span with offloaded input/output read back from research_payloads."""
    out = dict(span)
    for key in ("input", "output"):
        ref = out.get(f"{key}_ref")
        if ref:
            payload = await store.get_payload(ref)
            out[key] = payload["body"] if payload else {"missing_payload": ref}
    return out
