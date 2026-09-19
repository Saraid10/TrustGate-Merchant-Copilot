"""The merchant copilot: one goal in, a basket of decided lines out.

This router adds no way to create a purchase. Every line it produces goes through
`create_catalog_payment_request_for_source`, the same path the MCP tool uses, so policy, the daily
budget, delegation, and approval are reached exactly as they already are. What is new here is
grouping: one goal becomes several ordinary single-item requests, recorded together.

The store tenant is resolved by name rather than taken from a header or an environment variable,
because seeding creates a fresh tenant each time. Looking up the newest one means reseeding is the
reset, with nothing to reconfigure between runs.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
from collections.abc import AsyncIterator
from datetime import UTC, datetime
from typing import Annotated, Any, Literal
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sse_starlette.sse import EventSourceResponse

from agent.planner import PlannerMode, plan_basket_async
from agent.store_data import (
    APPROVAL_REQUIRED_ABOVE_MINOR,
    CATALOGUE,
    MAX_DAILY_SPEND_MINOR,
    STORE_AREA,
    STORE_NAME,
    SUGGESTIONS,
    stock_status,
)
from agent.store_seed import ASSISTANT_ACTOR_ID, find_store_tenant, seed_store
from api.database import SessionLocal, get_session
from api.merchant_events import rank, translate
from api.reason_text import humanise
from api.routes.approvals import grant_approval
from api.routes.catalog_payment_requests import create_catalog_payment_request_for_source
from api.routes.paytm import PaytmUnavailableError, confirm_order, host, mid, rail, start_payment
from models.domain import (
    AuditEvent,
    AuthorizationDecision,
    Basket,
    BasketLine,
    CatalogItem,
    DailySpendReservation,
    Merchant,
    Payment,
    PaymentRequest,
    PaytmOrder,
    Tenant,
)
from schemas.domain import CatalogPaymentRequestCreate

router = APIRouter(prefix="/api/v1/merchant", tags=["merchant copilot"])

Outcome = Literal[
    "READY", "NEEDS_APPROVAL", "STOPPED", "PAYING", "CONFIRMING", "PAID", "PAYMENT_FAILED"
]

# Two refusals deserve shopkeeper wording rather than the system's own. Everything else falls
# through to `api.reason_text`, which the receipt and the console already use, so one code never
# reads two different ways in one product.
_SHOPKEEPER_WORDING: dict[str, str] = {
    "QUANTITY_EXCEEDS_LIMIT": "Asked for more than this listing allows. Nothing was sent to Paytm.",
    "APPROVAL_REQUIRED": "Above your auto-approve limit.",
}


class StockRow(BaseModel):
    sku: str
    name: str
    on_hand: int
    reorder_at: int
    status: Literal["OK", "LOW", "OUT"]


class Suggestion(BaseModel):
    text: str
    needs_live: bool


class StoreResponse(BaseModel):
    store: dict[str, Any]
    budget: dict[str, int]
    rail: str
    assistant_mode: str
    stock: list[StockRow]
    suggestions: list[Suggestion]


class Proposed(BaseModel):
    sku: str
    quantity: int
    purpose: str
    discarded: dict[str, Any] = Field(default_factory=dict)


class Derived(BaseModel):
    unit_price_minor: int
    amount_minor: int
    supplier: str


class LineResponse(BaseModel):
    id: UUID
    sku: str
    name: str | None
    quantity: int
    purpose: str
    proposed: Proposed
    derived: Derived | None
    outcome: Outcome
    reason_code: str | None
    reason_text: str | None
    payment_request_id: UUID | None
    paytm: dict[str, Any] | None = None


class BasketResponse(BaseModel):
    id: UUID
    goal: str
    created_at: str
    assistant: dict[str, Any]
    totals: dict[str, int]
    budget_after_minor: int
    lines: list[LineResponse]


class BasketCreate(BaseModel):
    goal: Annotated[str, Field(min_length=1, max_length=300)]


def _assistant_mode() -> PlannerMode:
    mode = os.getenv("ASSISTANT_MODE", "OFFLINE").upper()
    return mode if mode in {"LIVE", "OFFLINE", "COMPROMISED"} else "OFFLINE"  # type: ignore[return-value]


async def _require_store(session: AsyncSession) -> Tenant:
    tenant = await find_store_tenant(session)
    if tenant is None:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="store not seeded; run python -m agent.store_seed",
        )
    return tenant


def _reason_text(code: str | None) -> str | None:
    if code is None:
        return None
    return _SHOPKEEPER_WORDING.get(code) or humanise(code)


async def _catalogue_facts(
    session: AsyncSession, tenant: Tenant
) -> dict[str, tuple[str, str, int]]:
    """sku -> (display name, supplier name, unit price), read from the tenant's own catalogue."""

    rows = await session.execute(
        select(CatalogItem.sku, CatalogItem.name, Merchant.name, CatalogItem.price_minor)
        .join(
            Merchant,
            (Merchant.id == CatalogItem.merchant_id)
            & (Merchant.tenant_id == CatalogItem.tenant_id),
        )
        .where(CatalogItem.tenant_id == tenant.id, CatalogItem.active.is_(True))
    )
    return {sku: (name, supplier, price) for sku, name, supplier, price in rows.all()}


