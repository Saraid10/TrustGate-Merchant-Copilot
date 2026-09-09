## What changed, and why it was wrong before

<!-- The second half matters more than the first. -->

## The regression that fails without this

<!--
Name the test. Not a test that exercises the new code - one that goes red if this change is
reverted. If there isn't one, say why not; sometimes there is a good reason, and it is worth
writing down rather than leaving as an absence.
-->

## Checks

- [ ] `make verify` passes — `ruff check`, `ruff format --check`, `mypy`, `alembic check`, the
      suite, and the mutation runner
- [ ] Any invariant about money is enforced in the database where it could be, not only in Python
- [ ] `alembic check` reports no undeclared model drift
- [ ] Counts stated in documentation still match what they count (`tests/test_stated_figures.py`)
- [ ] Generated tables regenerated with `python -m scenarios.report` rather than hand-edited
- [ ] No co-authorship or generated-by trailer in the commit messages

## Decisions

<!--
If this reverses something in docs/decision-log.md, link that entry and say what changed. A new
entry is better than quietly replacing the old reasoning - the log is useful precisely because it
records what was rejected and why.

If it narrows or widens what the project defends against, docs/limitations.md needs to say so. A
gap that is stated is a design decision; a gap that is not is a surprise.
-->
