"""The panel beside the phone, and the one thing it must never do: show a raw code.

The panel's whole value is that it is the real audit trail rather than a narration. That only works
if every event the merchant flow can produce has been given words. An untranslated row is not a
cosmetic problem: it is the moment a judge reads `checkout_authority_consumed` off the screen and
the panel stops looking like a product.
"""

from __future__ import annotations

import re
from pathlib import Path

import pytest

from api.merchant_events import known_kinds, rank, translate

MERCHANT_SOURCES = (
    Path("api/routes/merchant.py"),
    Path("api/routes/paytm.py"),
)


def emitted_kinds() -> set[str]:
    """Every `event_kind` the merchant flow writes, read out of the source rather than listed."""

    found: set[str] = set()
    for path in MERCHANT_SOURCES:
        source = path.read_text(encoding="utf8")
        found.update(re.findall(r'event_kind="([a-z_]+)"', source))
        # The Paytm adapter passes its kind positionally to a helper, so matching only the
        # keyword form quietly saw four kinds out of fourteen. A guard that under-detects is
        # worse than no guard, because it reports success for the cases it never looked at.
        found.update(re.findall(r'_audit\(\s*session,\s*[^,]+,\s*"([a-z_]+)"', source))
    return found


def test_every_event_the_merchant_flow_writes_has_plain_english() -> None:
    untranslated = sorted(emitted_kinds() - known_kinds())
    assert not untranslated, f"these would appear as raw codes on the panel: {untranslated}"


def test_the_flow_actually_emits_something() -> None:
    """Guards the test above from passing because the regex found nothing."""

    assert len(emitted_kinds()) >= 10, sorted(emitted_kinds())


@pytest.mark.parametrize("kind", sorted(known_kinds()))
def test_no_title_leaks_a_placeholder(kind: str) -> None:
    """A missing payload key must not print `{braces}` at a judge."""

    event = translate(__import__("uuid").uuid4(), "10:42:11", kind, {}, None)
    assert event is None or "{" not in event.title


def test_the_gate_is_reported_before_the_verdict() -> None:
    """Discarding the fields has to read before the refusal, or the story runs backwards."""

    proposed = rank("planner_line_proposed", {"position": 0})
    discarded = rank("planner_fields_discarded", {"position": 0})
    stopped = rank("line_stopped", {"position": 0})
    assert proposed < discarded < stopped


def test_lines_keep_their_order_within_one_transaction() -> None:
    """Events share a timestamp, so position is what keeps line one ahead of line two."""

    first = rank("planner_line_proposed", {"position": 0})
    second = rank("planner_line_proposed", {"position": 1})
    assert first < second


def test_a_refusal_is_explained_in_words_not_codes() -> None:
    event = translate(
        __import__("uuid").uuid4(),
        "10:42:11",
        "line_stopped",
        {"reason": "QUANTITY_EXCEEDS_LIMIT"},
        None,
    )
    assert event is not None
    assert "QUANTITY_EXCEEDS_LIMIT" not in event.title
    assert event.tone == "stop"