@router.get("/store", response_model=StoreResponse)
async def read_store(session: Annotated[AsyncSession, Depends(get_session)]) -> StoreResponse:
    tenant = await _require_store(session)
    spent = await _spent_today(session, tenant)
    return StoreResponse(
        store={"name": STORE_NAME, "area": STORE_AREA, "synthetic": True},
        budget={
            "daily_limit_minor": MAX_DAILY_SPEND_MINOR,
            "spent_today_minor": spent,
            "approval_above_minor": APPROVAL_REQUIRED_ABOVE_MINOR,
        },
        rail="PAYTM_STAGING" if os.getenv("PAYTM_RAIL") == "staging" else "SIMULATED",
        assistant_mode=_assistant_mode(),
        stock=[
            StockRow(
                sku=row[0],
                name=row[1],
                on_hand=row[5],
                reorder_at=row[6],
                status=stock_status(row[5], row[6]),  # type: ignore[arg-type]
            )
            for row in CATALOGUE
        ],
        suggestions=[Suggestion(text=text, needs_live=live) for text, live in SUGGESTIONS],
    )


async def _spent_today(session: AsyncSession, tenant: Tenant) -> int:
    """Today's committed spend, read from the reservations the policy engine enforces against.

    Summing payment requests instead would count every request this store ever made, including
    refused ones and yesterday's, so the figure on the owner's screen would disagree with the limit
    actually being applied. Two numbers that are supposed to be the same number must come from one
    place.
    """

    rows = await session.execute(
        select(DailySpendReservation.reserved_amount_minor).where(
            DailySpendReservation.tenant_id == tenant.id,
            DailySpendReservation.spend_date == datetime.now(UTC).date(),
        )
    )
    return int(sum(amount for (amount,) in rows.all()))


