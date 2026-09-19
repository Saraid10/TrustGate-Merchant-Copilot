"""Turning the audit trail into something a person can read over someone's shoulder.

The panel beside the phone is not a narration of the demo. It is the same `audit_event` rows the
receipt and the console are assembled from, which is the only reason it is worth showing: a judge
can expand any row and see the record the server actually wrote.

So nothing here invents an event. This module only decides who an event is about, how alarming it
is, and what it says in plain English. Anything it cannot name is still shown, with its raw code,
because a silent gap in the trail would be a worse lie than an ugly label.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any
from uuid import UUID

from api.reason_text import humanise

Actor = str
Tone = str

# kind -> (actor, tone, title). The title may reference payload keys with {braces}.
_KINDS: dict[str, tuple[Actor, Tone, str]] = {
    "planner_line_proposed": ("ASSISTANT", "info", "Assistant proposed {name} x {quantity}"),
    "planner_fields_discarded": (
        "SERVER",
        "stop",
        "Discarded {discarded_names}. The purchase tool has no such fields.",
    ),
    "planner_fell_back": (
        "ASSISTANT",
        "warn",
        "The online assistant did not answer, so the offline planner was used.",
    ),
    "catalog_purchase_rejected": ("SERVER", "stop", "Stopped: {reason_words}"),
    "payment_request_rejected": ("SERVER", "stop", "Stopped: {reason_words}"),
    "human_approval_requested": ("SERVER", "warn", "This one needs the owner to decide."),
    "payment_transition": ("SERVER", "info", "Payment moved to {to_state}"),
    "checkout_authority_issued": (
        "SERVER",
        "info",
        "One-time payment authority issued for this exact purchase",
    ),
    "checkout_authority_consumed": ("SERVER", "info", "Payment authority used once and closed"),
    "checkout_authority_rejected": ("SERVER", "stop", "Checkout refused: {reason_words}"),
    "paytm_order_created": ("PAYTM", "info", "Paytm order created for {amount_words}"),
    "paytm_callback_verified": (
        "PAYTM",
        "info",
        "Browser callback received and verified. Treated as a hint, not as proof.",
    ),
    "paytm_callback_rejected": ("PAYTM", "stop", "Browser callback failed its checksum. Ignored."),
    "paytm_status_pending": ("SERVER", "warn", "Paytm has not confirmed yet, so this is not paid."),
    "paytm_status_confirmed": ("SERVER", "good", "Paytm confirmed {amount_words}. Marked paid."),
    "paytm_payment_failed": ("PAYTM", "stop", "Paytm reports the payment failed. Nothing charged."),
    "paytm_amount_mismatch": (
        "SERVER",
        "stop",
        "Paytm reported a different amount than the server derived. Held for review.",
    ),
    "line_stopped": ("SERVER", "stop", "Stopped: {reason_words}"),
    "store_reset": ("OWNER", "info", "Store reset to its morning state"),
}

# Within one transaction every row shares `created_at`, because Postgres `now()` is transaction
# start time. Ties would then break on a random UUID and the panel would read out of order, so the
# logical sequence is stated here: the assistant speaks, the gate acts, the server decides.
_RANK: dict[str, int] = {
    "planner_fell_back": 0,
    "planner_line_proposed": 1,
    "planner_fields_discarded": 2,
    "line_stopped": 3,
    "catalog_purchase_rejected": 3,
    "payment_request_rejected": 3,
    "human_approval_requested": 4,
    "payment_transition": 5,
    "checkout_authority_issued": 6,
    "checkout_authority_consumed": 7,
    "paytm_order_created": 8,
    "paytm_callback_verified": 9,
    "paytm_callback_rejected": 9,
    "paytm_status_pending": 10,
    "paytm_status_confirmed": 10,
    "paytm_payment_failed": 10,
    "paytm_amount_mismatch": 10,
}


def rank(kind: str, payload: dict[str, Any]) -> tuple[int, int]:
    """Where an event belongs in the story, and which line it is about."""

    position = payload.get("position")
    return _RANK.get(kind, 5), int(position) if isinstance(position, int) else 0


# Kinds that say nothing useful to a person watching a demo. Shown as raw rather than hidden.
_QUIET = {"idempotency_key_collision", "catalog_purchase_rejected"}


@dataclass(frozen=True)
class HoodEvent:
    id: str
    at: str
    actor: Actor
    tone: Tone
    title: str
    line_id: str | None
    raw: dict[str, Any]

    def as_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "at": self.at,
            "actor": self.actor,
            "tone": self.tone,
            "title": self.title,
            "line_id": self.line_id,
            "raw": self.raw,
        }


def _money(minor: Any) -> str:
    try:
        return f"Rs {int(minor) / 100:,.0f}"
    except (TypeError, ValueError):
        return "an amount"


def _fill(template: str, payload: dict[str, Any]) -> str:
    """Substitute payload values, and never fail because a key was missing."""

    values = dict(payload)
    reasons = payload.get("reason") or payload.get("reasons") or payload.get("detail")
    if isinstance(reasons, list) and reasons:
        reasons = reasons[0]
    values["reason_words"] = humanise(str(reasons)) if reasons else "a rule this store set"
    values["amount_words"] = _money(payload.get("amount_minor") or payload.get("amount"))
    discarded = payload.get("discarded")
    if isinstance(discarded, dict):
        values["discarded_names"] = ", ".join(sorted(discarded))
    elif isinstance(discarded, list):
        values["discarded_names"] = ", ".join(sorted(str(item) for item in discarded))
    else:
        values["discarded_names"] = "the extra fields"
    values.setdefault("name", payload.get("sku", "an item"))
    values.setdefault("quantity", payload.get("quantity", 1))
    values.setdefault("to_state", payload.get("to_state", "a new state"))
    try:
        return template.format(**values)
    except (KeyError, IndexError, ValueError):
        return template


def translate(
    event_id: UUID,
    created_at: Any,
    kind: str,
    payload: dict[str, Any],
    line_id: UUID | None,
) -> HoodEvent | None:
    """One audit row, as a line a person can read. None when it is noise."""

    if kind in _QUIET:
        return None
    actor, tone, template = _KINDS.get(kind, ("SERVER", "info", kind.replace("_", " ")))
    return HoodEvent(
        id=str(event_id),
        at=created_at.strftime("%H:%M:%S") if hasattr(created_at, "strftime") else str(created_at),
        actor=actor,
        tone=tone,
        title=_fill(template, payload),
        line_id=str(line_id) if line_id else None,
        raw=payload,
    )


def known_kinds() -> frozenset[str]:
    """Every kind this module can put into words, for the test that guards the panel."""

    return frozenset(_KINDS)
