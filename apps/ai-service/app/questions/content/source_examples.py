"""Source statements and their worked examples (`docs/question-bank.md`).

The Kaggle LeetCode dataset we already download carries each problem's statement, including its
"Example 1: Input: nums = [2,7], target = 9  Output: [0,1]" blocks. Those examples were validated
by the source, so they are ground truth: a generated solution must reproduce them exactly. The
statement text is read at generation time and handed to the model for rewording; it is not stored.
"""
from __future__ import annotations

import ast
import csv
import io
import json
import logging
import re
from dataclasses import dataclass

from app.questions.collectors.dsa import leetcode_slug
from app.questions.kaggle import fetch_kaggle_csv

logger = logging.getLogger(__name__)

_EXAMPLE_BLOCK = re.compile(r"Input:\s*(?P<input>.+?)\s*Output:\s*(?P<output>.+?)(?=\n\s*\n|\s*Explanation:|\s*\*\*Example|\s*Example\s*\d|\Z)", re.S)
_ARG_SPLIT = re.compile(r",\s*(?=[A-Za-z_]\w*\s*=)")
_ARG = re.compile(r"^\s*([A-Za-z_]\w*)\s*=\s*(.+?)\s*$", re.S)
# Inputs a plain function cannot take as JSON (linked lists, trees, nodes, custom classes).
_STRUCTURED = re.compile(r"\b(ListNode|TreeNode|Node\b|NestedInteger|Interval|binary (search )?tree|n-ary tree|linked list|doubly linked)\b", re.I)
_STRUCTURED_ARGS = {"root", "head", "node", "list1", "list2", "l1", "l2", "lists", "p", "q"}


@dataclass(frozen=True)
class SourceExample:
    args: dict
    expected: object


@dataclass(frozen=True)
class SourceStatement:
    title: str
    description: str
    examples: list[SourceExample]


def _literal(text: str):
    """A value as written in an example: JSON, or a Python literal (single quotes, True/False/None)."""
    text = text.strip().strip("`").strip()
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass
    try:
        return ast.literal_eval(re.sub(r"\bnull\b", "None", re.sub(r"\btrue\b", "True", re.sub(r"\bfalse\b", "False", text))))
    except (ValueError, SyntaxError):
        raise ValueError(f"cannot read value {text[:60]!r}") from None


def parse_examples(description: str, limit: int = 2) -> list[SourceExample]:
    """The first `limit` runnable examples in a statement, or [] when it cannot be read reliably.
    Examples built on nodes/trees, or without named arguments, are skipped (the generator falls back)."""
    if not description or _STRUCTURED.search(description):
        return []
    out: list[SourceExample] = []
    for block in _EXAMPLE_BLOCK.finditer(description.replace("\r", "")):
        try:
            args: dict = {}
            for part in _ARG_SPLIT.split(block["input"].strip().strip("`")):
                m = _ARG.match(part)
                if not m:
                    raise ValueError("unnamed argument")
                args[m[1]] = _literal(m[2])
            out.append(SourceExample(args=args, expected=_literal(block["output"].splitlines()[0])))
        except ValueError:
            continue
        if len(out) == limit:
            break
    # Keep a consistent signature: every example must name the same parameters, none of them a node/tree handle.
    if len(out) != limit or len({tuple(e.args) for e in out}) != 1 or _STRUCTURED_ARGS & set(out[0].args):
        return []
    return out


def parse_statements(csv_text: str) -> dict[str, SourceStatement]:
    """{leetcode slug: SourceStatement} for every row that has a statement with two readable examples."""
    out: dict[str, SourceStatement] = {}
    for row in csv.DictReader(io.StringIO(csv_text)):
        slug = leetcode_slug(row.get("url"))
        description = (row.get("description") or "").strip()
        if not slug or not description:
            continue
        examples = parse_examples(description)
        if examples:
            out[slug] = SourceStatement(title=(row.get("title") or slug).strip(), description=description, examples=examples)
    return out


async def load_source_statements(settings) -> dict[str, SourceStatement]:
    """Fail-safe: an unreachable dataset yields {} and the generator uses its no-source path."""
    try:
        text = await fetch_kaggle_csv(settings)
    except Exception as exc:  # noqa: BLE001
        logger.warning("[questions] source statements unavailable: %s", exc)
        return {}
    if not text:
        return {}
    statements = parse_statements(text)
    logger.info("[questions] source statements with two readable examples: %d", len(statements))
    return statements
