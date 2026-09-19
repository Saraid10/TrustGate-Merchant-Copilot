"""The simulated Paytm rail, and the signature checking both rails share.

The simulator exists so the demo has a payment rail that cannot fail on the day. That is only worth
anything if it exercises the same verification the real rail would, so these tests are mostly about
the signature path rather than about the simulator's own bookkeeping.
"""

from __future__ import annotations

from collections.abc import AsyncIterator
from typing import Any

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient

from api.paytm_signing import canonical, sign, sign_params, verify, verify_body, verify_params
from mock_provider.paytm_sim import app

INITIATE = "/theia/api/v1/initiateTransaction"
STATUS = "/v3/order/status"

BODY: dict[str, Any] = {
    "requestType": "Payment",
    "mid": "TESTMID",
    "websiteName": "WEBSTAGING",
    "orderId": "TGTEST001",
    "callbackUrl": "http://localhost:8000/api/v1/paytm/callback",
    "txnAmount": {"value": "780.00", "currency": "INR"},
    "userInfo": {"custId": "nandi-kirana"},
}


def envelope(body: dict[str, Any]) -> dict[str, Any]:
    return {"head": {"signature": sign(body)}, "body": body}


@pytest_asyncio.fixture
async def rail() -> AsyncIterator[AsyncClient]:
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://sim") as client:
        yield client


@pytest.mark.parametrize("signature", ["", "tampered", "not-base64!!", "c2hvcnQ="])
def test_a_signature_that_cannot_be_checked_is_not_a_valid_signature(signature: str) -> None:
    """The library raises on a malformed checksum; verification has to answer False instead.

    Left unhandled this turns a tampered callback into a 500 and a traceback, which is the one
    outcome a signature check must never produce.
    """

    assert verify(canonical(BODY), signature) is False


def test_a_correct_signature_verifies_and_a_changed_body_does_not() -> None:
    signature = sign(BODY)
    assert verify_body(BODY, signature) is True

    tampered = {**BODY, "txnAmount": {"value": "1.00", "currency": "INR"}}
    assert verify_body(tampered, signature) is False


def test_callback_parameters_round_trip_through_their_own_signature() -> None:
    params = {"ORDERID": "TGTEST001", "TXNAMOUNT": "780.00", "STATUS": "TXN_SUCCESS"}
    signature = sign_params(params)
    assert verify_params(params, signature) is True
    assert verify_params({**params, "TXNAMOUNT": "20000.00"}, signature) is False


async def test_the_rail_refuses_to_open_a_transaction_it_cannot_authenticate(
    rail: AsyncClient,
) -> None:
    bad = envelope(BODY)
    bad["head"]["signature"] = "tampered"
    body = (await rail.post(INITIATE, json=bad)).json()["body"]

    assert body["resultInfo"]["resultStatus"] == "F"
    assert "txnToken" not in body


async def test_a_transaction_is_pending_until_somebody_pays(rail: AsyncClient) -> None:
    order = {**BODY, "orderId": "TGTEST002"}
    issued = (await rail.post(INITIATE, json=envelope(order))).json()["body"]
    assert issued["resultInfo"]["resultStatus"] == "S"
    assert issued["txnToken"]

    status = (
        await rail.post(STATUS, json=envelope({"mid": "TESTMID", "orderId": "TGTEST002"}))
    ).json()["body"]
    assert status["resultInfo"]["resultStatus"] == "PENDING"


async def test_leaving_a_payment_pending_resolves_on_the_next_check_every_time(
    rail: AsyncClient,
) -> None:
    """The graceful-failure beat has to behave identically on the tenth run as on the first."""

    order = {**BODY, "orderId": "TGTEST003"}
    await rail.post(INITIATE, json=envelope(order))
    await rail.post("/sim/complete", data={"orderId": "TGTEST003", "outcome": "pending"})

    query = envelope({"mid": "TESTMID", "orderId": "TGTEST003"})
    first = (await rail.post(STATUS, json=query)).json()["body"]
    second = (await rail.post(STATUS, json=query)).json()["body"]

    assert first["resultInfo"]["resultStatus"] == "PENDING"
    assert second["resultInfo"]["resultStatus"] == "TXN_SUCCESS"
    assert second["txnAmount"] == "780.00"


async def test_a_failed_payment_stays_failed(rail: AsyncClient) -> None:
    order = {**BODY, "orderId": "TGTEST004"}
    await rail.post(INITIATE, json=envelope(order))
    await rail.post("/sim/complete", data={"orderId": "TGTEST004", "outcome": "failure"})

    query = envelope({"mid": "TESTMID", "orderId": "TGTEST004"})
    for _ in range(3):
        status = (await rail.post(STATUS, json=query)).json()["body"]
        assert status["resultInfo"]["resultStatus"] == "TXN_FAILURE"


async def test_the_browser_callback_is_signed_but_carries_no_authority(rail: AsyncClient) -> None:
    """It is signed exactly as Paytm's would be, which is the point being made on stage.

    A correctly signed callback is still only a message delivered by a browser. The server's own
    status check is what decides, and this test fixes the callback's shape so the adapter has
    something real to be unconvinced by.
    """

    order = {**BODY, "orderId": "TGTEST005"}
    await rail.post(INITIATE, json=envelope(order))
    page = await rail.post("/sim/complete", data={"orderId": "TGTEST005", "outcome": "success"})

    assert "CHECKSUMHASH" in page.text
    assert "/api/v1/paytm/callback" in page.text


async def test_the_checkout_page_says_what_it_is(rail: AsyncClient) -> None:
    order = {**BODY, "orderId": "TGTEST006"}
    await rail.post(INITIATE, json=envelope(order))
    page = await rail.get("/sim/checkout", params={"orderId": "TGTEST006"})

    assert page.status_code == 200
    assert "SIMULATED" in page.text
    assert "780.00" in page.text


async def test_an_unknown_order_is_not_invented(rail: AsyncClient) -> None:
    status = (
        await rail.post(STATUS, json=envelope({"mid": "TESTMID", "orderId": "NEVER-EXISTED"}))
    ).json()["body"]
    assert status["resultInfo"]["resultMsg"] == "NO_RECORD_FOUND"

    page = await rail.get("/sim/checkout", params={"orderId": "NEVER-EXISTED"})
    assert page.status_code == 404
