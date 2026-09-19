"""A Paytm-shaped payment simulator, so the demo has a rail that cannot fail on the day.

It speaks the same three calls staging speaks, with the same request and response shapes and the
same checksum library, so the adapter talking to it runs every line of verification code it would
run against Paytm. Switching rails is one environment variable and nothing else.

**Leaving a payment pending is deterministic.** The first status call after a pending checkout
answers `PENDING` and the next answers `TXN_SUCCESS`. The demo needs to show that a payment which
has not been confirmed is not treated as paid, and a beat that depends on timing is a beat that
eventually fails in front of someone.

Run it with: uvicorn mock_provider.paytm_sim:app --port 8002
"""

from __future__ import annotations

from dataclasses import dataclass, field
from html import escape
from typing import Any
from uuid import uuid4

from fastapi import FastAPI, Request
from fastapi.responses import HTMLResponse, JSONResponse

from api.paytm_signing import sign, sign_params, verify_body

app = FastAPI(title="Paytm-shaped payment simulator (SIMULATED)")


@dataclass
class SimulatedOrder:
    order_id: str
    amount: str
    callback_url: str
    txn_token: str
    status: str = "CREATED"
    txn_id: str = field(default_factory=lambda: f"SIMTXN{uuid4().hex[:12].upper()}")
    pending_checks: int = 0


_ORDERS: dict[str, SimulatedOrder] = {}


def _signed(body: dict[str, Any]) -> dict[str, Any]:
    return {"head": {"signature": sign(body)}, "body": body}


@app.post("/theia/api/v1/initiateTransaction")
async def initiate_transaction(request: Request) -> JSONResponse:
    """Issue a transaction token, refusing anything whose signature does not check out."""

    envelope = await request.json()
    body = envelope.get("body") or {}
    signature = (envelope.get("head") or {}).get("signature", "")
    if not verify_body(body, signature):
        return JSONResponse(
            status_code=200,
            content=_signed(
                {
                    "resultInfo": {
                        "resultStatus": "F",
                        "resultCode": "2003",
                        "resultMsg": "Checksum failed",
                    }
                }
            ),
        )

    order_id = str(body.get("orderId", ""))
    order = SimulatedOrder(
        order_id=order_id,
        amount=str((body.get("txnAmount") or {}).get("value", "0")),
        callback_url=str(body.get("callbackUrl", "")),
        txn_token=f"sim-{uuid4().hex}",
    )
    _ORDERS[order_id] = order
    return JSONResponse(
        content=_signed(
            {
                "resultInfo": {"resultStatus": "S", "resultCode": "0000", "resultMsg": "Success"},
                "txnToken": order.txn_token,
            }
        )
    )


@app.post("/v3/order/status")
async def order_status(request: Request) -> JSONResponse:
    """What the provider says happened. The only thing the server is allowed to believe."""

    envelope = await request.json()
    body = envelope.get("body") or {}
    signature = (envelope.get("head") or {}).get("signature", "")
    if not verify_body(body, signature):
        return JSONResponse(
            content=_signed(
                {
                    "resultInfo": {
                        "resultStatus": "F",
                        "resultCode": "2003",
                        "resultMsg": "Checksum failed",
                    }
                }
            )
        )

    order = _ORDERS.get(str(body.get("orderId", "")))
    if order is None:
        return JSONResponse(
            content=_signed(
                {
                    "resultInfo": {
                        "resultStatus": "TXN_FAILURE",
                        "resultCode": "331",
                        "resultMsg": "NO_RECORD_FOUND",
                    }
                }
            )
        )

    if order.status == "PENDING":
        order.pending_checks += 1
        if order.pending_checks >= 2:
            order.status = "TXN_SUCCESS"

    result = {
        "CREATED": ("PENDING", "Txn not initiated"),
        "PENDING": ("PENDING", "Txn is pending"),
        "TXN_SUCCESS": ("TXN_SUCCESS", "Txn Success"),
        "TXN_FAILURE": ("TXN_FAILURE", "Txn Failed"),
    }[order.status]
    return JSONResponse(
        content=_signed(
            {
                "resultInfo": {
                    "resultStatus": result[0],
                    "resultCode": "01",
                    "resultMsg": result[1],
                },
                "orderId": order.order_id,
                "txnAmount": order.amount,
                "txnId": order.txn_id,
            }
        )
    )


