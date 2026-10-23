from __future__ import annotations

from contextlib import contextmanager
from concurrent.futures import ThreadPoolExecutor
from copy import deepcopy
from dataclasses import replace
from threading import RLock

import pytest
from fastapi.testclient import TestClient

from backend.config import get_settings
from backend.errors import AuthenticationError, ConflictError, ForbiddenError
from backend.memory_store import MemoryStore, utcnow
from backend.models import LoginPolicyUpdate, LoginRequest, SignupRequest
from backend.oracle_store import OracleStore
from backend.sql_loader import sql_loader


def member(store, login_id):
    token, view = store.signup(SignupRequest(loginId=login_id, password="FixtureOnly!234",
        name="검증 담당자", organizationName="합성 기관", termsAccepted=True, privacyAccepted=True))
    return store._users[view.user.id]


class PolicyDatabase:
    """Transactional synthetic Oracle protocol; no live DB or account data."""
    def __init__(self, users):
        self.users = users
        self.policy = {"allow_multi_yn": "Y", "revision_no": 1, "updated_at": None}
        self.sessions = {}
        self.lock = RLock()
        self.events = []
        self.fail_insert = False

    @contextmanager
    def connection(self):
        with self.lock:
            yield self

    @contextmanager
    def transaction(self):
        with self.lock:
            before = deepcopy((self.policy, self.sessions))
            try:
                yield self
            except Exception:
                self.policy, self.sessions = before
                raise

    def user_row(self, user):
        return {"user_id": user.id, "tenant_id": user.tenant_id, "login_id": user.login_id,
                "password_hash": user.password_hash, "user_name": user.name, "email": user.email,
                "tenant_name": user.organization_name, "role_code": user.role.value,
                "guest_yn": "N", "system_admin_yn": "Y" if user.system_admin else "N",
                "created_at": user.created_at, "tenant_status_code": "ACTIVE", "user_use_yn": "Y"}

    def fetch_one(self, connection, sql_id, params=None):
        params = params or {}
        self.events.append(sql_id)
        if sql_id in {"AUTH_POLICY_SELECT", "AUTH_POLICY_LOCK"}:
            return deepcopy(self.policy)
        if sql_id == "AUTH_USER_BY_LOGIN":
            user = next((u for u in self.users.values() if u.login_id == params["loginId"]), None)
            return self.user_row(user) if user else None
        if sql_id == "AUTH_SESSION_SELECT":
            session = self.sessions.get(params["sessionTokenHash"])
            return {**self.user_row(self.users[session["userId"]]), **session} if session else None
        raise AssertionError(sql_id)

    def execute(self, connection, sql_id, params):
        self.events.append(sql_id)
        if sql_id == "AUTH_POLICY_UPDATE":
            self.policy.update(allow_multi_yn=params["allowMultiYn"], revision_no=self.policy["revision_no"] + 1, updated_at=utcnow())
        elif sql_id == "AUTH_SESSION_INSERT":
            if self.fail_insert:
                raise RuntimeError("synthetic insert failure")
            self.sessions[params["sessionTokenHash"]] = {**params, "expires_at": params["expiresAt"], "revoked_at": None}
        elif sql_id == "ADMIN_MEMBER_SESSIONS_REVOKE":
            for session in self.sessions.values():
                if session["userId"] == params["userId"]:
                    session["revoked_at"] = utcnow()
        elif sql_id == "AUTH_SESSION_REVOKE":
            session = self.sessions.get(params["sessionTokenHash"])
            if session:
                session["revoked_at"] = utcnow()
        elif sql_id == "AUTH_SESSION_EXTEND":
            session = self.sessions[params["sessionTokenHash"]]
            if session["revoked_at"] is None:
                session["expires_at"] = params["expiresAt"]
        else:
            raise AssertionError(sql_id)
        return 1


@pytest.fixture(params=["memory", "oracle"])
def policy_store(request):
    memory = MemoryStore(get_settings())
    user = member(memory, "policy-member")
    other = member(memory, "policy-other")
    admin = replace(user, system_admin=True)
    if request.param == "memory":
        return memory, user, other, admin
    database = PolicyDatabase(memory._users)
    return OracleStore(settings=get_settings(), pool=database, crud=database), user, other, admin


def request_for(user, password="FixtureOnly!234"):
    return LoginRequest(loginId=user.login_id, password=password)


