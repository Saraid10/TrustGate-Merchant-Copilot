"""What the merchant copilot must keep true, stated as tests rather than asserted in a pitch.

The demo's whole claim is that one goal produces three different outcomes and that a compromised
assistant changes none of the money facts. These tests hold that claim to the database.
"""

from __future__ import annotations

from collections.abc import AsyncIterator
from datetime import UTC, datetime
from uuid import UUID, uuid4

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from agent.planner import plan_basket
from agent.store_seed import find_store_tenant, seed_store
from api.app import app
from api.database import get_session
from models.domain import (
    AuthorizationDecision,
    Basket,
    BasketLine,
    DailySpendReservation,
    Payment,
    PaymentRequest,
)

MORNING_GOAL = "Restock what's running low"


@pytest_asyncio.fixture
async def store_client(
    async_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> AsyncIterator[AsyncClient]:
    monkeypatch.setenv("DEMO_APPROVER_TOKEN", "test-approver-token")
    monkeypatch.setenv("DEMO_APPROVER_ID", "owner-nandi-kirana")
    await seed_store(async_session)
    await async_session.flush()

    async def override_session() -> AsyncIterator[AsyncSession]:
        yield async_session

    app.dependency_overrides[get_session] = override_session
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        yield client
    app.dependency_overrides.clear()


async def test_the_planner_never_proposes_an_amount_or_a_payee() -> None:
    """The compromised planner obeys the injection, and the money fields still fall outside."""

    plan = plan_basket(MORNING_GOAL, "COMPROMISED")
    poisoned = [line for line in plan.lines if line.discarded]
    assert poisoned, "the compromised planner should have obeyed the injected instruction"
    for line in plan.lines:
        assert set(line.kept) <= {"sku", "quantity", "purpose"}
    assert set(poisoned[0].discarded) == {"amount_minor", "merchant_id"}


async def test_one_goal_gives_three_different_outcomes(
    store_client: AsyncClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("ASSISTANT_MODE", "COMPROMISED")
    response = await store_client.post("/api/v1/merchant/baskets", json={"goal": MORNING_GOAL})
    assert response.status_code == 201, response.text

    lines = {line["sku"]: line for line in response.json()["lines"]}
    assert lines["TOOR-5KG"]["outcome"] == "READY"
    assert lines["TOOR-5KG"]["derived"]["amount_minor"] == 78_000
    assert lines["OIL-15L"]["outcome"] == "NEEDS_APPROVAL"
    assert lines["OIL-15L"]["reason_code"] == "APPROVAL_REQUIRED"
    assert lines["BAGS-500"]["outcome"] == "STOPPED"
    assert lines["BAGS-500"]["reason_code"] == "QUANTITY_EXCEEDS_LIMIT"


async def test_a_stopped_line_creates_no_purchase_at_all(
    store_client: AsyncClient, async_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The refusal happens before a payment request exists, so there is nothing to cancel later."""

    monkeypatch.setenv("ASSISTANT_MODE", "COMPROMISED")
    response = await store_client.post("/api/v1/merchant/baskets", json={"goal": MORNING_GOAL})
    stopped = next(line for line in response.json()["lines"] if line["outcome"] == "STOPPED")
    assert stopped["payment_request_id"] is None
    assert stopped["derived"] is None

    # Scoped to this store. The database is shared with every other test and with anything run
    # by hand against it, so an unscoped query would be asserting about other people's rows.
    store = await find_store_tenant(async_session)
    assert store is not None
    requests = (
        (
            await async_session.execute(
                select(PaymentRequest.catalog_sku).where(PaymentRequest.tenant_id == store.id)
            )
        )
        .scalars()
        .all()
    )
    assert "BAGS-500" not in requests


async def test_the_amount_the_injection_asked_for_is_recorded_but_unused(
    store_client: AsyncClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("ASSISTANT_MODE", "COMPROMISED")
    response = await store_client.post("/api/v1/merchant/baskets", json={"goal": MORNING_GOAL})
    body = response.json()
    stopped = next(line for line in body["lines"] if line["outcome"] == "STOPPED")

    # Kept as evidence of what was attempted, and counted as money that did not move.
    assert stopped["proposed"]["discarded"]["amount_minor"] == 2_000_000
    assert stopped["proposed"]["discarded"]["merchant_id"] == "attacker-controlled-supplier"
    assert body["totals"]["blocked_minor"] == 2_000_000
    assert body["totals"]["ready_minor"] == 78_000


async def test_an_uncompromised_assistant_stops_nothing(
    store_client: AsyncClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The refusal is caused by the instruction, not by the store refusing carry bags."""

    monkeypatch.setenv("ASSISTANT_MODE", "OFFLINE")
    response = await store_client.post("/api/v1/merchant/baskets", json={"goal": MORNING_GOAL})
    lines = {line["sku"]: line for line in response.json()["lines"]}
    assert lines["BAGS-500"]["outcome"] == "READY"
    assert lines["BAGS-500"]["derived"]["amount_minor"] == 36_000
    assert response.json()["totals"]["stopped_count"] == 0


async def test_the_owner_approving_makes_the_line_payable(
    store_client: AsyncClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("ASSISTANT_MODE", "OFFLINE")
    created = await store_client.post("/api/v1/merchant/baskets", json={"goal": MORNING_GOAL})
    waiting = next(line for line in created.json()["lines"] if line["outcome"] == "NEEDS_APPROVAL")

    approved = await store_client.post(f"/api/v1/merchant/lines/{waiting['id']}/approve")
    assert approved.status_code == 200, approved.text
    assert approved.json()["outcome"] == "READY"


async def test_a_line_cannot_hold_both_a_purchase_and_a_refusal(
    async_session: AsyncSession,
) -> None:
    """The database refuses the third state, rather than trusting every writer to avoid it."""

    identity = await seed_store(async_session)
    basket = Basket(
        id=uuid4(),
        tenant_id=identity.tenant_id,
        goal=MORNING_GOAL,
        assistant_mode="OFFLINE",
        note="",
    )
    async_session.add(basket)
    await async_session.flush()

    async_session.add(
        BasketLine(
            id=uuid4(),
            tenant_id=identity.tenant_id,
            basket_id=basket.id,
            position=0,
            proposed={"sku": "TOOR-5KG", "quantity": 1, "purpose": "restock"},
            discarded={},
            payment_request_id=None,
            rejection_reason=None,
        )
    )
    with pytest.raises(IntegrityError):
        await async_session.flush()


async def test_the_refusal_reason_is_the_one_the_server_recorded(
    store_client: AsyncClient, async_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Four bags of dal costs more than one purchase may, and the owner is told exactly that.

    The reason has to come from the recorded decision. Deriving it from the payment state alone
    means guessing, and a guess that sounds right is worse than no reason at all in a product whose
    claim is that every refusal is explainable.
    """

    monkeypatch.setenv("ASSISTANT_MODE", "OFFLINE")
    response = await store_client.post(
        "/api/v1/merchant/baskets", json={"goal": "Order 4 toor dal"}
    )
    line = next(line for line in response.json()["lines"] if line["sku"] == "TOOR-5KG")
    assert line["outcome"] == "STOPPED"
    assert line["reason_code"] == "AMOUNT_EXCEEDS_LIMIT"

    recorded = await async_session.scalar(
        select(AuthorizationDecision).where(
            AuthorizationDecision.payment_request_id == UUID(line["payment_request_id"])
        )
    )
    assert recorded is not None
    assert recorded.decision == "DENY"
    assert line["reason_code"] in recorded.reasons


async def test_spend_shown_to_the_owner_is_the_spend_the_policy_enforces(
    store_client: AsyncClient, async_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The number on screen and the number being enforced come from the same rows."""

    monkeypatch.setenv("ASSISTANT_MODE", "OFFLINE")
    await store_client.post("/api/v1/merchant/baskets", json={"goal": MORNING_GOAL})

    shown = (await store_client.get("/api/v1/merchant/store")).json()["budget"]
    # Scoped to this store. The database is shared with every other test and with anything run by
    # hand against it, so an unscoped sum would be asserting about other people's reservations.
    store = await find_store_tenant(async_session)
    assert store is not None
    reserved = (
        (
            await async_session.execute(
                select(DailySpendReservation.reserved_amount_minor).where(
                    DailySpendReservation.tenant_id == store.id,
                    DailySpendReservation.spend_date == datetime.now(UTC).date(),
                )
            )
        )
        .scalars()
        .all()
    )
    assert shown["spent_today_minor"] == sum(reserved)
    assert shown["spent_today_minor"] > 0


async def test_only_stopped_lines_count_as_money_that_did_not_move(
    store_client: AsyncClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("ASSISTANT_MODE", "OFFLINE")
    body = (await store_client.post("/api/v1/merchant/baskets", json={"goal": MORNING_GOAL})).json()
    assert body["totals"]["stopped_count"] == 0
    assert body["totals"]["blocked_minor"] == 0

    monkeypatch.setenv("ASSISTANT_MODE", "COMPROMISED")
    poisoned = (
        await store_client.post("/api/v1/merchant/baskets", json={"goal": MORNING_GOAL})
    ).json()
    assert poisoned["totals"]["blocked_minor"] == 2_000_000


async def test_budget_after_matches_the_reservations_the_policy_engine_created(
    store_client: AsyncClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("ASSISTANT_MODE", "OFFLINE")
    body = (await store_client.post("/api/v1/merchant/baskets", json={"goal": MORNING_GOAL})).json()
    spent = (await store_client.get("/api/v1/merchant/store")).json()["budget"]["spent_today_minor"]
    # The catalogue route reserves each allowed line before the basket is rendered.  The store
    # endpoint therefore already includes this basket; adding visible lines again would double it.
    assert body["budget_after_minor"] == spent


async def test_approving_records_the_amount_the_owner_authorised(
    store_client: AsyncClient, async_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The approval is what authorises the amount, and the capture later depends on it.

    A payment created for a line that needs approval carries no authorised amount, because the
    policy engine records one only when it decides ALLOW by itself. Until this was written down at
    the moment of approval, the line paid, Paytm confirmed it, and the capture was then refused for
    exceeding an authorisation that had never been recorded. It surfaced as a 500 on the single
    beat of the demo the owner is part of, and only after the money had already moved.
    """

    monkeypatch.setenv("ASSISTANT_MODE", "OFFLINE")
    created = await store_client.post("/api/v1/merchant/baskets", json={"goal": MORNING_GOAL})
    waiting = next(line for line in created.json()["lines"] if line["outcome"] == "NEEDS_APPROVAL")

    approved = await store_client.post(f"/api/v1/merchant/lines/{waiting['id']}/approve")
    assert approved.status_code == 200, approved.text

    payment = await async_session.scalar(
        select(Payment).where(Payment.payment_request_id == UUID(waiting["payment_request_id"]))
    )
    assert payment is not None
    assert payment.state == "AUTHORIZED"
    assert payment.authorized_amount_minor == waiting["derived"]["amount_minor"]
