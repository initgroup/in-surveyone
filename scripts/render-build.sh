#!/usr/bin/env bash
set -euo pipefail

# Keep Chromium next to the Python Playwright package so the deployed runtime
# does not depend on a machine-local build cache.
export PLAYWRIGHT_BROWSERS_PATH=0

python -m pip install -r requirements.txt
npm ci --omit=dev
# Render native builds do not provide root privileges for `--with-deps`.
# The headless shell is sufficient for page.pdf() and keeps the deploy smaller.
python -m playwright install --only-shell chromium

if [[ ! -f "node_modules/@fontsource-variable/noto-sans-kr/index.css" ]]; then
    echo "Bundled Noto Sans KR report font is missing." >&2
    exit 1
fi

python scripts/verify-report-export.py
