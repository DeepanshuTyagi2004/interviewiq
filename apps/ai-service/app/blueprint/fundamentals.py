"""CS-fundamentals and language questions for rounds whose description names them ("OOP, DBMS basics", "Java,
SQL", "core subjects"). The bank holds what was asked as problems; these are the short conceptual questions
Indian technical and HR-technical rounds ask around them. Curated with expected answers, so the round questions a
blueprint asks on these topics are correct by construction. PRODUCT IP draft: review before production use.

band: "early" suits interns, freshers and SDE-1s; "mid" adds depth for SDE-2 and above.
"""
from __future__ import annotations

import hashlib
import random
import re

FUNDAMENTALS: list[dict] = [
    # ---------------------------------------------------------------- OOP
    {"id": "oop-pillars", "topic": "oop", "band": "early",
     "question": "What are the four pillars of object-oriented programming? Give an example of each from code you have written.",
     "expected": "Encapsulation (state hidden behind methods that keep it valid), abstraction (callers see what an object does, not how), "
                 "inheritance (a subtype reuses and extends a base type, an is-a relation) and polymorphism (one interface, many "
                 "implementations: overriding resolved at runtime, overloading at compile time). Examples should come from real code."},
    {"id": "oop-abstract-vs-interface", "topic": "oop", "band": "early",
     "question": "When would you use an abstract class rather than an interface?",
     "expected": "An abstract class can hold state, constructors and partly implemented behaviour, and a class extends only one; an "
                 "interface is a contract a class can implement many of (Java 8+ allows default methods but no instance state). Use an "
                 "interface for a capability several unrelated types share, an abstract class for a common base with shared code."},
    {"id": "oop-overload-override", "topic": "oop", "band": "early",
     "question": "What is the difference between method overloading and method overriding?",
     "expected": "Overloading: same name, different parameter lists, in the same class; chosen at compile time. Overriding: a subclass "
                 "redefines an inherited method with the same signature; chosen at runtime by the object's actual type (dynamic "
                 "dispatch). Static methods are hidden, not overridden."},
    {"id": "oop-composition", "topic": "oop", "band": "early",
     "question": "Why do people say \"prefer composition over inheritance\"? When is inheritance still the right choice?",
     "expected": "Composition (has-a) keeps classes loosely coupled, swaps behaviour at runtime and avoids fragile base classes and deep "
                 "hierarchies. Inheritance fits a true is-a relation where the subtype can stand in for the base everywhere (Liskov "
                 "substitution)."},
    {"id": "oop-solid", "topic": "oop", "band": "early",
     "question": "Explain the single-responsibility and open/closed principles with an example.",
     "expected": "Single responsibility: a class has one reason to change (e.g. separate an invoice's calculation from its PDF export). "
                 "Open/closed: add behaviour by extending, not editing, tested code, typically through an interface (e.g. a new payment "
                 "method as a new strategy class)."},
    {"id": "oop-encapsulation", "topic": "oop", "band": "early",
     "question": "Why keep fields private and expose methods instead of making the fields public?",
     "expected": "Methods can validate and keep invariants (a balance never negative), the internal representation can change without "
                 "breaking callers, and access can be controlled or made thread-safe in one place."},
    # ---------------------------------------------------------------- DBMS
    {"id": "dbms-normalization", "topic": "dbms", "band": "early",
     "question": "What do 1NF, 2NF and 3NF mean? When would you denormalize?",
     "expected": "1NF: atomic values, no repeating groups. 2NF: 1NF and no non-key column depends on only part of a composite key. 3NF: "
                 "2NF and no non-key column depends on another non-key column (no transitive dependency). Denormalize deliberately for "
                 "read-heavy paths, accepting duplicated data that must be kept in sync."},
    {"id": "dbms-acid", "topic": "dbms", "band": "early",
     "question": "What does ACID stand for? Give an example where each property matters.",
     "expected": "Atomicity: all of a transaction or none (a transfer debits and credits together). Consistency: constraints hold "
                 "after every transaction. Isolation: concurrent transactions don't see each other's partial work. Durability: once "
                 "committed it survives a crash (write-ahead log)."},
    {"id": "dbms-index", "topic": "dbms", "band": "early",
     "question": "How does a database index speed up a query, and what does it cost?",
     "expected": "A B-tree index finds rows in O(log n) instead of scanning the table and serves range scans and ordering. It costs "
                 "storage and slows inserts, updates and deletes. It helps little on tiny tables or low-selectivity columns; in a "
                 "composite index the leftmost columns must be used for it to apply."},
    {"id": "dbms-keys", "topic": "dbms", "band": "early",
     "question": "What is the difference between a primary key, a unique key and a foreign key?",
     "expected": "Primary key: unique, not null, identifies the row (one per table). Unique key: no duplicate values, may allow null. "
                 "Foreign key: a column referencing another table's key, enforcing referential integrity (with ON DELETE rules)."},
    {"id": "dbms-isolation", "topic": "dbms", "band": "mid",
     "question": "Walk me through the transaction isolation levels and the anomalies each one allows.",
     "expected": "Read uncommitted allows dirty reads; read committed prevents them but allows non-repeatable reads; repeatable read "
                 "prevents those but the SQL standard still allows phantoms (MySQL InnoDB blocks most with next-key locks); "
                 "serializable behaves as if transactions ran one at a time. Higher levels cost concurrency."},
    {"id": "dbms-sql-nosql", "topic": "dbms", "band": "early",
     "question": "How would you choose between a relational database and a NoSQL store for a feature?",
     "expected": "Relational: structured data, joins, transactions and constraints (orders, payments). NoSQL: flexible or nested "
                 "documents, very high write volume or simple key access that must scale horizontally (sessions, events, catalogs). "
                 "The access patterns decide, not fashion."},
    # ---------------------------------------------------------------- SQL
    {"id": "sql-joins", "topic": "sql", "band": "early",
     "question": "Explain inner, left, right and full outer joins. When would you use a left join?",
     "expected": "Inner: only rows matching in both tables. Left: every row of the left table, with NULLs where the right has no match "
                 "(right is the mirror). Full outer: every row of both. Use a left join to keep all parents even without children, "
                 "e.g. customers with or without orders."},
    {"id": "sql-second-highest", "topic": "sql", "band": "early",
     "question": "Write a query for the second-highest salary in an employees table.",
     "expected": "SELECT MAX(salary) FROM employees WHERE salary < (SELECT MAX(salary) FROM employees); or DENSE_RANK() over salary "
                 "descending and pick rank 2. Ties should count once, and the query returns NULL when there is no second salary."},
    {"id": "sql-where-having", "topic": "sql", "band": "early",
     "question": "What is the difference between WHERE and HAVING? Find customers with more than five orders.",
     "expected": "WHERE filters rows before grouping; HAVING filters groups after aggregation. SELECT customer_id, COUNT(*) FROM orders "
                 "GROUP BY customer_id HAVING COUNT(*) > 5;"},
    {"id": "sql-top-n-per-group", "topic": "sql", "band": "early",
     "question": "Find the top three earners in each department.",
     "expected": "Rank inside each department with a window function: ROW_NUMBER() (or DENSE_RANK() to keep ties) OVER (PARTITION BY "
                 "department_id ORDER BY salary DESC) in a subquery or CTE, then keep rank <= 3."},
    {"id": "sql-anti-join", "topic": "sql", "band": "early",
     "question": "List the customers who have never placed an order.",
     "expected": "LEFT JOIN orders ON the customer id and keep rows WHERE orders.id IS NULL, or use NOT EXISTS. NOT IN misbehaves when "
                 "the subquery can return NULL."},
    {"id": "sql-dedupe", "topic": "sql", "band": "early",
     "question": "A table has duplicate rows. How would you delete the duplicates and keep one of each?",
     "expected": "Number rows with ROW_NUMBER() OVER (PARTITION BY the duplicated columns ORDER BY id) and delete those with a number "
                 "above 1 (or a self-join deleting the row with the larger id). Then add a unique constraint so it can't recur."},
    # ---------------------------------------------------------------- Operating systems
    {"id": "os-process-thread", "topic": "os", "band": "early",
     "question": "What is the difference between a process and a thread?",
     "expected": "A process has its own address space and resources; threads of one process share memory and file handles. Threads "
                 "are cheaper to create and switch, but shared memory needs synchronization, and one thread crashing can take down "
                 "the process."},
    {"id": "os-deadlock", "topic": "os", "band": "early",
     "question": "What is a deadlock, and how do you prevent one?",
     "expected": "Threads each hold a resource while waiting for another's. It needs all four Coffman conditions: mutual exclusion, hold "
                 "and wait, no preemption, circular wait. Break one, most often circular wait by acquiring locks in a fixed global "
                 "order; or use lock timeouts, or detect and recover."},
    {"id": "os-mutex-semaphore", "topic": "os", "band": "early",
     "question": "What is the difference between a mutex and a semaphore?",
     "expected": "A mutex gives one thread exclusive access and is released by the thread that holds it. A semaphore is a counter that "
                 "lets up to N threads in (for example, a pool of N connections) and can be signalled by another thread."},
    {"id": "os-virtual-memory", "topic": "os", "band": "early",
     "question": "What is virtual memory, and what happens on a page fault?",
     "expected": "Each process sees its own address space, mapped to physical frames by page tables (the TLB caches translations). On a "
                 "page fault the OS loads the missing page from disk or allocates it, evicting another if memory is full, then "
                 "resumes the instruction. It isolates processes and lets memory be overcommitted."},
    {"id": "os-race", "topic": "os", "band": "early",
     "question": "Two threads increment the same counter a million times each, and the result is less than two million. Why, and how do you fix it?",
     "expected": "Increment is read-modify-write, so updates interleave and some are lost (a race condition). Fix it with a lock around "
                 "the increment or an atomic counter (AtomicInteger, atomic operations)."},
    # ---------------------------------------------------------------- Networks
    {"id": "cn-tcp-udp", "topic": "networks", "band": "early",
     "question": "What is the difference between TCP and UDP? Where would you use each?",
     "expected": "TCP is connection-oriented, with reliable, ordered delivery, retransmission and flow and congestion control "
                 "(web, APIs, file transfer). UDP sends independent datagrams with no delivery or order guarantee and less overhead "
                 "(live video, voice, games, DNS)."},
    {"id": "cn-url", "topic": "networks", "band": "early",
     "question": "What happens when you type a URL into the browser and press enter?",
     "expected": "DNS resolves the host to an IP (cached at several levels), a TCP connection opens (and a TLS handshake for HTTPS), the "
                 "browser sends the HTTP request, the server (often through a load balancer) responds, and the browser parses HTML, "
                 "fetches CSS, JS and images, and renders."},
    {"id": "cn-http", "topic": "networks", "band": "early",
     "question": "Which HTTP methods are idempotent, and what do 401, 403, 404 and 429 mean?",
     "expected": "GET, PUT and DELETE are idempotent (repeating them has the same effect); POST is not. 401: not authenticated; 403: "
                 "authenticated but not allowed; 404: not found; 429: rate limited (too many requests)."},
    {"id": "cn-https", "topic": "networks", "band": "early",
     "question": "How does HTTPS keep data safe?",
     "expected": "TLS verifies the server's certificate through a chain of trusted authorities, a key exchange agrees a symmetric "
                 "session key, and traffic is then encrypted and integrity-protected, so it can't be read or altered in transit."},
    # ---------------------------------------------------------------- Java
    {"id": "java-jdk-jre-jvm", "topic": "java", "band": "early",
     "question": "What is the difference between the JDK, the JRE and the JVM?",
     "expected": "The JVM runs bytecode (interpreting and JIT-compiling it); the JRE is the JVM plus the standard libraries needed to "
                 "run programs; the JDK is the JRE plus the compiler and developer tools."},
    {"id": "java-hashmap", "topic": "java", "band": "early",
     "question": "How does a HashMap work internally?",
     "expected": "An array of buckets: hashCode() picks the bucket, equals() finds the key inside it. Collisions chain in a list, which "
                 "becomes a balanced tree past eight entries (Java 8+). It resizes (doubles) past the 0.75 load factor. Gets and puts "
                 "are O(1) on average; it is not thread-safe (use ConcurrentHashMap)."},
    {"id": "java-equals-hashcode", "topic": "java", "band": "early",
     "question": "Why must equals() and hashCode() be overridden together?",
     "expected": "Equal objects must have equal hash codes. If only equals() is overridden, two equal objects land in different buckets "
                 "and HashMap or HashSet lookups miss them."},
    {"id": "java-string", "topic": "java", "band": "early",
     "question": "Why are Java strings immutable, and why use StringBuilder?",
     "expected": "Immutability makes strings safe to share across threads, lets them be cached in the string pool, keeps hash codes "
                 "stable for map keys and prevents tampering with values like file paths. Concatenating in a loop creates a new string "
                 "each time, so StringBuilder appends into one buffer instead."},
    {"id": "java-exceptions", "topic": "java", "band": "early",
     "question": "What is the difference between checked and unchecked exceptions?",
     "expected": "Checked exceptions (IOException) must be caught or declared, for recoverable conditions outside the program's control. "
                 "Unchecked ones (RuntimeException, e.g. NullPointerException) signal programming errors and need not be declared. "
                 "try-with-resources closes resources either way."},
    {"id": "java-gc", "topic": "java", "band": "early",
     "question": "How does garbage collection work in Java, and can a Java program still leak memory?",
     "expected": "Objects unreachable from GC roots (stacks, statics) are reclaimed; the heap is generational, with frequent minor "
                 "collections of the young generation and rarer major ones of the old. Leaks still happen when references linger: "
                 "growing static collections, unremoved listeners, caches without eviction."},
    {"id": "java-concurrency", "topic": "java", "band": "mid",
     "question": "What is the difference between synchronized, volatile and AtomicInteger?",
     "expected": "synchronized gives mutual exclusion and visibility for a block. volatile only guarantees visibility and ordering of a "
                 "single variable, not atomic compound actions. AtomicInteger offers lock-free atomic operations (compare-and-set) for "
                 "one value."},
    # ---------------------------------------------------------------- Python
    {"id": "py-list-tuple", "topic": "python", "band": "early",
     "question": "What is the difference between a list and a tuple in Python?",
     "expected": "Lists are mutable; tuples are immutable, so a tuple of hashable values can be a dict key or set member. Tuples suit "
                 "fixed records, lists growing collections."},
    {"id": "py-gil", "topic": "python", "band": "early",
     "question": "What is the GIL, and how does it affect threads?",
     "expected": "CPython's global interpreter lock lets one thread run Python bytecode at a time. Threads still help I/O-bound work "
                 "(the lock is released while waiting); CPU-bound work needs multiprocessing or native extensions."},
    {"id": "py-generators", "topic": "python", "band": "early",
     "question": "What is a generator, and when would you use one?",
     "expected": "A function that yields values lazily, one at a time, keeping its state between calls. It uses constant memory for "
                 "large or infinite sequences, such as streaming a large file line by line."},
    {"id": "py-default-arg", "topic": "python", "band": "early",
     "question": "What goes wrong with def add(item, items=[]):, and how do you fix it?",
     "expected": "The default list is created once and shared across calls, so items accumulate. Default to None and create a new list "
                 "inside the function."},
    {"id": "py-decorators", "topic": "python", "band": "early",
     "question": "What is a decorator? Give a real use.",
     "expected": "A function that takes a function and returns a wrapped one, applied with @. Uses: logging, timing, caching "
                 "(functools.lru_cache), authorization checks; functools.wraps keeps the original name and docstring."},
    # ---------------------------------------------------------------- JavaScript
    {"id": "js-event-loop", "topic": "javascript", "band": "early",
     "question": "Explain the JavaScript event loop. In what order do a setTimeout callback and a resolved promise's then() run?",
     "expected": "One call stack runs synchronous code; when it empties, all microtasks (promise callbacks) run, then the next "
                 "macrotask (timers, I/O). So the then() runs before the setTimeout callback, even with a 0 ms delay."},
    {"id": "js-closures", "topic": "javascript", "band": "early",
     "question": "What is a closure? Show where one is useful.",
     "expected": "A function keeps access to variables of the scope it was created in, even after that scope returns. Uses: private "
                 "state, function factories, callbacks that remember context; the classic var-in-a-loop bug is fixed by let."},
    {"id": "js-equality", "topic": "javascript", "band": "early",
     "question": "What is the difference between == and ===?",
     "expected": "== converts types before comparing (0 == '' is true); === compares type and value without conversion. Use ===."},
    {"id": "js-scope", "topic": "javascript", "band": "early",
     "question": "What is the difference between var, let and const?",
     "expected": "var is function-scoped and hoisted as undefined; let and const are block-scoped and in the temporal dead zone until "
                 "declared. const prevents re-binding, not mutation of the object it holds."},
    {"id": "js-async", "topic": "javascript", "band": "early",
     "question": "How do async/await and promises relate? How do you run three requests in parallel?",
     "expected": "async functions return promises and await pauses until one settles; errors are caught with try/catch. Start all three "
                 "and await Promise.all (rejects on the first failure) or Promise.allSettled (waits for all)."},
    # ---------------------------------------------------------------- React
    {"id": "react-reconciliation", "topic": "react", "band": "early",
     "question": "How does React decide what to update in the DOM?",
     "expected": "On each render React builds a new element tree, diffs it against the previous one (reconciliation) and applies only "
                 "the changes. Elements of a different type are replaced; list items are matched by key."},
    {"id": "react-keys", "topic": "react", "band": "early",
     "question": "Why do list items need keys, and why is the array index a poor key?",
     "expected": "Keys give items a stable identity between renders. With the index as key, reordering, inserting or deleting reuses "
                 "the wrong component, so state such as input values or focus ends up on the wrong item."},
    {"id": "react-useeffect", "topic": "react", "band": "early",
     "question": "How does the useEffect dependency array work, and what goes wrong when it's wrong?",
     "expected": "The effect runs after render and re-runs when a listed dependency changes; its cleanup runs before the next run and on "
                 "unmount. Missing dependencies read stale values; unstable ones (new objects each render) cause loops or extra runs."},
    {"id": "react-state-props", "topic": "react", "band": "early",
     "question": "What is the difference between state and props? When do you lift state up?",
     "expected": "Props come from the parent and are read-only; state is owned and changed by the component. Lift state to the closest "
                 "common parent when siblings need the same data."},
    {"id": "react-rerenders", "topic": "react", "band": "mid",
     "question": "A list re-renders on every keystroke and feels slow. How would you find and fix the cause?",
     "expected": "Profile with React DevTools; keep the input's state local instead of high in the tree; memoize rows with React.memo and "
                 "stable callbacks (useCallback) and values (useMemo); virtualize long lists."},
    # ---------------------------------------------------------------- Data modelling
    {"id": "dm-orders", "topic": "data-modelling", "band": "early",
     "question": "Design the tables for customers, products and orders in a shop. Where does the price go?",
     "expected": "customers, products, orders (customer_id, status, created_at) and order_items (order_id, product_id, quantity, "
                 "unit_price) with foreign keys and indexes on them. The price paid is copied into order_items, because the product's "
                 "price will change later."},
    {"id": "dm-many-to-many", "topic": "data-modelling", "band": "early",
     "question": "How do you model a many-to-many relation, such as students and courses?",
     "expected": "A junction table (enrollments: student_id, course_id, plus relation data such as grade) with a composite primary or "
                 "unique key on the pair and foreign keys to both tables."},
]