@router.post("/baskets", response_model=BasketResponse, status_code=status.HTTP_201_CREATED)
async def create_basket(
    body: BasketCreate, session: Annotated[AsyncSession, Depends(get_session)]
) -> BasketResponse:
    tenant = await _require_store(session)
    mode = _assistant_mode()
    plan = await plan_basket_async(body.goal, mode)

    basket = Basket(
        id=uuid4(),
        tenant_id=tenant.id,
        goal=body.goal,
        assistant_mode=plan.mode_used,
        model=plan.model,
        note=plan.note,
    )
    session.add(basket)
    await session.flush()
    if mode == "LIVE" and plan.mode_used != "LIVE":
        session.add(
            AuditEvent(
                tenant_id=tenant.id,
                correlation_id=basket.id,
                event_kind="planner_fell_back",
                payload={"asked_for": mode, "used": plan.mode_used},
            )
        )
    facts = await _catalogue_facts(session, tenant)
    listings = await _listings(session, tenant)

    for position, raw in enumerate(plan.lines):
        quantity_value = raw.kept.get("quantity", 0)
        kept: dict[str, Any] = {
            "sku": str(raw.kept.get("sku", "")),
            "quantity": quantity_value if isinstance(quantity_value, int) else 0,
            "purpose": str(raw.kept.get("purpose", "")),
        }
        outcome = await create_catalog_payment_request_for_source(
            CatalogPaymentRequestCreate(
                sku=str(kept["sku"]),
                quantity=int(kept["quantity"]),
                purpose=str(kept["purpose"]),
                idempotency_key=str(uuid4()),
            ),
            tenant,
            session,
            actor_id=ASSISTANT_ACTOR_ID,
            source="MERCHANT_COPILOT",
        )
        rejected = isinstance(outcome, JSONResponse)
        line_id = uuid4()
        known = facts.get(str(kept["sku"]))
        session.add(
            AuditEvent(
                tenant_id=tenant.id,
                correlation_id=basket.id,
                event_kind="planner_line_proposed",
                payload={
                    "line_id": str(line_id),
                    "position": position,
                    "sku": kept["sku"],
                    "name": known[0] if known else kept["sku"],
                    "quantity": kept["quantity"],
                    "purpose": kept["purpose"],
                },
            )
        )
        if raw.discarded:
            session.add(
                AuditEvent(
                    tenant_id=tenant.id,
                    correlation_id=basket.id,
                    event_kind="planner_fields_discarded",
                    payload={
                        "line_id": str(line_id),
                        "position": position,
                        "discarded": dict(raw.discarded),
                        "source_listing": _listing_for(listings, str(kept["sku"])),
                    },
                )
            )
        if rejected:
            session.add(
                AuditEvent(
                    tenant_id=tenant.id,
                    correlation_id=basket.id,
                    event_kind="line_stopped",
                    payload={
                        "line_id": str(line_id),
                        "position": position,
                        "sku": kept["sku"],
                        "reason": _rejection_reason(outcome),
                    },
                )
            )
        session.add(
            BasketLine(
                id=line_id,
                tenant_id=tenant.id,
                basket_id=basket.id,
                position=position,
                proposed=kept,
                discarded=dict(raw.discarded),
                payment_request_id=None if rejected else outcome.payment_request_id,  # type: ignore[union-attr]
                rejection_reason=_rejection_reason(outcome) if rejected else None,
            )
        )
    await session.flush()
    return await _render_basket(session, tenant, basket.id)


def _rejection_reason(response: Any) -> str:
    """The reason code out of a rejection body, without trusting its shape."""

    import json

    try:
        payload = json.loads(bytes(response.body))
        detail = payload.get("detail")
        return str(detail) if isinstance(detail, str) else "PURCHASE_REJECTED"
    except (ValueError, AttributeError):  # pragma: no cover - defensive
        return "PURCHASE_REJECTED"


@router.get("/baskets/{basket_id}", response_model=BasketResponse)
async def read_basket(
    basket_id: UUID, session: Annotated[AsyncSession, Depends(get_session)]
) -> BasketResponse:
    tenant = await _require_store(session)
    return await _render_basket(session, tenant, basket_id)


@router.post("/lines/{line_id}/approve", response_model=LineResponse)
async def approve_line(
    line_id: UUID, session: Annotated[AsyncSession, Depends(get_session)]
) -> LineResponse:
    tenant = await _require_store(session)
    line = await session.scalar(
        select(BasketLine).where(BasketLine.id == line_id, BasketLine.tenant_id == tenant.id)
    )
    if line is None or line.payment_request_id is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="LINE_NOT_APPROVABLE")

    token = os.getenv("DEMO_APPROVER_TOKEN")
    if not token:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="approver unavailable"
        )
    # The owner approving, through the same grant the API already exposes to a human. The assistant
    # has no route to this: there is no MCP tool that grants an approval.
    await grant_approval(line.payment_request_id, tenant, token, session)
    await session.flush()

    rendered = await _render_basket(session, tenant, line.basket_id)
    for candidate in rendered.lines:
        if candidate.id == line_id:
            return candidate
    raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="LINE_NOT_FOUND")


