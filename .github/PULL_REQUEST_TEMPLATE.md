<!--
Delete Decisions or Out of scope when there is nothing to say. Why, What and Verified stay.
-->

## Why

<!--
What is wrong or missing today, and its source: a conversation, an issue, a commit.
If the reason has no source, do not invent one.
-->

## What

<!--
What is different after merge, as seen by the user or by the rest of the system. Largest change first.
If the behavior differs by condition or input, use a before/after table.
Leave out what the diff already says: changed files, "added X", "refactored Y".
-->

## Decisions

<!--
Choices a reviewer could question, and why they were made that way.
Alternatives tried or considered, and why they were rejected.
Side effects that are hard to see in the diff.
-->

## Verified

<!--
Only what was actually run, with the result:

- `npm test` (93 passed), `npm run typecheck`
- Judged the same 19 bookmarks four times; borderline articles stayed in their section

If nothing was run, say so. Say what was not checked when a reviewer would expect it.

When tests are added, list them under "Tests added", one line per test, saying what it checks.
The `it(...)` description works as is:

Tests added:

- rejects a config whose `top` is not a positive integer
- lists an adjacent article under Related, not under Helps
-->

## Out of scope

<!--
What was left undone on purpose, and known limits of the change.
-->
