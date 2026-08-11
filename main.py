from __future__ import annotations

import logging
from contextlib import asynccontextmanager
from datetime import datetime, timezone

from fastapi import FastAPI, Request, Response
from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from backend.config import PROJECT_ROOT, get_settings
from backend.database import close_database, database_status, get_oracle_pool
from backend.errors import DomainError
from backend.request_guard import (
    InProcessFixedWindowLimiter,
    PublicRequestGuardMiddleware,
)
from backend.routers import auth, dashboard, help, public, surveys, templates
from backend.stores import prime_database_guest_probe


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
        ready, reason = prime_database_guest_probe(settings)
        if not ready:
            raise RuntimeError(reason or "Oracle schema readiness check failed.")
    yield
    close_database()


app = FastAPI(
    title=settings.app_name,
    version="0.1.0",
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
)


@app.exception_handler(DomainError)
async def domain_error_handler(_: Request, exc: DomainError) -> JSONResponse:
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
        _set_frontend_cache_policy(request, response)
        return response
    except Exception as exc:
        repository_failure = isinstance(exc, RuntimeError) or _is_oracle_driver_error(exc)
        if settings.db_mode != "oracle" or not repository_failure:
            raise
        logger.exception("Oracle repository request failed.")
        return JSONResponse(
            status_code=503,
            content={
                "detail": (
                    "Oracle repository is unavailable; configuration or schema is "
                    "not implemented correctly. Memory fallback is disabled."
                )
            },
        )


app.include_router(auth.router, prefix="/api/auth", tags=["auth"])
app.include_router(dashboard.router, prefix="/api/dashboard", tags=["dashboard"])
app.include_router(templates.router, prefix="/api/templates", tags=["templates"])
app.include_router(surveys.router, prefix="/api/surveys", tags=["surveys"])
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
