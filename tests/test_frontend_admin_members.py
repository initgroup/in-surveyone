from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[1]


def _read(path: str) -> str:
    return (PROJECT_ROOT / path).read_text(encoding="utf-8")


def test_member_admin_menu_is_role_scoped_and_server_paged() -> None:
    menu = _read("frontend/config/menu.config.js")
    page = _read("frontend/pages/M07002.html")
    script = _read("frontend/js/M07002.js")
    style = _read("frontend/css/pages/M07002.css")
    help_config = _read("frontend/config/help.config.js")

    assert 'code: "M07002"' in menu
    assert 'label: "회원 관리"' in menu
    assert 'roles: ["SYSTEM_ADMIN"]' in menu
    assert "data-member-search" in page
    assert 'data-member-type="guest"' in page
    assert "data-member-pagination" in page
    assert "임시 비밀번호는 한 번만 표시됩니다." in page
    assert "!context.user?.systemAdmin" in script
    assert 'this.pageSize = 20;' in script
    assert 'this.context.api.get(`/api/admin/members?${params}`)' in script
    assert "/password-reset" in script
    assert "/status" in script
    assert "memberType: this.memberType" in script
    assert "data-member-withdraw" in script
    assert "withdrawMember(memberId, button)" in script
    assert "this.context.api.delete(`/api/admin/members/${encodeURIComponent(memberId)}`)" in script
    assert "복구할 수 없습니다" in script
    assert "temporaryPassword" in script
    assert "Common.copyText(password)" in script
    assert "@media(max-width:760px)" in style
    assert "M07002:" in help_config


def test_admin_member_api_uses_masking_sessions_and_owner_guards() -> None:
    router = _read("backend/routers/admin_members.py")
    memory = _read("backend/memory_store.py")
    oracle = _read("backend/oracle_store.py")
    sql = _read("database/auth.sql")

    assert 'Query(default=20, alias="pageSize", ge=1, le=100)' in router
    assert 'alias="memberType"' in router
    assert '@router.delete("/{member_id}"' in router
    assert 'mask_contact("EMAIL", candidate.email)' in memory
    assert "if member_id == user.id" in memory
    assert "if member_id == user.id" in oracle
    assert "def admin_withdraw_member" in memory
    assert "def admin_withdraw_member" in oracle
    assert '"ADMIN_MEMBER_WITHDRAW"' in oracle
    assert '"ADMIN_MEMBER_TENANT_CLOSE"' in oracle
    assert "ADMIN_MEMBER_PASSWORD_RESET" in oracle
    assert "ADMIN_MEMBER_SESSIONS_REVOKE" in oracle
    assert "-- [ADMIN_MEMBER_PAGE]" in sql
    assert "OFFSET :offsetRows ROWS FETCH NEXT :limitRows ROWS ONLY" in sql
    assert ":memberType = 'GUEST' AND U.GUEST_YN = 'Y'" in sql
    assert "-- [ADMIN_MEMBER_WITHDRAW]" in sql
    assert "WITHDRAWN_AT = SYSTIMESTAMP" in sql
