"""Every present-tense figure in the documentation, checked against the thing it counts.

An external review found four drifted numbers in one pass: `docs/positioning.md` claimed 18
deliberate breaks against an actual 53, `docs/architecture.md` claimed 574 tests and 56 source
files, and `demo/pitch.md` claimed 593 tests. None was wrong when written. All four went stale
silently, and the two test counts sat in the two artifacts most likely to be read side by side.

That matters more here than it would elsewhere. The argument this project makes is that its claims
are verified rather than asserted, so a reader who checks one number and finds it wrong has been
handed a reason to stop checking the rest.

Past-tense figures are deliberately not covered. "302 tests passed with the check removed" is a
statement about an afternoon in August, and it stays true however many tests exist now.
"""

from __future__ import annotations

import re
import subprocess
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent

# Read by outsiders, so these are the ones whose figures have to hold. Files under docs/buildathon/
# are a submitted record and are excluded on purpose: they say what was claimed on the day.
PUBLIC_DOCS = (
    "README.md",
    "JUDGE.md",
    "demo/pitch.md",
    "docs/architecture.md",
    "docs/positioning.md",
    "docs/limitations.md",
    "docs/build-plan.md",
    "docs/decision-log.md",
    "docs/threat-model.md",
)


def _docs() -> dict[str, str]:
    found = {}
    for name in PUBLIC_DOCS:
        path = REPO_ROOT / name
        if path.is_file():
            found[name] = path.read_text(encoding="utf-8")
    return found


def _claims(pattern: str) -> list[tuple[str, int]]:
    """Every (document, number) a present-tense claim of `pattern` makes."""

    return [
        (name, int(match)) for name, text in _docs().items() for match in re.findall(pattern, text)
    ]


def test_every_stated_mutation_count_matches_the_registry() -> None:
    from scenarios.mutation import MUTATIONS

    claims = _claims(r"(\d+) (?:deliberate breaks|mutations|safety guards)")

    assert claims, "no document states how many mutations there are"
    wrong = [(doc, n) for doc, n in claims if n != len(MUTATIONS)]
    assert not wrong, f"the registry holds {len(MUTATIONS)}; these disagree: {wrong}"


def test_every_stated_scenario_count_matches_the_registry() -> None:
    from scenarios.tier_a import REGISTRY

    wrong = [(d, n) for d, n in _claims(r"(\d+) adversarial scenarios") if n != len(REGISTRY)]
    assert not wrong, f"the registry holds {len(REGISTRY)}; these disagree: {wrong}"


def test_every_stated_migration_count_matches_the_directory() -> None:
    on_disk = len(list((REPO_ROOT / "alembic" / "versions").glob("*.py")))

    wrong = [(d, n) for d, n in _claims(r"(\d+) migrations") if n != on_disk]
    assert not wrong, f"{on_disk} migrations exist; these disagree: {wrong}"


def test_the_documents_agree_with_each_other_about_the_test_count() -> None:
    """Present tense only. "302 tests passed" is history and stays true.

    Checked against each other and against the definitions on disk rather than by running pytest,
    because this is itself a test and asking pytest for its own count from inside a run is circular.
    """

    claims = _claims(r"(\d+) tests(?: passing| ·)")

    assert claims, "no document states how many tests there are"
    stated = {n for _, n in claims}
    assert len(stated) == 1, f"documents disagree about the test count: {sorted(claims)}"

    defined = sum(
        len(re.findall(r"^(?:async )?def test_", path.read_text(encoding="utf-8"), re.MULTILINE))
        for path in (REPO_ROOT / "tests").glob("test_*.py")
    )
    # Parametrised tests expand at collection, so the collected figure is the larger one. What must
    # not happen is the documents drifting *below* what is on disk, which is the direction that
    # makes the project look smaller than it is.
    assert stated.pop() >= defined, (
        f"the documents say {claims[0][1]} tests, but {defined} test functions are defined"
    )


def test_the_stated_source_file_count_matches_what_mypy_checks() -> None:
    """`mypy` with no arguments is what `make verify` runs, so it is the number to quote."""

    claims = _claims(r"(\d+) source files")
    if not claims:
        return

    result = subprocess.run(  # noqa: S603
        [sys.executable, "-m", "mypy"], capture_output=True, text=True, cwd=REPO_ROOT
    )
    found = re.search(
        r"checked (\d+) source files|no issues found in (\d+) source files", result.stdout
    )
    assert found, f"could not read a file count out of mypy: {result.stdout[-200:]}"
    actual = int(found.group(1) or found.group(2))

    wrong = [(d, n) for d, n in claims if n != actual]
    assert not wrong, f"mypy checks {actual} source files; these disagree: {wrong}"
