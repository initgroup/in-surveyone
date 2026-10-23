"""Run from any working folder; default is read-only aggregate preview."""
from __future__ import annotations

import argparse
import json
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from backend.database import close_database, get_oracle_pool  # noqa: E402
from backend.guest_retirement import RetirementBlocked, retire_guests  # noqa: E402


def main() -> int:
    parser = argparse.ArgumentParser(description="Retire legacy DB_GUEST data only.")
    parser.add_argument("--apply", action="store_true", help="Delete verified guest-only rows in one transaction.")
    args = parser.parse_args()
    try:
        result = retire_guests(get_oracle_pool(), apply=args.apply)
        print(json.dumps(result, ensure_ascii=False))
        return 0
    except RetirementBlocked as exc:
        print(json.dumps({"status": "blocked", "reason": str(exc)}, ensure_ascii=False))
        return 1
    except Exception as exc:
        # Oracle exceptions can embed connection details. Print types/codes only.
        code = getattr(exc.args[0], "code", None) if exc.args else None
        print(json.dumps({"status": "failed", "errorType": type(exc).__name__, "oracleCode": code}))
        return 1
    finally:
        close_database()


if __name__ == "__main__":
    raise SystemExit(main())
