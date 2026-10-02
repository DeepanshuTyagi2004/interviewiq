"""Context for the research tracer. The runner binds the tracer for a run and the company for each
item; Tracer.span() binds span/company/node for its body. Read by the tracer (parent links), the log
handler (attribution) and Budget (per-node call counters). asyncio tasks copy the context when
created, so LangGraph's node tasks inherit whatever was bound around graph.astream()."""
from __future__ import annotations

from contextvars import ContextVar
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from app.research.trace.tracer import Tracer

CURRENT_TRACER: ContextVar["Tracer | None"] = ContextVar("research_tracer", default=None)
CURRENT_SPAN: ContextVar[str | None] = ContextVar("research_span", default=None)
CURRENT_COMPANY: ContextVar[str | None] = ContextVar("research_company", default=None)
CURRENT_NODE: ContextVar[str | None] = ContextVar("research_node", default=None)
