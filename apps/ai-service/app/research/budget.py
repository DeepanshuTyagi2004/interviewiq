"""Per-run call caps (spec §5.3). charge() runs BEFORE each external call: it checks the cap and
counts the call in memory before its first await, so concurrent companies can never overshoot the
cap. The runner turns BudgetExhausted into an auto-pause with pause_reason=budget_exhausted."""
from __future__ import annotations

from typing import Literal

from app.research.store import ResearchStore
from app.research.trace.context import CURRENT_COMPANY, CURRENT_NODE

Kind = Literal["exa", "llm"]


class BudgetExhausted(RuntimeError):
    def __init__(self, kind: str, used: int, cap: int):
        super().__init__(f"{kind} budget exhausted ({used}/{cap} calls)")
        self.kind, self.used, self.cap = kind, used, cap


class Budget:
    def __init__(self, store: ResearchStore, run_id: str, *, exa_cap: int, llm_cap: int,
                 exa_used: int = 0, llm_used: int = 0):
        self._store = store
        self._run_id = run_id
        self._caps: dict[str, int] = {"exa": exa_cap, "llm": llm_cap}
        self._used: dict[str, int] = {"exa": exa_used, "llm": llm_used}

    @classmethod
    def from_run(cls, store: ResearchStore, run: dict) -> "Budget":
        b = run["budget"]
        return cls(store, run["run_id"], exa_cap=b["exa_cap"], llm_cap=b["llm_cap"],
                   exa_used=b.get("exa_used", 0), llm_used=b.get("llm_used", 0))

    def set_caps(self, *, exa_cap: int | None = None, llm_cap: int | None = None) -> None:
        if exa_cap is not None:
            self._caps["exa"] = exa_cap
        if llm_cap is not None:
            self._caps["llm"] = llm_cap

    async def charge(self, kind: Kind) -> None:
        used, cap = self._used[kind], self._caps[kind]
        if used >= cap:
            raise BudgetExhausted(kind, used, cap)
        self._used[kind] = used + 1   # before any await: this is what makes concurrent charges safe
        await self._store.update_run(self._run_id, inc={f"budget.{kind}_used": 1})
        company, node = CURRENT_COMPANY.get(), CURRENT_NODE.get()
        if company and node:
            await self._store.update_item(self._run_id, company, inc={f"nodes.{node}.{kind}_calls": 1})

    async def add_tokens(self, tokens_in: int, tokens_out: int) -> None:
        if tokens_in or tokens_out:
            await self._store.update_run(self._run_id, inc={"budget.tokens_in": tokens_in, "budget.tokens_out": tokens_out})
