"""The Paytm rail: open a transaction, hear the browser out, then ask the provider.

Three rules hold here whichever rail is configured, and each is enforced in code below rather than
by convention.

**A provider order can only exist because an authority was consumed.** The authority is claimed
under a row lock, and `uq_paytm_order_one_per_authority` means a second order for the same
authority cannot be written even if two dispatches race. The claim happens before the network call,
so a crash mid flight is fail closed.

**The browser callback cannot move money.** It arrives through the shopper's browser, so it can be
replayed, forged, or simply lost. It is checksum verified and recorded, and then it does nothing but
trigger the server's own question to the provider. There is deliberately no code path from the
callback handler to a state change.

**Only a confirmed status with a matching amount marks a line paid.** Paytm's own documentation says
to confirm through the Transaction Status API rather than trust the callback, which is what this
does. If the provider reports a different amount than the server derived, the order is held for
review rather than captured, because the two disagreeing is exactly the case nobody should paper
over.
"""

from __future__ import annotations

import os
from datetime import UTC, datetime
from decimal import Decimal
from typing import Annotated, Any
from uuid import UUID, uuid4

import httpx
from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.responses import RedirectResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from api.database import get_session
from api.paytm_signing import sign, verify_params
from api.routes.checkout_authorities import (
    CheckoutAuthorityUnavailableError,
    consume_checkout_authority,
    issue_checkout_authority,
)
from models.domain import AuditEvent, Payment, PaymentRequest, PaytmOrder, Tenant
from models.locking import locked
from state_machine.transitions import transition

router = APIRouter(prefix="/api/v1/paytm", tags=["paytm"])

_TIMEOUT = httpx.Timeout(8.0)


class PaytmUnavailableError(RuntimeError):
    """The rail could not be reached or refused to open a transaction."""

    def __init__(self, reason: str) -> None:
        super().__init__(reason)
        self.reason = reason


def rail() -> str:
    return "staging" if os.getenv("PAYTM_RAIL") == "staging" else "simulated"


def host() -> str:
    if rail() == "staging":
        return os.getenv("PAYTM_HOST", "https://securestage.paytmpayments.com").rstrip("/")
    return os.getenv("PAYTM_SIM_HOST", "http://127.0.0.1:8002").rstrip("/")


def mid() -> str:
    return os.getenv("PAYTM_MID", "SIMULATEDMID")


def callback_url() -> str:
    base = os.getenv("TRUSTGATE_BASE_URL", "http://127.0.0.1:8000").rstrip("/")
    return f"{base}/api/v1/paytm/callback"


def new_order_id() -> str:
    """Alphanumeric and under 50 characters, which is all Paytm allows."""

    return f"TG{uuid4().hex[:16].upper()}"


def rupees(amount_minor: int) -> str:
    """Paytm speaks rupees as a decimal string. Never float: this is money."""

    return str((Decimal(amount_minor) / Decimal(100)).quantize(Decimal("0.01")))


def amount_matches(reported: str, amount_minor: int) -> bool:
    """True only when the provider's figure is exactly what the server derived."""

    try:
        return Decimal(reported) == (Decimal(amount_minor) / Decimal(100))
    except Exception:
        return False


async def _audit(
    session: AsyncSession,
    tenant_id: UUID,
    kind: str,
    correlation_id: UUID,
    payload: dict[str, Any],
) -> None:
    session.add(
        AuditEvent(
            tenant_id=tenant_id,
            correlation_id=correlation_id,
            event_kind=kind,
            payload=payload,
        )
    )
    await session.flush()


async def open_transaction(order_id: str, amount_minor: int) -> str:
    """Ask the rail for a transaction token. The amount sent is the server's, never the agent's."""

    body = {
        "requestType": "Payment",
        "mid": mid(),
        "websiteName": os.getenv("PAYTM_WEBSITE", "WEBSTAGING"),
        "orderId": order_id,
        "callbackUrl": callback_url(),
        "txnAmount": {"value": rupees(amount_minor), "currency": "INR"},
        "userInfo": {"custId": "nandi-kirana"},
    }
    url = f"{host()}/theia/api/v1/initiateTransaction?mid={mid()}&orderId={order_id}"
    try:
        async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
            response = await client.post(
                url, json={"head": {"signature": sign(body)}, "body": body}
            )
    except httpx.HTTPError as exc:
        raise PaytmUnavailableError("PAYTM_UNREACHABLE") from exc

    payload = response.json().get("body") or {}
    token = payload.get("txnToken")
    if not token:
        raise PaytmUnavailableError(
            str((payload.get("resultInfo") or {}).get("resultMsg", "PAYTM_REFUSED"))
        )
    return str(token)


async def read_status(order_id: str) -> dict[str, Any]:
    """Ask the provider what actually happened. This is the only account that counts."""

    body = {"mid": mid(), "orderId": order_id}
    try:
        async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
            response = await client.post(
                f"{host()}/v3/order/status",
                json={"head": {"signature": sign(body)}, "body": body},
            )
    except httpx.HTTPError as exc:
        raise PaytmUnavailableError("PAYTM_UNREACHABLE") from exc
    result: dict[str, Any] = response.json().get("body") or {}
    return result


