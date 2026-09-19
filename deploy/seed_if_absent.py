"""Put the morning store in a fresh database, and leave an existing one alone.

Run at boot. Seeding unconditionally would move the demo to a new tenant every time the service
restarts, which on a free host happens whenever it has been idle. Starting the morning again is
`/api/v1/merchant/demo-reset`, a thing someone chooses to do.
"""

from __future__ import annotations

import asyncio

from agent.store_seed import find_store_tenant, seed_store
from api.database import SessionLocal


async def _main() -> None:
    async with SessionLocal() as session:
        async with session.begin():
            if await find_store_tenant(session) is not None:
                print("Store already present")
                return
            identity = await seed_store(session)
            print(f"Seeded store tenant {identity.tenant_id}")


if __name__ == "__main__":
    asyncio.run(_main())