async def _render_basket(session: AsyncSession, tenant: Tenant, basket_id: UUID) -> BasketResponse:
    basket = await session.scalar(
        select(Basket).where(Basket.id == basket_id, Basket.tenant_id == tenant.id)
    )
    if basket is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="BASKET_NOT_FOUND")

    facts = await _catalogue_facts(session, tenant)
    rows = await session.execute(
        select(BasketLine)
        .where(BasketLine.tenant_id == tenant.id, BasketLine.basket_id == basket_id)
        .order_by(BasketLine.position)
    )
    lines: list[LineResponse] = []
    for line in rows.scalars().all():
        lines.append(await _render_line(session, tenant, line, facts))

    ready = sum(
        line.derived.amount_minor
        for line in lines
        if line.derived is not None and line.outcome == "READY"
    )
    waiting = sum(
        line.derived.amount_minor
        for line in lines
        if line.derived is not None and line.outcome == "NEEDS_APPROVAL"
    )
    paid = sum(
        line.derived.amount_minor
        for line in lines
        if line.derived is not None and line.outcome == "PAID"
    )
    blocked = sum(
        int(line.proposed.discarded.get("amount_minor", 0))
        for line in lines
        if line.outcome == "STOPPED"
    )
    spent_today = await _spent_today(session, tenant)
    return BasketResponse(
        id=basket.id,
        goal=basket.goal,
        created_at=basket.created_at.isoformat(),
        assistant={"mode_used": basket.assistant_mode, "model": basket.model, "note": basket.note},
        totals={
            "ready_minor": ready,
            "waiting_minor": waiting,
            "paid_minor": paid,
            "stopped_count": sum(1 for line in lines if line.outcome == "STOPPED"),
            "blocked_minor": blocked,
        },
        # Reservations are created before this basket is rendered, so this is already the
        # post-basket total. Adding the visible lines again would count every purchase twice.
        budget_after_minor=spent_today,
        lines=lines,
    )


async def _render_line(
    session: AsyncSession,
    tenant: Tenant,
    line: BasketLine,
    facts: dict[str, tuple[str, str, int]],
) -> LineResponse:
    sku = str(line.proposed.get("sku", ""))
    quantity = int(line.proposed.get("quantity", 0))
    known = facts.get(sku)
    proposed = Proposed(
        sku=sku,
        quantity=quantity,
        purpose=str(line.proposed.get("purpose", "")),
        discarded=dict(line.discarded),
    )

    if line.payment_request_id is None:
        return LineResponse(
            id=line.id,
            sku=sku,
            name=known[0] if known else None,
            quantity=quantity,
            purpose=proposed.purpose,
            proposed=proposed,
            derived=None,
            outcome="STOPPED",
            reason_code=line.rejection_reason,
            reason_text=_reason_text(line.rejection_reason),
            payment_request_id=None,
        )

    request = await session.scalar(
        select(PaymentRequest).where(
            PaymentRequest.id == line.payment_request_id, PaymentRequest.tenant_id == tenant.id
        )
    )
    if request is None:  # pragma: no cover - the foreign key makes this unreachable
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="REQUEST_NOT_FOUND")

    state = await _payment_state(session, tenant, request.id)
    outcome, reason_code = _outcome_for(state, await _decision_reasons(session, tenant, request.id))
    paytm = await _paytm_facts(session, tenant, request.id)
    unit_price = known[2] if known else request.amount_minor // max(quantity, 1)
    return LineResponse(
        id=line.id,
        sku=sku,
        name=known[0] if known else None,
        quantity=quantity,
        purpose=proposed.purpose,
        proposed=proposed,
        derived=Derived(
            unit_price_minor=unit_price,
            amount_minor=request.amount_minor,
            supplier=known[1] if known else "",
        ),
        outcome=outcome,
        reason_code=reason_code,
        reason_text=_reason_text(reason_code) if reason_code else "Within your limits.",
        payment_request_id=request.id,
        paytm=paytm,
    )


