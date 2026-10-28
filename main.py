from __future__ import annotations

import logging
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from uuid import uuid4

from fastapi import FastAPI, Request, Response
from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from backend.config import PROJECT_ROOT, get_settings
from backend.database import close_database, database_status, get_oracle_pool
from backend.errors import DomainError
from backend.release import APPLICATION_VERSION
from backend.request_guard import (
    InProcessFixedWindowLimiter,
    PublicRequestGuardMiddleware,
)
from backend.routers import (
    admin_members,
    admin_templates,
    auth,
    dashboard,
    deployments,
    help,
    public,
    surveys,
    showcase,
    system_settings,
    templates,
)
from backend.stores import prime_database_probe


settings = get_settings()
configured_db_mode = settings.db_mode
logging.basicConfig(level=getattr(logging, settings.log_level, logging.INFO))
logger = logging.getLogger(__name__)
FRONTEND_DIR = PROJECT_ROOT / "frontend"
INDEX_FILE = FRONTEND_DIR / "index.html"
PUBLIC_SURVEY_FILE = FRONTEND_DIR / "public.html"


def _set_frontend_cache_policy(request: Request, response: Response) -> None:
    if request.method.upper() not in {"GET", "HEAD"}:
        return
    path = request.url.path.lower()
    frontend_asset = path.startswith("/frontend/") and path.endswith(
        (".html", ".css", ".js", ".json")
    )
    spa_document = path in {"/", "/app"} or path.startswith("/s/")
    if not frontend_asset and not spa_document:
        return
    if settings.environment in {"development", "dev", "local", "test"}:
        response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate"
        response.headers["Pragma"] = "no-cache"
        response.headers["Expires"] = "0"
    else:
        response.headers["Cache-Control"] = "no-cache, must-revalidate"


def _is_oracle_driver_error(exc: BaseException) -> bool:
    current: BaseException | None = exc
    visited: set[int] = set()
    while current is not None and id(current) not in visited:
        visited.add(id(current))
        if type(current).__module__.split(".", 1)[0] == "oracledb":
            return True
        current = current.__cause__ or current.__context__
    return False


@asynccontextmanager
async def lifespan(_: FastAPI):
    memory_test_fixture = settings.environment == "test" and configured_db_mode == "memory"
    if not memory_test_fixture:
        if configured_db_mode != "oracle":
            raise RuntimeError("Runtime storage must use Oracle.")
        # Oracle mode is explicit: connection/configuration failures abort
        # startup and are never replaced with an in-process repository.
        get_oracle_pool().ping()
        ready, reason = prime_database_probe(settings)
        if not ready:
            raise RuntimeError(reason or "Oracle schema readiness check failed.")
    yield
    close_database()


app = FastAPI(
    title=settings.app_name,
    version=APPLICATION_VERSION,
    description="기관별 설문 작성·배포·응답·분석을 위한 IN-SURVEYONE API",
    lifespan=lifespan,
)

request_guard_limiter = InProcessFixedWindowLimiter()
app.add_middleware(
    PublicRequestGuardMiddleware,
    settings=settings,
    limiter=request_guard_limiter,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=list(settings.allowed_origins),
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Accept", "Content-Type", "Idempotency-Key"],
    expose_headers=["X-SurveyOne-Session-Expires-At"],
)


@app.exception_handler(DomainError)
async def domain_error_handler(_: Request, exc: DomainError) -> JSONResponse:
    if exc.status_code >= 500:
        request_id = uuid4().hex
        logger.error("Service request failed: reference=%s type=%s", request_id, type(exc).__name__)
        return JSONResponse(status_code=exc.status_code, content={
            "detail": exc.detail, "code": "SERVICE_UNAVAILABLE", "requestId": request_id,
        }, headers={"Cache-Control": "no-store"})
    return JSONResponse(status_code=exc.status_code, content={"detail": exc.detail})


@app.exception_handler(RequestValidationError)
async def validation_error_handler(_: Request, exc: RequestValidationError) -> JSONResponse:
    errors = [
        {key: value for key, value in error.items() if key != "input"}
        for error in exc.errors()
    ]
    return JSONResponse(
        status_code=422,
        content=jsonable_encoder({"detail": errors}),
    )


