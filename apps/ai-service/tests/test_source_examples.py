"""Reading worked examples out of source statements (docs/question-bank.md)."""
from app.questions.content.source_examples import parse_examples, parse_statements

TWO_SUM = """Given an array of integers `nums` and an integer `target`, return indices of the two numbers.

**Example 1:**

```
Input: nums = [2,7,11,15], target = 9
Output: [0,1]
Explanation: Because nums[0] + nums[1] == 9, we return [0, 1].
```

**Example 2:**

```
Input: nums = [3,2,4], target = 6
Output: [1,2]
```
"""


def test_two_named_examples_become_args_and_expected_values():
    examples = parse_examples(TWO_SUM)
    assert [(e.args, e.expected) for e in examples] == [({"nums": [2, 7, 11, 15], "target": 9}, [0, 1]), ({"nums": [3, 2, 4], "target": 6}, [1, 2])]


def test_strings_booleans_and_empty_values_parse():
    text = "Example 1:\nInput: s = \"anagram\", t = \"nagaram\"\nOutput: true\n\nExample 2:\nInput: s = \"rat\", t = \"car\"\nOutput: false\n"
    assert [(e.args, e.expected) for e in parse_examples(text)] == [({"s": "anagram", "t": "nagaram"}, True), ({"s": "rat", "t": "car"}, False)]
    empty = "Example 1:\nInput: nums = [-1,0,1]\nOutput: [[-1,0,1]]\n\nExample 2:\nInput: nums = []\nOutput: []\n"
    assert parse_examples(empty)[1].args == {"nums": []} and parse_examples(empty)[1].expected == []


def test_unreadable_examples_fall_back_to_nothing():
    assert parse_examples("Given the root of a binary tree, return its depth.\nExample 1:\nInput: root = [3,9,20]\nOutput: 2\nExample 2:\nInput: root = [1]\nOutput: 1") == []  # TreeNode problems
    assert parse_examples("Example 1:\nInput: 5\nOutput: 3\nExample 2:\nInput: 7\nOutput: 4") == []  # unnamed arguments
    assert parse_examples("Example 1:\nInput: n = 5\nOutput: 3\nExample 2:\nInput: m = 7\nOutput: 4") == []  # inconsistent parameters
    assert parse_examples("Example 1:\nInput: n = 5\nOutput: 3") == []  # only one example
    assert parse_examples("") == []


def test_statements_are_keyed_by_leetcode_slug():
    csv_text = "id,title,description,url\n1,Two Sum,\"" + TWO_SUM.replace('"', '""') + "\",https://leetcode.com/problems/two-sum\n2,Locked,,https://leetcode.com/problems/locked\n"
    assert list(parse_statements(csv_text)) == ["two-sum"]
