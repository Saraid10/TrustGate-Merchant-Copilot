import os
from pathlib import Path

from fastapi import FastAPI
from fastapi.responses import RedirectResponse
from fastapi.staticfiles import StaticFiles

from api.body_limit import BodySizeLimitMiddleware
from api.routes import (
    approvals,
    catalog_payment_requests,
    checkout_authorities,
    checkout_page,
    console,
    delegations,
    evidence,
    internal_policies,
    merchant,
    payment_requests,
    paytm,
    razorpay,
    webhooks,
)

app = FastAPI(title="MCP Payment Safety Testbed")

# Added as pure ASGI rather than through `add_middleware`, so it wraps the application outermost
# and counts the body before anything else in the stack has touched it. Every route below used to
# read whatever it was sent; the webhook guarded itself and nothing else did.
app.add_middleware(BodySizeLimitMiddleware)
app.include_router(payment_requests.router)
app.include_router(catalog_payment_requests.router)
app.include_router(checkout_authorities.router)
app.include_router(evidence.router)
app.include_router(checkout_page.router)
app.include_router(approvals.router)
app.include_router(delegations.router)
app.include_router(internal_policies.router)
app.include_router(razorpay.router)
app.include_router(webhooks.router)
app.include_router(console.router)
app.include_router(merchant.router)
app.include_router(paytm.router)

# The built merchant UI is served by this application rather than a separate Vite server.  That
# keeps its API calls same-origin and lets a provider callback return to /app inside the checkout
# frame without crossing origins.
_web_dist = Path(__file__).resolve().parents[1] / "web" / "dist"
if _web_dist.is_dir():
    app.mount("/app", StaticFiles(directory=_web_dist, html=True), name="merchant-ui")


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


# The simulated payment rail runs inside this process rather than beside it. One service is one
# thing to start, one thing to deploy, and one fewer way for a demo to be half up: a checkout page
# served from somewhere the browser cannot reach is indistinguishable from a broken product.
if os.getenv("PAYTM_RAIL") != "staging":
    from mock_provider.paytm_sim import app as _rail

    app.mount("/rail", _rail)


@app.get("/", include_in_schema=False)
async def _root() -> RedirectResponse:
    return RedirectResponse(url="/app/")