async def _paytm_facts(
    session: AsyncSession, tenant: Tenant, request_id: UUID
) -> dict[str, Any] | None:
    """What the provider was asked and what it said, for the receipt's third column."""

    order = await session.scalar(
        select(PaytmOrder)
        .join(Payment, Payment.id == PaytmOrder.payment_id)
        .where(PaytmOrder.tenant_id == tenant.id, Payment.payment_request_id == request_id)
        .order_by(PaytmOrder.created_at.desc())
        .limit(1)
    )
    if order is None:
        return None
    return {
        "order_id": order.order_id,
        "status": order.status,
        "amount_minor": order.amount_minor,
    }


async def _payment_state(session: AsyncSession, tenant: Tenant, request_id: UUID) -> str:
    from models.domain import Payment

    state = await session.scalar(
        select(Payment.state).where(
            Payment.payment_request_id == request_id, Payment.tenant_id == tenant.id
        )
    )
    return str(state) if state is not None else "DENIED"


async def _decision_reasons(session: AsyncSession, tenant: Tenant, request_id: UUID) -> list[str]:
    """Why the server decided what it decided, in its own words rather than ours."""

    decision = await session.scalar(
        select(AuthorizationDecision)
        .where(
            AuthorizationDecision.tenant_id == tenant.id,
            AuthorizationDecision.payment_request_id == request_id,
        )
        .order_by(AuthorizationDecision.created_at.desc())
        .limit(1)
    )
    return list(decision.reasons) if decision is not None else []


def _outcome_for(state: str, reasons: list[str]) -> tuple[Outcome, str | None]:
    """Map the payment's own state onto what the owner sees. The state machine stays the truth.

    The reason is taken from the recorded decision, never invented here. A purchase refused for
    today's limit must not be reported as one refused for its size: a system whose whole claim is
    that its refusals are explainable cannot afford a plausible-sounding guess.
    """

    if state == "APPROVAL_REQUIRED":
        return "NEEDS_APPROVAL", reasons[0] if reasons else "APPROVAL_REQUIRED"
    if state in {"DENIED", "EXPIRED", "CANCELLED"}:
        return "STOPPED", reasons[0] if reasons else "PURCHASE_REFUSED"
    if state == "PROVIDER_PENDING":
        return "CONFIRMING", None
    if state == "CAPTURED":
        return "PAID", None
    if state == "FAILED":
        return "PAYMENT_FAILED", None
    return "READY", None


class CheckoutConfig(BaseModel):
    mid: str
    order_id: str
    txn_token: str
    amount: str
    host: str


class PayStart(BaseModel):
    rail: str
    line: LineResponse
    checkout: CheckoutConfig


class ModeChange(BaseModel):
    assistant_mode: Literal["LIVE", "OFFLINE", "COMPROMISED"]


def _demo_controls_enabled() -> bool:
    return os.getenv("DEMO_CONTROLS", "").lower() in {"1", "true", "yes"}


async def _line_or_404(
    session: AsyncSession, tenant: Tenant, line_id: UUID
) -> tuple[BasketLine, UUID]:
    """The line and its purchase. A stopped line has no purchase, so there is nothing to pay."""

    line = await session.scalar(
        select(BasketLine).where(BasketLine.id == line_id, BasketLine.tenant_id == tenant.id)
    )
    if line is None or line.payment_request_id is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="LINE_NOT_PAYABLE")
    return line, line.payment_request_id


