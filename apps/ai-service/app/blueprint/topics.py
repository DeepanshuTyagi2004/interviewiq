"""Canonical topic dictionary for problem selection (spec §7.2). PRODUCT IP — draft for human review.

Brief topics are free text ("DP", "graphs & trees"), bank tags vary ("Dynamic Programming", "Depth-first
Search"), JD text mentions domains ("payments"). Everything is mapped onto canonical ids by whole-word
keyword match, so overlap is computed on one vocabulary. DSA ids match the API's JD-fit `DSA_TOPICS`.
"""
from __future__ import annotations

import re
from functools import lru_cache

# (id, kind, keywords). kind: dsa | design | behavioural
_ENTRIES: tuple[tuple[str, str, tuple[str, ...]], ...] = (
    # ---- DSA (aligned with apps/api/src/domain/jdFit/vocabulary.ts DSA_TOPICS) ----
    ("arrays", "dsa", ("array", "arrays", "matrix", "prefix sum", "prefix sums", "subarray", "subarrays")),
    ("strings", "dsa", ("string", "strings", "string matching", "kmp", "palindrome", "palindromes", "anagram", "anagrams")),
    ("hashing", "dsa", ("hash table", "hashing", "hash map", "hash maps", "hashmap", "hashmaps", "hash set", "counting")),
    ("two-pointers", "dsa", ("two pointers", "two pointer", "sliding window", "sliding windows")),
    ("sorting", "dsa", ("sorting", "sort", "merge sort", "quick sort", "quickselect", "bucket sort", "counting sort")),
    ("binary-search", "dsa", ("binary search", "binary search on answer")),
    ("linked-lists", "dsa", ("linked list", "linked lists", "linkedlist")),
    ("stacks-queues", "dsa", ("stack", "stacks", "queue", "queues", "monotonic stack", "monotonic queue", "deque")),
    ("heaps", "dsa", ("heap", "heaps", "heap (priority queue)", "priority queue", "priority queues", "top k")),
    ("trees", "dsa", ("tree", "trees", "binary tree", "binary trees", "binary search tree", "bst", "segment tree",
                      "fenwick tree", "binary indexed tree", "trie", "tries")),
    ("graphs", "dsa", ("graph", "graphs", "shortest path", "shortest paths", "dfs", "bfs", "depth-first search",
                       "breadth-first search", "topological sort", "union find", "dsu", "disjoint set",
                       "minimum spanning tree", "dijkstra", "multi-source bfs", "grid")),
    ("dynamic-programming", "dsa", ("dynamic programming", "dp", "memoization", "dp on subsequences", "knapsack", "tabulation")),
    ("greedy", "dsa", ("greedy", "greedy algorithms", "intervals", "interval scheduling")),
    ("backtracking", "dsa", ("backtracking", "recursion", "permutations", "combinations", "subsets")),
    ("bit-manipulation", "dsa", ("bit manipulation", "bitmask", "bitmasks", "bitwise", "xor")),
    ("math", "dsa", ("math", "maths", "number theory", "combinatorics", "probability", "geometry", "modular arithmetic")),
    ("design-ds", "dsa", ("design", "data structure design", "lru cache", "iterator", "ordered set")),
    # ---- system design / LLD (components, domains) ----
    ("payments", "design", ("payment", "payments", "ledger", "wallet", "upi", "billing", "transactions", "fintech")),
    ("messaging", "design", ("chat", "messaging", "whatsapp", "messenger", "real-time chat", "websocket", "websockets")),
    ("feed", "design", ("news feed", "feed", "timeline", "social network", "twitter", "instagram")),
    ("search-engine", "design", ("search engine", "search service", "full-text search", "typeahead", "autocomplete", "elasticsearch", "inverted index")),
    ("storage", "design", ("file storage", "storage", "dropbox", "google drive", "blob storage", "object storage", "s3")),
    ("rate-limiting", "design", ("rate limiter", "rate limiting", "throttling", "api gateway")),
    ("caching", "design", ("cache", "caching", "cdn", "redis", "memcached", "distributed cache")),
    ("url-shortener", "design", ("url shortener", "tinyurl", "short url", "bitly")),
    ("notifications", "design", ("notification", "notifications", "push notification", "email service", "sms")),
    ("booking", "design", ("booking", "reservation", "ticketing", "bookmyshow", "hotel", "movie ticket", "seat booking")),
    ("location", "design", ("ride hailing", "uber", "ola", "location", "geospatial", "maps", "delivery tracking", "food delivery")),
    ("streaming", "design", ("video streaming", "streaming", "youtube", "netflix", "live streaming", "media")),
    ("analytics", "design", ("analytics", "logging", "metrics", "monitoring", "event tracking", "clickstream")),
    ("ecommerce", "design", ("e-commerce", "ecommerce", "shopping cart", "cart", "inventory", "order management", "checkout", "catalog")),
    ("auth", "design", ("authentication", "authorization", "auth", "login", "oauth", "session management")),
    ("queues", "design", ("message queue", "kafka", "pub sub", "pub-sub", "event driven", "job scheduler", "task queue")),
    ("databases", "design", ("database", "databases", "sharding", "replication", "partitioning", "consistency", "sql", "nosql")),
    ("concurrency", "design", ("concurrency", "multithreading", "thread safe", "thread-safe", "locking", "parallel")),
    ("oop", "design", ("oop", "object oriented", "object-oriented", "solid", "design patterns", "low level design", "lld",
                       "machine coding")),
    ("games", "design", ("chess", "tic tac toe", "snake and ladder", "snakes and ladders", "game", "games", "board game")),
    ("parking", "design", ("parking lot", "parking", "elevator", "vending machine", "atm", "library management")),
    ("expense-sharing", "design", ("splitwise", "expense sharing", "split bills")),
    # ---- behavioural categories (bank `category` values) ----
    ("motivation", "behavioural", ("self-introduction", "tell me about yourself", "why this company", "motivation", "career goals")),
    ("conflict", "behavioural", ("conflict-teamwork", "conflict", "disagreement", "teamwork")),
    ("failure", "behavioural", ("failure-learning", "failure", "mistake", "setback")),
    ("ownership", "behavioural", ("leadership-ownership", "leadership", "ownership", "initiative")),
    ("strengths", "behavioural", ("strengths-weaknesses", "strengths", "weaknesses")),
    ("principles", "behavioural", ("amazon-lp", "leadership principles", "googleyness", "company values")),
)