def test_concurrent_allowed_by_default_and_logout_is_local(policy_store):
    store, user, other, admin = policy_store
    assert store.login_policy(admin).allow_concurrent_logins is True
    first, _ = store.login(request_for(user))
    second, _ = store.login(request_for(user))
    assert first != second
    assert store.authenticate(first).id == user.id
    assert store.authenticate(second).id == user.id
    store.logout(first)
    with pytest.raises(AuthenticationError):
        store.authenticate(first)
    assert store.authenticate(second).id == user.id


def test_policy_is_admin_only_conflict_checked_and_applies_on_next_login(policy_store):
    store, user, other, admin = policy_store
    for action in [lambda: store.login_policy(user), lambda: store.update_login_policy(user, LoginPolicyUpdate(allowConcurrentLogins=False, revision=1))]:
        with pytest.raises(ForbiddenError):
            action()
    first, _ = store.login(request_for(user))
    other_token, _ = store.login(request_for(other))
    policy = store.update_login_policy(admin, LoginPolicyUpdate(allowConcurrentLogins=False, revision=1))
    assert policy.revision == 2
    assert store.authenticate(first).id == user.id
    with pytest.raises(ConflictError):
        store.update_login_policy(admin, LoginPolicyUpdate(allowConcurrentLogins=True, revision=1))
    with pytest.raises(AuthenticationError):
        store.login(request_for(user, "WrongPassword!123"))
    assert store.authenticate(first).id == user.id
    second, _ = store.login(request_for(user))
    with pytest.raises(AuthenticationError):
        store.authenticate(first)
    assert store.authenticate(second).id == user.id
    assert store.authenticate(other_token).id == other.id
    store.update_login_policy(admin, LoginPolicyUpdate(allowConcurrentLogins=True, revision=2))
    third, _ = store.login(request_for(user))
    assert store.authenticate(second).id == user.id
    assert store.authenticate(third).id == user.id
    if isinstance(store, OracleStore):
        fresh = OracleStore(settings=store.settings, pool=store.pool, crud=store.crud)
        assert fresh.login_policy(admin).revision == 3


def test_single_session_concurrent_login_requests_are_serialized(policy_store):
    store, user, other, admin = policy_store
    store.update_login_policy(admin, LoginPolicyUpdate(allowConcurrentLogins=False, revision=1))
    with ThreadPoolExecutor(max_workers=3) as executor:
        tokens = list(executor.map(lambda _: store.login(request_for(user))[0], range(3)))
    valid = []
    for token in tokens:
        try:
            store.authenticate(token)
            valid.append(token)
        except AuthenticationError:
            pass
    assert len(valid) == 1
    if isinstance(store, OracleStore):
        assert "FOR UPDATE" in sql_loader.get("AUTH_POLICY_LOCK")


def test_oracle_insert_failure_rolls_back_previous_session_revocation(policy_store):
    store, user, other, admin = policy_store
    if not isinstance(store, OracleStore):
        return
    first, _ = store.login(request_for(user))
    store.update_login_policy(admin, LoginPolicyUpdate(allowConcurrentLogins=False, revision=1))
    store.crud.fail_insert = True
    with pytest.raises(RuntimeError):
        store.login(request_for(user))
    assert store.authenticate(first).id == user.id


def test_policy_api_requires_admin_strict_payload_and_origin(monkeypatch):
    from backend import stores
    from main import app
    store = MemoryStore(get_settings())
    user = member(store, "policy-api")
    store._users[user.id] = replace(user, system_admin=True)
    monkeypatch.setattr(stores, "memory_store", store)
    with TestClient(app) as client:
        assert client.get("/api/system-settings/login-policy").status_code == 401
        assert client.post("/api/auth/login", json={"loginId": user.login_id, "password": "FixtureOnly!234"}).status_code == 200
        result = client.get("/api/system-settings/login-policy")
        assert result.status_code == 200
        assert result.headers["cache-control"] == "no-store"
        payload = {"allowConcurrentLogins": False, "revision": result.json()["data"]["revision"]}
        assert client.put("/api/system-settings/login-policy", json=payload, headers={"Origin": "https://untrusted.example.test"}).status_code == 403
        for invalid in ["false", 0, None]:
            assert client.put("/api/system-settings/login-policy", json={**payload, "allowConcurrentLogins": invalid}).status_code == 422
        result = client.put("/api/system-settings/login-policy", json=payload)
        assert result.status_code == 200
        assert result.json()["data"]["allowConcurrentLogins"] is False
        assert client.put("/api/system-settings/login-policy", json=payload).status_code == 409
        store._users[user.id] = user
        assert client.get("/api/system-settings/login-policy").status_code == 403
        assert client.put("/api/system-settings/login-policy", json={**payload, "revision": 2}).status_code == 403