async def _rendered_line(session: AsyncSession, tenant: Tenant, line: BasketLine) -> LineResponse:
    basket = await _render_basket(session, tenant, line.basket_id)
    for candidate in basket.lines:
        if candidate.id == line.id:
            return candidate
    raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="LINE_NOT_FOUND")


@router.post("/lines/{line_id}/pay", response_model=PayStart)
async def pay_line(
    line_id: UUID, session: Annotated[AsyncSession, Depends(get_session)]
) -> PayStart:
    """Open a payment for one line. Refuses anything the server has not already authorized."""

    tenant = await _require_store(session)
    line, request_id = await _line_or_404(session, tenant, line_id)
    try:
        order, token = await start_payment(session, tenant, request_id)
    except PaytmUnavailableError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=exc.reason) from exc
    await session.flush()

    rendered = await _rendered_line(session, tenant, line)
    return PayStart(
        rail="PAYTM_STAGING" if rail() == "staging" else "SIMULATED",
        line=rendered,
        checkout=CheckoutConfig(
            mid=mid(),
            order_id=order.order_id,
            txn_token=token,
            amount=f"{order.amount_minor / 100:.2f}",
            host=host(),
        ),
    )


@router.post("/lines/{line_id}/confirm", response_model=LineResponse)
async def confirm_line(
    line_id: UUID, session: Annotated[AsyncSession, Depends(get_session)]
) -> LineResponse:
    """Ask the provider what happened. Safe to call as often as the owner presses the button."""

    tenant = await _require_store(session)
    line, request_id = await _line_or_404(session, tenant, line_id)
    order = await session.scalar(
        select(PaytmOrder)
        .join(Payment, Payment.id == PaytmOrder.payment_id)
        .where(
            PaytmOrder.tenant_id == tenant.id,
            Payment.payment_request_id == request_id,
        )
        .order_by(PaytmOrder.created_at.desc())
        .limit(1)
    )
    if order is None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="NOTHING_TO_CONFIRM")
    try:
        await confirm_order(session, tenant, order)
    except PaytmUnavailableError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=exc.reason) from exc
    await session.flush()
    return await _rendered_line(session, tenant, line)


@router.post("/demo/reset", response_model=StoreResponse)
async def reset_store(session: Annotated[AsyncSession, Depends(get_session)]) -> StoreResponse:
    """Put the store back to its morning state by seeding a new one.

    Seeding rather than deleting: a published policy is immutable and catalogue rows are referenced
    by real purchases, so a delete would fight constraints that exist on purpose. The router always
    reads the newest store, so a new one is the reset. It runs in well under the three seconds this
    has to take between judges.
    """

    if not _demo_controls_enabled():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="NOT_FOUND")
    # Resetting begins the next presentation in the deterministic offline mode.  Leaving the
    # process-wide COMPROMISED mode in place would make the next judge's "normal" run look
    # attacked before the presenter chose to demonstrate it.
    os.environ["ASSISTANT_MODE"] = "OFFLINE"
    identity = await seed_store(session)
    session.add(
        AuditEvent(
            tenant_id=identity.tenant_id,
            correlation_id=uuid4(),
            event_kind="store_reset",
            payload={},
        )
    )
    await session.flush()
    return await read_store(session)


@router.post("/demo/mode", response_model=StoreResponse)
async def set_mode(
    body: ModeChange, session: Annotated[AsyncSession, Depends(get_session)]
) -> StoreResponse:
    """Switch the assistant between live, offline, and compromised, without a restart."""

    if not _demo_controls_enabled():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="NOT_FOUND")
    os.environ["ASSISTANT_MODE"] = body.assistant_mode
    return await read_store(session)


async def _listings(session: AsyncSession, tenant: Tenant) -> dict[str, tuple[str, str]]:
    """sku -> (supplier, the third party description the assistant actually read)."""

    rows = await session.execute(
        select(CatalogItem.sku, Merchant.name, CatalogItem.description_untrusted)
        .join(
            Merchant,
            (Merchant.id == CatalogItem.merchant_id)
            & (Merchant.tenant_id == CatalogItem.tenant_id),
        )
        .where(CatalogItem.tenant_id == tenant.id)
    )
    return {sku: (supplier, text) for sku, supplier, text in rows.all()}


