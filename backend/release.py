"""Deployment version read from the release artifact, independently of storage."""
from datetime import datetime
from pathlib import Path
import re

VERSION_FILE = Path(__file__).resolve().parents[1] / "VERSION"


def read_application_version(path: Path = VERSION_FILE) -> str:
    value = path.read_text(encoding="utf-8").strip()
    if not re.fullmatch(r"[0-9]{4}\.[0-9]{2}\.[0-9]{2}\.[1-9][0-9]{0,3}", value):
        raise ValueError("VERSION must use YYYY.MM.DD.N with a positive revision.")
    datetime.strptime(value.rsplit(".", 1)[0], "%Y.%m.%d")
    return value


APPLICATION_VERSION = read_application_version()
