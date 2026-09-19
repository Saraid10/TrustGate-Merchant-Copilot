"""Seed the synthetic kirana store the merchant copilot works for.

Every run creates a **new** tenant rather than editing or deleting the last one. That is not
laziness about cleanup: a published spending policy is immutable and catalog items are referenced
by payment requests, so "reset" implemented as deletion would fight foreign keys that exist on
purpose. A fresh tenant is one insert, cannot half-fail, and leaves the previous run intact for
anyone still reading its evidence.

The router always works against the newest store tenant, so seeding again is the reset.
"""

from __future__ import annotations

import json
from dataclasses import asdict, dataclass
from datetime import UTC, datetime, timedelta
from uuid import UUID, uuid4

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from agent.runtime import load_local_env, run_async
from agent.store_data import (
    APPROVAL_REQUIRED_ABOVE_MINOR,
    CATALOGUE,
    CURRENCY,
    MAX_AMOUNT_MINOR,
    MAX_DAILY_SPEND_MINOR,
    STORE_NAME,
)
from api.database import SessionLocal
from models.domain import CatalogItem, Merchant, PolicyMerchant, SpendingPolicy, Tenant

# Every store tenant is named with this prefix so the newest one can be found without configuration.
STORE_TENANT_PREFIX = "nandi-kirana-"

ASSISTANT_ACTOR_ID = "merchant-copilot-agent"
OWNER_APPROVER_ID = "owner-nandi-kirana"


@dataclass(frozen=True)
class StoreIdentity:
    tenant_id: UUID
    store_name: str
    assistant_actor_id: str
    owner_approver_id: str
    catalogue_size: int


async def find_store_tenant(session: AsyncSession) -> Tenant | None:
    """The newest seeded store, or None when nothing has been seeded yet."""

    tenant: Tenant | None = await session.scalar(
        select(Tenant)
        .where(Tenant.name.like(f"{STORE_TENANT_PREFIX}%"))
        .order_by(Tenant.created_at.desc())
        .limit(1)
    )
    return tenant


async def seed_store(session: AsyncSession) -> StoreIdentity:
    """Create one store tenant with its suppliers, catalogue, and spending policy."""

    tenant = Tenant(id=uuid4(), name=f"{STORE_TENANT_PREFIX}{uuid4()}")
    session.add(tenant)
    await session.flush()

    supplier_names = sorted({row[2] for row in CATALOGUE})
    suppliers = {
        name: Merchant(id=uuid4(), tenant_id=tenant.id, name=name, is_active=True)
        for name in supplier_names
    }
    policy = SpendingPolicy(
        id=uuid4(),
        tenant_id=tenant.id,
        version=1,
        max_amount_minor=MAX_AMOUNT_MINOR,
        currency=CURRENCY,
        max_daily_spend_minor=MAX_DAILY_SPEND_MINOR,
        # Seven days rather than one. A store seeded tonight and demonstrated tomorrow would
        # otherwise meet an expired policy, and a published policy cannot be extended afterwards.
        expiry=datetime.now(UTC) + timedelta(days=7),
        approval_required_above_minor=APPROVAL_REQUIRED_ABOVE_MINOR,
    )
    session.add_all([*suppliers.values(), policy])
    await session.flush()

    for row in CATALOGUE:
        sku, name, supplier, price_minor, max_quantity, _on_hand, _reorder, description = row
        session.add(
            CatalogItem(
                id=uuid4(),
                tenant_id=tenant.id,
                merchant_id=suppliers[supplier].id,
                sku=sku,
                name=name,
                description_untrusted=description,
                price_minor=price_minor,
                currency=CURRENCY,
                max_quantity=max_quantity,
                active=True,
            )
        )
    # Every supplier is on the policy allowlist. The demo's refusals come from quantity and amount
    # limits, not from an unlisted supplier, so leaving one off would prove the wrong thing.
    for allowed in suppliers.values():
        session.add(
            PolicyMerchant(tenant_id=tenant.id, policy_id=policy.id, merchant_id=allowed.id)
        )
    await session.flush()

    return StoreIdentity(
        tenant_id=tenant.id,
        store_name=STORE_NAME,
        assistant_actor_id=ASSISTANT_ACTOR_ID,
        owner_approver_id=OWNER_APPROVER_ID,
        catalogue_size=len(CATALOGUE),
    )


async def _main() -> None:
    async with SessionLocal() as session:
        async with session.begin():
            identity = await seed_store(session)
    print(json.dumps(asdict(identity), default=str, indent=2))


def main() -> None:
    load_local_env()
    run_async(_main())


if __name__ == "__main__":
    main()
