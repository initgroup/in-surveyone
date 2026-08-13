from __future__ import annotations

import io

import pytest
from openpyxl import Workbook

from backend.errors import DomainValidationError
from backend.recipient_import import parse_recipient_file, recipient_xlsx_sample


def _csv_bytes(encoding: str) -> bytes:
    text = (
        "name,countryCode,preferredLanguage,email,mobile,fax,kakaoId,channels\r\n"
        "응답자 A001,KR,ko,sample@example.com,010-1234-5678,,,EMAIL|SMS\r\n"
    )
    return text.encode(encoding)


@pytest.mark.parametrize("encoding", ["utf-8", "utf-8-sig", "cp949", "utf-16"])
def test_text_recipient_import_detects_common_encodings(encoding: str) -> None:
    recipients, file_type, detected = parse_recipient_file(
        "recipients.txt", _csv_bytes(encoding)
    )

    assert file_type == "txt"
    assert detected
    assert recipients[0].name == "응답자 A001"
    assert recipients[0].email == "sample@example.com"
    assert {channel.value for channel in recipients[0].channels} == {"EMAIL", "SMS"}


def test_xlsx_recipient_sample_round_trips_and_infers_channels() -> None:
    recipients, file_type, encoding = parse_recipient_file(
        "recipients.xlsx", recipient_xlsx_sample()
    )

    assert file_type == "xlsx"
    assert encoding is None
    assert len(recipients) == 1
    assert recipients[0].country_code == "KR"

    workbook = Workbook()
    sheet = workbook.active
    sheet.append(
        [
            "name",
            "countryCode",
            "preferredLanguage",
            "email",
            "mobile",
            "fax",
            "kakaoId",
            "channels",
        ]
    )
    sheet.append(["응답자 B", "KR", "ko", "b@example.test", "", "", "", ""])
    output = io.BytesIO()
    workbook.save(output)
    workbook.close()

    inferred, _, _ = parse_recipient_file("inferred.xlsx", output.getvalue())
    assert [channel.value for channel in inferred[0].channels] == ["EMAIL"]


def test_xlsx_recipient_import_rejects_formulas() -> None:
    workbook = Workbook()
    sheet = workbook.active
    sheet.append(["name", "countryCode", "preferredLanguage", "email", "channels"])
    sheet.append(["=CONCAT(\"응답자\",\"A\")", "KR", "ko", "a@example.test", "EMAIL"])
    output = io.BytesIO()
    workbook.save(output)
    workbook.close()

    with pytest.raises(DomainValidationError, match="수식"):
        parse_recipient_file("formula.xlsx", output.getvalue())


def test_text_recipient_import_handles_one_thousand_rows() -> None:
    header = "name,countryCode,preferredLanguage,email,mobile,fax,kakaoId,channels"
    rows = [
        f"응답자 {index:04d},KR,ko,user{index}@example.test,,,,EMAIL"
        for index in range(1, 1001)
    ]

    recipients, _, _ = parse_recipient_file(
        "thousand.csv", ("\n".join([header, *rows]) + "\n").encode("utf-8")
    )

    assert len(recipients) == 1000
    assert recipients[-1].name == "응답자 1000"
