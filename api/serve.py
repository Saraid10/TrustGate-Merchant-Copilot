"""Start the API on an event loop psycopg can actually use.

`uvicorn api.app:app` does not work on Windows. Windows defaults to `ProactorEventLoop`, psycopg
refuses to run async on it, and every request that touches the database fails with an
`InterfaceError` while the server itself looks perfectly healthy. `agent/runtime.py` already solves
this for the command line tools; this is the same fix for the server, so there is one documented way
to start it that works on the machine it will actually be demonstrated on.

    python -m api.serve
"""

from __future__ import annotations

import asyncio
import os
import sys

from dotenv import load_dotenv


def main() -> None:
    import uvicorn

    # The server is normally launched directly, not through an agent command that has already
    # loaded `.env`.  Load configuration before Uvicorn imports `api.app`, so the payment rail,
    # demo controls, and approver token are all present in request handlers.
    load_dotenv()
    config = uvicorn.Config(
        "api.app:app",
        host=os.getenv("TRUSTGATE_HOST", "127.0.0.1"),
        port=int(os.getenv("TRUSTGATE_PORT", "8000")),
        log_level=os.getenv("TRUSTGATE_LOG_LEVEL", "warning"),
        # Reload spawns a child process that would build its own loop the default way.
        reload=False,
    )
    server = uvicorn.Server(config)

    # Building the loop rather than setting a policy. Python 3.14 deprecated event loop policies
    # and `asyncio.run` no longer consults them, so `set_event_loop_policy` looks like it works and
    # changes nothing: the server starts, serves, and fails on the first query.
    if sys.platform == "win32":
        with asyncio.Runner(loop_factory=asyncio.SelectorEventLoop) as runner:
            runner.run(server.serve())
        return
    asyncio.run(server.serve())


if __name__ == "__main__":
    main()
