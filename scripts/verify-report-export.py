from __future__ import annotations

import sys
from datetime import datetime, timezone
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

def main() -> None:
    from backend.models import QuestionReport, QuestionType, SurveyReport
    from backend.report_export import (
        render_report_html,
        render_report_pdf,
        render_report_xlsx,
    )

    report = SurveyReport(
        survey_id="build-smoke",
        title="한글 보고서 빌드 점검",
        total_responses=2,
        completed_responses=2,
        partial_responses=0,
        completion_rate=1.0,
        published_version=1,
        generated_at=datetime.now(timezone.utc),
        questions=[
            QuestionReport(
                question_id="q1",
                title="서비스에 만족하십니까?",
                type=QuestionType.SINGLE_CHOICE,
                response_count=2,
                option_counts={"만족": 2},
            )
        ],
    )

    xlsx = render_report_xlsx(report, cutoff_date=None, response_status="all")
    if not xlsx.startswith(b"PK"):
        raise SystemExit("Excel report smoke test failed.")

    html = render_report_html(report, cutoff_date=None, response_status="all")
    pdf = render_report_pdf(html)
    if not pdf.startswith(b"%PDF-"):
        raise SystemExit("PDF report smoke test failed.")

    print("IN-SURVEYONE Excel/PDF report smoke test passed.")


if __name__ == "__main__":
    main()
