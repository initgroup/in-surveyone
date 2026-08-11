from __future__ import annotations

import os


# Tests must never inherit deployment credentials or connect to a live Oracle DB.
os.environ["SURVEYONE_LOAD_DOTENV"] = "false"
os.environ["SURVEYONE_DB_MODE"] = "memory"
os.environ["DB_MODE"] = "memory"
os.environ["SURVEYONE_ENV"] = "test"
