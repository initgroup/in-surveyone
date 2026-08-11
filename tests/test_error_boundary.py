from main import _is_oracle_driver_error


def test_oracle_driver_errors_are_recognized_through_exception_chains() -> None:
    fake_type = type(
        "DatabaseError",
        (Exception,),
        {"__module__": "oracledb.exceptions"},
    )
    database_error = fake_type("ORA-00001")

    assert _is_oracle_driver_error(database_error) is True

    try:
        raise RuntimeError("repository wrapper") from database_error
    except RuntimeError as wrapped:
        assert _is_oracle_driver_error(wrapped) is True


def test_non_oracle_programming_errors_are_not_hidden() -> None:
    assert _is_oracle_driver_error(ValueError("application bug")) is False