@app.get("/sim/checkout", response_class=HTMLResponse)
async def checkout_page(orderId: str, txnToken: str = "") -> HTMLResponse:  # noqa: N803
    """The page a shopper would pay on, labelled for what it is on every line of the screen."""

    order = _ORDERS.get(orderId)
    if order is None or (txnToken and txnToken != order.txn_token):
        return HTMLResponse("<h1>Unknown order</h1>", status_code=404)

    safe_order = escape(order.order_id)
    safe_amount = escape(order.amount)
    return HTMLResponse(
        f"""<!doctype html>
<html><head><meta charset="utf-8"><title>Paytm test checkout (SIMULATED)</title>
<style>
 body {{ font-family: system-ui, sans-serif; background: #F6F9FC; margin: 0;
         display: grid; place-items: center; height: 100vh; color: #12213A; }}
 .card {{ background: #fff; border-radius: 18px; padding: 28px; width: 340px;
          box-shadow: 0 12px 40px rgba(4,25,58,.14); }}
 .tag {{ background: #FFF3DE; color: #E39A20; font-weight: 700; font-size: 12px;
         padding: 6px 10px; border-radius: 999px; display: inline-block; }}
 .amt {{ font-size: 34px; font-weight: 700; margin: 14px 0 2px; }}
 .ord {{ color: #5D6E85; font-size: 13px; margin-bottom: 20px; }}
 button {{ width: 100%; padding: 13px; border: 0; border-radius: 12px; font-size: 15px;
           font-weight: 600; margin-top: 9px; cursor: pointer; }}
 .pay {{ background: #16A36A; color: #fff; }}
 .pend {{ background: #FFF3DE; color: #9a6a12; }}
 .fail {{ background: #FBEAE7; color: #CF4439; }}
</style></head>
<body><div class="card">
  <span class="tag">SIMULATED &middot; no real money</span>
  <div class="amt">&#8377;{safe_amount}</div>
  <div class="ord">Order {safe_order}</div>
  <form method="post" action="/sim/complete">
    <input type="hidden" name="orderId" value="{safe_order}">
    <button class="pay"  name="outcome" value="success">Pay</button>
    <button class="pend" name="outcome" value="pending">Leave pending</button>
    <button class="fail" name="outcome" value="failure">Fail</button>
  </form>
</div></body></html>"""
    )


@app.post("/sim/complete", response_class=HTMLResponse)
async def complete(request: Request) -> HTMLResponse:
    """Record the shopper's choice and hand the browser back to the merchant's callback.

    The callback carries a valid checksum, exactly as Paytm's would, because the point of the
    exercise is that a correctly signed browser callback still does not make a payment real.
    """

    form = await request.form()
    order = _ORDERS.get(str(form.get("orderId", "")))
    if order is None:
        return HTMLResponse("<h1>Unknown order</h1>", status_code=404)

    outcome = str(form.get("outcome", "success"))
    order.status = {"success": "TXN_SUCCESS", "pending": "PENDING", "failure": "TXN_FAILURE"}[
        outcome
    ]

    params = {
        "ORDERID": order.order_id,
        "TXNAMOUNT": order.amount,
        "STATUS": "TXN_SUCCESS" if outcome == "success" else order.status,
        "TXNID": order.txn_id,
    }
    params["CHECKSUMHASH"] = sign_params(params)
    fields = "".join(
        f'<input type="hidden" name="{escape(k)}" value="{escape(str(v))}">'
        for k, v in params.items()
    )
    return HTMLResponse(
        f"""<!doctype html><html><body onload="document.forms[0].submit()">
<form method="post" action="{escape(order.callback_url)}">{fields}</form>
<p>Returning to the merchant...</p></body></html>"""
    )
