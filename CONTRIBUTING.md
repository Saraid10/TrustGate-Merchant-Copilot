# Contributing

This is a single-author project built to answer one question — what an AI buying agent is
*structurally incapable* of doing — so it is not looking for feature contributions the way a
library would. What it is very much open to is being shown wrong.

The most valuable thing anyone can send is **a case that fails**: a scenario the design does not
handle, a claim in the documentation the code does not support, or a test that passes while proving
less than it says. That is the thesis of the whole repository, so a report that dents it is worth
more than a feature.

## Running it

```bash
git clone https://github.com/Saraid10/Trustgate.git
cd Trustgate
python -m venv .venv
.venv/bin/pip install -e ".[dev]"      # .venv\Scripts\pip on Windows
docker compose up -d
python -m alembic upgrade head
python -m pytest
```

If you have four minutes rather than an afternoon, [`JUDGE.md`](JUDGE.md) maps each claim in the
README to the single command that proves it, and `make triage` is a guided tour whose first two
steps need no database, no Docker and no credentials.

On Windows, use `127.0.0.1` rather than `localhost` in `DATABASE_URL`. `localhost` resolves to IPv6
`::1` first, Compose publishes the database on IPv4 only, and psycopg's async connect **hangs** on
the dead address instead of failing over to it. Alembic connects fine over its sync driver, which
makes the database look reachable and the hang look like a slow test. That one cost an afternoon.

## The bar for a change

`make verify` has to pass. It runs `ruff check`, `ruff format --check`, `mypy` (strict, no
arguments), `alembic check`, the full suite, and the mutation runner — and it stops at the first
step that fails rather than reporting a summary at the end.

Beyond that, three things are specific to this project, and they are the reason it argues what it
argues.

**A fix comes with a regression that fails without it.** Not a test that exercises the new code — a
test that goes red if the fix is reverted. The difference is the entire point of the mutation
suite, which deletes each safety guard in turn and requires the test named as its guard to fail.

**An invariant about money belongs in the database where it can.** A rule enforced in Python is a
rule a different query walks around. Triggers, check constraints and partial unique indexes are
preferred, and `alembic check` must report no undeclared model drift.

**A number in a document is a claim.** `tests/test_stated_figures.py` checks the present-tense
figures in the public documents against the registries, the migrations directory and mypy's own
file count, so a stale number fails the suite rather than sitting there. If you change a count,
that test will tell you everywhere else it is written down.

## Adding an adversarial scenario

The 16 Tier A scenarios in `scenarios/tier_a.py` are the registry the README's attack matrix is
generated from, and `tests/test_scenarios_tier_a.py` asserts the two match — so the documentation
cannot claim an attack that no passing test covers. Regenerate the tables with
`python -m scenarios.report` and paste between the markers, rather than editing the README by hand.

A new scenario needs an entry in the registry and a test that exercises it. If it demonstrates
something the project does not currently defend against, say so in
[`docs/limitations.md`](docs/limitations.md) too — a gap that is stated is a design decision, and a
gap that is not is a surprise.

## Commit messages

Written as sentences, saying what changed and **why it was wrong before**. The existing history is
the reference. What is deliberately not in them: any co-authorship or generated-by trailer.

## Design decisions

Every non-obvious choice has an entry in [`docs/decision-log.md`](docs/decision-log.md) with the
alternatives that were considered and rejected. If a change reverses one of those, that entry is
where to argue with it — and the new entry should say what changed, rather than quietly replacing
the old reasoning.

## Security

Do not open a public issue for something exploitable. [`SECURITY.md`](SECURITY.md) says where it
goes, and what is already known to be missing — the authentication gap in particular is documented,
not undiscovered.