def _listing_for(listings: dict[str, tuple[str, str]], sku: str) -> dict[str, str] | None:
    """The supplier text behind a discarded field, so the panel can show what was read.

    Without this the compromised run shows a refusal with no visible cause, and the audience has
    to take on trust that something in the catalogue told the assistant to do it.
    """

    found = listings.get(sku)
    if found is None:
        return None
    supplier, text = found
    marker = "TRUSTGATE_DEMO_INJECTION:"
    injected = text[text.index(marker) :] if marker in text else ""
    return {"supplier": supplier, "text": text, "injected": injected}


@router.get("/events")
async def stream_events(after: str | None = None) -> EventSourceResponse:
    """The audit trail as it happens, for the panel beside the phone.

    This opens its own session rather than using the request's. A streaming response outlives the
    dependency that would otherwise close the session under it, and a panel that dies after the
    first basket is worse than no panel.
    """

    async def generate() -> AsyncIterator[dict[str, str]]:
        # Say hello before doing any work. The headers flush on the first yield, so a connection
        # that is alive looks alive immediately rather than after the first database round trip.
        yield {
            "event": "tg",
            "data": json.dumps(
                {
                    "id": "open",
                    "at": "",
                    "actor": "SERVER",
                    "tone": "info",
                    "title": "Connected",
                    "line_id": None,
                    "raw": {},
                }
            ),
        }
        seen: set[UUID] = set()
        started = datetime.now(UTC)
        while True:
            try:
                async with SessionLocal() as session:
                    tenant = await find_store_tenant(session)
                    if tenant is not None:
                        rows = await session.execute(
                            select(AuditEvent)
                            .where(
                                AuditEvent.tenant_id == tenant.id,
                                AuditEvent.created_at >= started,
                            )
                            .order_by(AuditEvent.created_at, AuditEvent.id)
                            .limit(200)
                        )
                        events = sorted(
                            rows.scalars().all(),
                            key=lambda e: (
                                e.created_at,
                                *rank(e.event_kind, dict(e.payload or {})),
                            ),
                        )
                        line_ids = await _line_ids_for(
                            session, tenant, [e.payment_request_id for e in events]
                        )
                        for event in events:
                            if event.id in seen:
                                continue
                            seen.add(event.id)
                            payload = dict(event.payload or {})
                            request_id = event.payment_request_id
                            line_id = payload.get("line_id") or (
                                line_ids.get(request_id) if request_id else None
                            )
                            translated = translate(
                                event.id,
                                event.created_at,
                                event.event_kind,
                                payload,
                                UUID(str(line_id)) if line_id else None,
                            )
                            if translated is not None:
                                yield {"event": "tg", "data": json.dumps(translated.as_dict())}
            except Exception:
                # A panel that goes quiet is a panel nobody trusts, so one bad poll is survivable
                # and the loop keeps going rather than taking the whole stream down with it. It is
                # logged rather than swallowed, so a stream that is quietly failing can be found.
                logging.getLogger(__name__).exception("merchant event poll failed")
            await asyncio.sleep(0.4)

    return EventSourceResponse(generate())


async def _line_ids_for(
    session: AsyncSession, tenant: Tenant, request_ids: list[UUID | None]
) -> dict[UUID, UUID]:
    """Which basket line each purchase belongs to, so an event can point at a card."""

    wanted = [rid for rid in request_ids if rid is not None]
    if not wanted:
        return {}
    rows = await session.execute(
        select(BasketLine.payment_request_id, BasketLine.id).where(
            BasketLine.tenant_id == tenant.id, BasketLine.payment_request_id.in_(wanted)
        )
    )
    return {request_id: line_id for request_id, line_id in rows.all() if request_id}