TOPIC_IDS: tuple[str, ...] = tuple(e[0] for e in _ENTRIES)
KIND_OF: dict[str, str] = {e[0]: e[1] for e in _ENTRIES}


def _norm(text: str) -> str:
    text = text.lower().replace("&", " and ").replace("_", " ")
    return re.sub(r"\s+", " ", re.sub(r"[^a-z0-9+#\- ]+", " ", text)).strip()


@lru_cache(maxsize=1)
def _patterns() -> list[tuple[str, re.Pattern]]:
    out = []
    for topic_id, _kind, keywords in _ENTRIES:
        alternatives = sorted({_norm(k) for k in keywords} | {_norm(topic_id.replace("-", " "))}, key=len, reverse=True)
        out.append((topic_id, re.compile(r"(?<![a-z0-9])(?:" + "|".join(re.escape(a) for a in alternatives) + r")(?![a-z0-9])")))
    return out


def topics_in(text: str | None) -> set[str]:
    """Canonical topic ids mentioned anywhere in free text (whole-word, case-insensitive)."""
    if not text:
        return set()
    norm = _norm(text)
    return {topic_id for topic_id, pattern in _patterns() if pattern.search(norm)}


def canon(values) -> set[str]:
    """Canonical ids for a list of tags/topics (each value matched as text)."""
    out: set[str] = set()
    for value in values or []:
        if isinstance(value, str):
            out |= topics_in(value)
    return out


def overlap(problem_topics: set[str], target_topics: set[str]) -> float:
    """Overlap coefficient in [0, 1]: shared topics over the smaller set. A problem tagged with one
    topic that the round asks for scores 1.0; extra tags on either side don't dilute it."""
    if not problem_topics or not target_topics:
        return 0.0
    return len(problem_topics & target_topics) / min(len(problem_topics), len(target_topics))
