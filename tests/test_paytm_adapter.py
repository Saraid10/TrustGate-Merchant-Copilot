"""What the Paytm adapter must refuse, stated as tests.

The network is faked here on purpose. The simulator's own behaviour is covered in
`test_paytm_simulator.py`; what matters in this file is the orchestration around it: that an order
can only exist because an authority was consumed, that a browser callback cannot move money, and
that only a confirmed status with a matching amount marks a line paid. Those are the claims made on
stage, so they are the claims held down here.
"""

from __future__ import annotations

from collections.abc import AsyncIterator
from typing import Any

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from agent.store_seed import find_store_tenant, seed_store
from api.app import app
from api.database import get_session
from api.paytm_signing import sign_params
from api.routes import paytm as adapter
from models.domain import AuditEvent, Payment, PaytmOrder

MORNING_GOAL = "Restock what's running low"


def status_body(result: str, amount: str = "780.00") -> dict[str, Any]:
    return {
        "resultInfo": {"resultStatus": result, "resultCode": "01", "resultMsg": result},
        "orderId": "TGTEST",
        "txnAmount": amount,
        "txnId": "SIMTXN0001",
    }


@pytest_asyncio.fixture
async def store_client(
    async_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> AsyncIterator[AsyncClient]:
    monkeypatch.setenv("DEMO_APPROVER_TOKEN", "test-approver-token")
    monkeypatch.setenv("DEMO_APPROVER_ID", "owner-nandi-kirana")
    monkeypatch.setenv("ASSISTANT_MODE", "OFFLINE")
    monkeypatch.setenv("PAYTM_RAIL", "simulated")
    # The rail is faked so these tests never touch a socket. Opening a transaction always works;
    # individual tests replace the status answer to say what the provider reported.
    monkeypatch.setattr(adapter, "open_transaction", _always_opens)
    monkeypatch.setattr(adapter, "read_status", _always_pending)
    await seed_store(async_session)
    await async_session.flush()

    async def override_session() -> AsyncIterator[AsyncSession]:
        yield async_session

    app.dependency_overrides[get_session] = override_session
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        yield client
    app.dependency_overrides.clear()


async def _always_opens(order_id: str, amount_minor: int) -> str:
    return f"sim-token-{order_id}"


async def _always_pending(order_id: str) -> dict[str, Any]:
    return status_body("PENDING")


async def _ready_line(client: AsyncClient) -> dict[str, Any]:
    basket = await client.post("/api/v1/merchant/baskets", json={"goal": MORNING_GOAL})
    line: dict[str, Any] = next(
        item for item in basket.json()["lines"] if item["outcome"] == "READY"
    )
    return line


async def test_paying_opens_exactly_one_order(
    store_client: AsyncClient, async_session: AsyncSession
) -> None:
    line = await _ready_line(store_client)
    response = await store_client.post(f"/api/v1/merchant/lines/{line['id']}/pay")

    assert response.status_code == 200, response.text
    assert response.json()["line"]["outcome"] == "CONFIRMING"
    store = await find_store_tenant(async_session)
    assert store is not None
    orders = await async_session.scalar(
        select(func.count()).select_from(PaytmOrder).where(PaytmOrder.tenant_id == store.id)
    )
    assert orders == 1


async def test_paying_twice_creates_no_second_order(
    store_client: AsyncClient, async_session: AsyncSession
) -> None:
    """The authority is single use, so the second attempt has nothing left to consume."""

    line = await _ready_line(store_client)
    first = await store_client.post(f"/api/v1/merchant/lines/{line['id']}/pay")
    second = await store_client.post(f"/api/v1/merchant/lines/{line['id']}/pay")

    assert first.status_code == 200
    assert second.status_code == 409
    store = await find_store_tenant(async_session)
    assert store is not None
    orders = await async_session.scalar(
        select(func.count()).select_from(PaytmOrder).where(PaytmOrder.tenant_id == store.id)
    )
    assert orders == 1


async def test_a_stopped_line_cannot_be_paid(
    store_client: AsyncClient, async_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("ASSISTANT_MODE", "COMPROMISED")
    basket = await store_client.post("/api/v1/merchant/baskets", json={"goal": MORNING_GOAL})
    stopped = next(item for item in basket.json()["lines"] if item["outcome"] == "STOPPED")

    response = await store_client.post(f"/api/v1/merchant/lines/{stopped['id']}/pay")

    assert response.status_code == 404
    store = await find_store_tenant(async_session)
    assert store is not None
    orders = await async_session.scalar(
        select(func.count()).select_from(PaytmOrder).where(PaytmOrder.tenant_id == store.id)
    )
    assert orders == 0


async def test_pending_is_not_paid(store_client: AsyncClient) -> None:
    line = await _ready_line(store_client)
    await store_client.post(f"/api/v1/merchant/lines/{line['id']}/pay")

    confirmed = await store_client.post(f"/api/v1/merchant/lines/{line['id']}/confirm")

    assert confirmed.json()["outcome"] == "CONFIRMING"
    assert confirmed.json()["paytm"]["status"] == "PENDING"


async def test_a_confirmed_success_with_a_matching_amount_marks_it_paid(
    store_client: AsyncClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    line = await _ready_line(store_client)
    await store_client.post(f"/api/v1/merchant/lines/{line['id']}/pay")

    async def succeeded(order_id: str) -> dict[str, Any]:
        return status_body("TXN_SUCCESS", "780.00")

    monkeypatch.setattr(adapter, "read_status", succeeded)
    confirmed = await store_client.post(f"/api/v1/merchant/lines/{line['id']}/confirm")

    assert confirmed.json()["outcome"] == "PAID"
    assert confirmed.json()["paytm"]["status"] == "SUCCESS"


async def test_a_different_amount_is_held_rather_than_captured(
    store_client: AsyncClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The provider saying a number we did not derive is the case nobody should paper over."""

    line = await _ready_line(store_client)
    await store_client.post(f"/api/v1/merchant/lines/{line['id']}/pay")

    async def wrong_amount(order_id: str) -> dict[str, Any]:
        return status_body("TXN_SUCCESS", "20000.00")

    monkeypatch.setattr(adapter, "read_status", wrong_amount)
    confirmed = await store_client.post(f"/api/v1/merchant/lines/{line['id']}/confirm")

    assert confirmed.json()["outcome"] != "PAID"
    assert confirmed.json()["paytm"]["status"] == "MISMATCH"


async def test_confirming_twice_captures_once(
    store_client: AsyncClient, async_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Pressing Check again is safe, and produces one capture rather than two."""

    line = await _ready_line(store_client)
    await store_client.post(f"/api/v1/merchant/lines/{line['id']}/pay")

    async def succeeded(order_id: str) -> dict[str, Any]:
        return status_body("TXN_SUCCESS", "780.00")

    monkeypatch.setattr(adapter, "read_status", succeeded)
    await store_client.post(f"/api/v1/merchant/lines/{line['id']}/confirm")
    again = await store_client.post(f"/api/v1/merchant/lines/{line['id']}/confirm")
    assert again.json()["outcome"] == "PAID"

    store = await find_store_tenant(async_session)
    assert store is not None
    captures = await async_session.scalar(
        select(func.count())
        .select_from(AuditEvent)
        .where(
            AuditEvent.tenant_id == store.id,
            AuditEvent.event_kind == "paytm_status_confirmed",
        )
    )
    assert captures == 1

    payment = await async_session.scalar(
        select(Payment.state)
        .join(PaytmOrder, PaytmOrder.payment_id == Payment.id)
        .where(PaytmOrder.tenant_id == store.id)
    )
    assert payment == "CAPTURED"


async def test_a_signed_callback_cannot_mark_anything_paid(
    store_client: AsyncClient, async_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    """A correct signature proves who sent it, not that money moved.

    The callback is delivered by the shopper's browser. This test signs it exactly as Paytm would
    and still requires the line to remain unpaid, because the provider's own status says pending.
    """

    line = await _ready_line(store_client)
    started = await store_client.post(f"/api/v1/merchant/lines/{line['id']}/pay")
    order_id = started.json()["checkout"]["order_id"]

    params = {"ORDERID": order_id, "TXNAMOUNT": "780.00", "STATUS": "TXN_SUCCESS"}
    callback = await store_client.post(
        "/api/v1/paytm/callback",
        data={**params, "CHECKSUMHASH": sign_params(params)},
        follow_redirects=False,
    )
    assert callback.status_code == 303

    # The rail still says pending, so nothing the browser said may change that.
    store = await find_store_tenant(async_session)
    assert store is not None
    order = await async_session.scalar(select(PaytmOrder).where(PaytmOrder.order_id == order_id))
    assert order is not None
    assert order.status != "SUCCESS"

    payment_state = await async_session.scalar(
        select(Payment.state).where(Payment.id == order.payment_id)
    )
    assert payment_state == "PROVIDER_PENDING"

    verified = await async_session.scalar(
        select(func.count())
        .select_from(AuditEvent)
        .where(
            AuditEvent.tenant_id == store.id,
            AuditEvent.event_kind == "paytm_callback_verified",
        )
    )
    assert verified == 1, "the callback should be recorded even though it changed nothing"


async def test_the_live_planner_falls_back_instead_of_failing_the_basket(
    store_client: AsyncClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    """A planner that raises takes the whole screen with it, so it is not allowed to raise."""

    monkeypatch.setenv("ASSISTANT_MODE", "LIVE")
    monkeypatch.delenv("GROQ_API_KEY", raising=False)

    response = await store_client.post("/api/v1/merchant/baskets", json={"goal": MORNING_GOAL})

    assert response.status_code == 201
    assert response.json()["assistant"]["mode_used"] == "OFFLINE"
    assert len(response.json()["lines"]) == 3