@app.middleware("http")
async def protect_browser_writes(request: Request, call_next):
    if request.url.path.startswith("/api/") and request.method.upper() in {
        "POST",
        "PUT",
        "PATCH",
        "DELETE",
    }:
        origin = request.headers.get("origin")
        if origin and origin.rstrip("/") not in settings.allowed_origins:
            return JSONResponse(
                status_code=403,
                content={"detail": "요청 출처가 허용되지 않았습니다."},
            )
    try:
        response = await call_next(request)
        session_expires_at = getattr(
            request.state, "surveyone_session_expires_at", None
        )
        if session_expires_at is not None:
            response.headers["X-SurveyOne-Session-Expires-At"] = (
                session_expires_at.isoformat()
            )
        _set_frontend_cache_policy(request, response)
        return response
    except Exception as exc:
        repository_failure = settings.db_mode == "oracle" and (
            isinstance(exc, RuntimeError) or _is_oracle_driver_error(exc)
        )
        code = "REQUEST_TIMEOUT" if isinstance(exc, TimeoutError) else "DATABASE_UNAVAILABLE" if repository_failure else "SERVER_ERROR"
        status = 504 if code == "REQUEST_TIMEOUT" else 503 if repository_failure else 500
        request_id = uuid4().hex
        # Driver exception strings/tracebacks can contain connection details.
        logger.error("Request failed: reference=%s code=%s type=%s", request_id, code, type(exc).__name__)
        if not request.url.path.startswith("/api/"):
            return FileResponse(FRONTEND_DIR / "error.html", status_code=status,
                                headers={"Cache-Control": "no-store", "X-SurveyOne-Error-Id": request_id})
        messages = {
            "DATABASE_UNAVAILABLE": "데이터베이스에 연결할 수 없습니다. 잠시 후 다시 시도해 주세요.",
            "REQUEST_TIMEOUT": "서버 응답 대기 시간이 초과되었습니다. 처리 결과를 확인해 주세요.",
            "SERVER_ERROR": "요청 처리 중 문제가 발생했습니다. 잠시 후 다시 시도해 주세요.",
        }
        return JSONResponse(status_code=status,
                            content={"detail": messages[code], "code": code, "requestId": request_id},
                            headers={"Cache-Control": "no-store"})



app.include_router(system_settings.router, prefix="/api/system-settings", tags=["system-settings"])
app.include_router(auth.router, prefix="/api/auth", tags=["auth"])
app.include_router(
    admin_templates.router,
    prefix="/api/admin/templates",
    tags=["admin-templates"],
)
app.include_router(
    admin_members.router,
    prefix="/api/admin/members",
    tags=["admin-members"],
)
app.include_router(dashboard.router, prefix="/api/dashboard", tags=["dashboard"])
app.include_router(templates.router, prefix="/api/templates", tags=["templates"])
app.include_router(showcase.router, prefix="/api/showcase", tags=["showcase"])
app.include_router(surveys.router, prefix="/api/surveys", tags=["surveys"])
app.include_router(deployments.router, prefix="/api/deployments", tags=["deployments"])
app.include_router(public.router, prefix="/api/public", tags=["public-surveys"])
app.include_router(help.router, prefix="/api/help", tags=["help"])


@app.get("/api/health")
def health() -> dict[str, object]:
    return {
        "status": "ok",
        "service": settings.app_name,
        "database": database_status(),
        "time": datetime.now(timezone.utc).isoformat(),
    }


@app.get("/api/version")
def application_version(response: Response) -> dict[str, object]:
    response.headers["Cache-Control"] = "no-store"
    return {"status": "success", "data": {"version": APPLICATION_VERSION}}


@app.get("/api/runtime-config")
def runtime_config() -> dict[str, object]:
    return {
        "status": "success",
        "data": {
            "publicBaseUrl": settings.base_url,
            "environment": settings.environment,
        },
    }


def _spa_response() -> Response:
    if INDEX_FILE.is_file():
        return FileResponse(INDEX_FILE)
    return HTMLResponse(
        "<!doctype html><html lang=\"ko\"><head><meta charset=\"utf-8\">"
        "<meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">"
        "<title>IN-SURVEYONE</title></head><body>"
        "<h1>IN-SURVEYONE API</h1><p><a href=\"/docs\">API 문서 열기</a></p>"
        "</body></html>"
    )


@app.get("/favicon.ico", include_in_schema=False)
def favicon() -> Response:
    return FileResponse(
        FRONTEND_DIR / "assets/images/surveyone.ico",
        media_type="image/x-icon",
        headers={"Cache-Control": "no-cache, must-revalidate"},
    )


@app.get("/error", include_in_schema=False)
def service_error_page() -> Response:
    return FileResponse(FRONTEND_DIR / "error.html", headers={"Cache-Control": "no-store"})


@app.get("/", include_in_schema=False)
@app.get("/app", include_in_schema=False)
def spa_root() -> Response:
    return _spa_response()


@app.get("/s/{slug}", include_in_schema=False)
def public_survey_page(slug: str) -> Response:
    if PUBLIC_SURVEY_FILE.is_file():
        return FileResponse(PUBLIC_SURVEY_FILE)
    # The fallback SPA resolves the slug through /api/public/surveys/{slug}.
    return _spa_response()


# Frontend assets use absolute /frontend/... URLs. Explicit page routes above
# continue to own /, /app, and /s/{slug}.
if FRONTEND_DIR.is_dir():
    app.mount(
        "/frontend",
        StaticFiles(directory=str(FRONTEND_DIR), html=True),
        name="frontend",
    )