async def start_payment(
    session: AsyncSession, tenant: Tenant, payment_request_id: UUID
) -> tuple[PaytmOrder, str]:
    """Consume one authority, record the order, and open the transaction. In that order."""

    issued = await issue_checkout_authority(payment_request_id, tenant, session)
    if not hasattr(issued, "checkout_authority_id"):
        detail = getattr(issued, "body", b"")
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"CHECKOUT_AUTHORITY_REFUSED:{detail!r}",
        )

    correlation_id = uuid4()
    try:
        authority = await consume_checkout_authority(
            session,
            tenant_id=tenant.id,
            checkout_authority_id=issued.checkout_authority_id,
            correlation_id=correlation_id,
        )
    except CheckoutAuthorityUnavailableError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=exc.reason) from exc

    request = await session.scalar(
        select(PaymentRequest).where(
            PaymentRequest.id == authority.payment_request_id,
            PaymentRequest.tenant_id == tenant.id,
        )
    )
    if request is None:  # pragma: no cover - the foreign key makes this unreachable
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="REQUEST_NOT_FOUND")

    order = PaytmOrder(
        id=uuid4(),
        tenant_id=tenant.id,
        payment_id=authority.payment_id,
        checkout_authority_id=authority.id,
        order_id=new_order_id(),
        amount_minor=request.amount_minor,
        status="CREATED",
    )
    session.add(order)
    await session.flush()

    payment = await session.scalar(
        locked(
            select(Payment).where(
                Payment.id == authority.payment_id, Payment.tenant_id == tenant.id
            )
        )
    )
    if payment is None:  # pragma: no cover - the foreign key makes this unreachable
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="PAYMENT_NOT_FOUND")
    if payment.state == "AUTHORIZED":
        await transition(
            session,
            payment,
            "PROVIDER_PENDING",
            reason="paytm_order_created",
            correlation_id=correlation_id,
        )

    token = await open_transaction(order.order_id, order.amount_minor)
    await _audit(
        session,
        tenant.id,
        "paytm_order_created",
        correlation_id,
        {"order_id": order.order_id, "amount_minor": order.amount_minor, "rail": rail()},
    )
    return order, token


async def confirm_order(session: AsyncSession, tenant: Tenant, order: PaytmOrder) -> PaytmOrder:
    """Ask the provider, and let its answer be the only thing that changes the payment."""

    correlation_id = uuid4()
    locked_order = await session.scalar(
        locked(
            select(PaytmOrder).where(PaytmOrder.id == order.id, PaytmOrder.tenant_id == tenant.id)
        )
    )
    if locked_order is None:  # pragma: no cover - caller just read it
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="PAYTM_ORDER_NOT_FOUND")
    if locked_order.status == "SUCCESS":
        return locked_order

    body = await read_status(locked_order.order_id)
    result = str((body.get("resultInfo") or {}).get("resultStatus", ""))
    reported = str(body.get("txnAmount", ""))

    payment = await session.scalar(
        locked(
            select(Payment).where(
                Payment.id == locked_order.payment_id, Payment.tenant_id == tenant.id
            )
        )
    )
    if payment is None:  # pragma: no cover - the foreign key makes this unreachable
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="PAYMENT_NOT_FOUND")

    if result == "TXN_SUCCESS" and not amount_matches(reported, locked_order.amount_minor):
        locked_order.status = "MISMATCH"
        await _audit(
            session,
            tenant.id,
            "paytm_amount_mismatch",
            correlation_id,
            {
                "order_id": locked_order.order_id,
                "expected_minor": locked_order.amount_minor,
                "reported": reported,
            },
        )
        await session.flush()
        return locked_order

    if result == "TXN_SUCCESS":
        locked_order.status = "SUCCESS"
        locked_order.paytm_txn_id = str(body.get("txnId", "")) or None
        locked_order.confirmed_at = datetime.now(UTC)
        if payment.state == "PROVIDER_PENDING":
            await transition(
                session,
                payment,
                "CAPTURED",
                reason="paytm_status_confirmed",
                correlation_id=correlation_id,
            )
        await _audit(
            session,
            tenant.id,
            "paytm_status_confirmed",
            correlation_id,
            {"order_id": locked_order.order_id, "amount": reported},
        )
    elif result == "TXN_FAILURE":
        locked_order.status = "FAILED"
        if payment.state == "PROVIDER_PENDING":
            await transition(
                session,
                payment,
                "FAILED",
                reason="paytm_status_failed",
                correlation_id=correlation_id,
            )
        await _audit(
            session,
            tenant.id,
            "paytm_payment_failed",
            correlation_id,
            {"order_id": locked_order.order_id},
        )
    else:
        locked_order.status = "PENDING"
        await _audit(
            session,
            tenant.id,
            "paytm_status_pending",
            correlation_id,
            {"order_id": locked_order.order_id, "reported": result},
        )

    await session.flush()
    return locked_order


@router.post("/callback")
async def receive_callback(
    request: Request, session: Annotated[AsyncSession, Depends(get_session)]
) -> RedirectResponse:
    """Verify the browser's message, record it, and then go and ask the provider anyway.

    There is no branch in this function that changes a payment. That is the point being made.
    """

    form = dict(await request.form())
    params = {key: str(value) for key, value in form.items() if key != "CHECKSUMHASH"}
    signature = str(form.get("CHECKSUMHASH", ""))
    order_id = str(form.get("ORDERID", ""))

    order = await session.scalar(select(PaytmOrder).where(PaytmOrder.order_id == order_id))
    if order is None:
        return RedirectResponse(url="/app", status_code=status.HTTP_303_SEE_OTHER)

    verified = verify_params(params, signature)
    await _audit(
        session,
        order.tenant_id,
        "paytm_callback_verified" if verified else "paytm_callback_rejected",
        uuid4(),
        {"order_id": order_id, "verified": verified, "changed_state": False},
    )

    if verified:
        tenant = await session.scalar(select(Tenant).where(Tenant.id == order.tenant_id))
        if tenant is not None:
            await confirm_order(session, tenant, order)

    return RedirectResponse(url="/app", status_code=status.HTTP_303_SEE_OTHER)