# Round text -> topics. "Core subjects" is the Indian campus shorthand for OOP, DBMS, OS and networks.
_TOPIC_PATTERNS = {
    "oop": r"\boops?\b|object[- ]oriented|core subjects",
    "dbms": r"\bdbms\b|databases?|normali[sz]ation|transactions?|core subjects",
    "sql": r"\bsql\b|\bjoins?\b|quer(?:y|ies)",
    "os": r"operating systems?|\bos\b|core subjects",
    "networks": r"computer networks?|networking|\bcn\b|core subjects",
    "java": r"\bjava\b(?!\s*script)",
    "python": r"\bpython\b",
    "javascript": r"javascript|\bnode(?:\.js)?\b",
    "react": r"\breact\b",
    "data-modelling": r"data ?model+ing|schema design",
}
_LANGUAGE_HINT = re.compile(r"programming (?:basics|language)|language of (?:your )?choice", re.I)
_LANGUAGES = ("java", "python", "javascript")


def topics_named(text: str, skills: list[str] | None = None) -> list[str]:
    """Fundamentals topics a round's text names, in a stable order. "Programming basics" picks the candidate's
    first known language from their skills."""
    found = [t for t, p in _TOPIC_PATTERNS.items() if re.search(p, text or "", re.I)]
    if _LANGUAGE_HINT.search(text or "") and not any(t in found for t in _LANGUAGES):
        own = {s.strip().lower() for s in skills or []}
        lang = next((lang for lang in _LANGUAGES if lang in own or (lang == "javascript" and "typescript" in own)), None)
        if lang:
            found.append(lang)
    return found


def pool(topics: list[str], level: str, seed: str, per_topic: int = 2, limit: int = 10) -> list[dict]:
    """A reproducible sample of up to `per_topic` questions per named topic, early-band first for junior levels."""
    junior = level in ("intern", "fresher", "sde1")
    rng = random.Random(int(hashlib.sha256(f"fundamentals:{seed}".encode()).hexdigest()[:16], 16))
    out: list[dict] = []
    for topic in topics:
        items = [q for q in FUNDAMENTALS if q["topic"] == topic and (q["band"] == "early" or not junior)]
        rng.shuffle(items)
        out += [{k: q[k] for k in ("id", "topic", "question", "expected")} for q in items[:per_topic]]
    return out[:limit]
