from __future__ import annotations

import os
from collections.abc import AsyncIterator

from sqlalchemy.engine import make_url
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

DATABASE_URL = os.getenv(
    "DATABASE_URL",
    "postgresql+psycopg://payment_safety:payment_safety@127.0.0.1:5433/payment_safety",
)

# Docker publishes this project's Postgres port on IPv4. On Windows, `localhost` may resolve to
# IPv6 first and leave an async connection attempt waiting instead of failing promptly. Treat the
# local alias as the explicit loopback address; remote hosts remain entirely untouched.
_database_url = make_url(DATABASE_URL)
if _database_url.host == "localhost":
    _database_url = _database_url.set(host="127.0.0.1")

engine = create_async_engine(_database_url)
SessionLocal = async_sessionmaker(engine, expire_on_commit=False)


async def get_session() -> AsyncIterator[AsyncSession]:
    """Yield a request-scoped session and commit it when the request succeeds.

    Resolving the trusted tenant queries the database before any route body runs, which autobegins
    a transaction. Routes therefore take the `begin_nested` branch and open a savepoint; releasing
    a savepoint does not commit the transaction that encloses it. Without an explicit commit here,
    closing the session rolled every write back while the route still returned its success
    response.

    The regression suite cannot observe this on its own: it injects a session already inside an
    explicit transaction and asserts within that same transaction. `tests/test_session_lifecycle.py`
    exercises this dependency directly against the database for that reason.
    """

    async with SessionLocal() as session:
        try:
            yield session
        except Exception:
            await session.rollback()
            raise
        else:
            await session.commit()
