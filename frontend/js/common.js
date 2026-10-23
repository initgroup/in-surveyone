(function () {
    "use strict";

    const iconPaths = {
        home: '<path d="M3 11.5 12 4l9 7.5v8a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',
        edit: '<path d="M4 20h4l11-11-4-4L4 16v4Zm9-13 4 4M12 20h8"/>',
        send: '<path d="m3 11 18-8-8 18-2.5-7.5L3 11Zm7.5 2.5L21 3"/>',
        database: '<ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v6c0 1.7 3.6 3 8 3s8-1.3 8-3V5M4 11v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6"/>',
        chart: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
        settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6v.2h-4V21a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9A1.7 1.7 0 0 0 3 14H2.8v-4H3a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1A1.7 1.7 0 0 0 9 4.6 1.7 1.7 0 0 0 10 3V2.8h4V3a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.2v4H21a1.7 1.7 0 0 0-1.6 1Z"/>',
        grid: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
        plus: '<path d="M12 5v14M5 12h14"/>',
        arrow: '<path d="M5 12h14m-5-5 5 5-5 5"/>',
        external: '<path d="M14 4h6v6M20 4l-9 9"/><path d="M18 13v6a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h6"/>',
        copy: '<rect x="8" y="8" width="11" height="11" rx="2"/><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3"/>',
        check: '<path d="m5 12 4 4L19 6"/>',
        users: '<circle cx="9" cy="8" r="3"/><path d="M3 20c0-4 2-6 6-6s6 2 6 6"/><path d="M16 5.5a3 3 0 0 1 0 5.8M17 14c2.7.5 4 2.4 4 5"/>',
        eye: '<path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12Z"/><circle cx="12" cy="12" r="2.5"/>',
        more: '<circle cx="5" cy="12" r="1" fill="currentColor"/><circle cx="12" cy="12" r="1" fill="currentColor"/><circle cx="19" cy="12" r="1" fill="currentColor"/>',
        info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5h.01"/>',
        time: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>'
    };
    const credentialEndpoints = new Set(["/api/auth/login", "/api/auth/signup"]);
    const sessionMutationEndpoints = new Set([...credentialEndpoints, "/api/auth/logout"]);
    const sessionProbeEndpoints = new Set(["/api/auth/me"]);
    let sessionGeneration = 0;

    function icon(name, size = 20) {
        const path = iconPaths[name] || iconPaths.grid;
        return `<svg class="svg-icon" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${path}</svg>`;
    }

    async function request(path, options = {}) {
        const requestController = typeof AbortController === "function" ? new AbortController() : null;
        const abortTransport = () => requestController?.abort();
        if (options.signal?.aborted) abortTransport();
        options.signal?.addEventListener("abort", abortTransport, { once: true });
        try {
            return await bounded((async () => {
                const endpoint = String(path).split("?", 1)[0];
                const requestSessionGeneration = sessionGeneration;
                const headers = new Headers(options.headers || {});
                let body = options.body;
                if (body && !(body instanceof FormData) && typeof body !== "string") {
                    headers.set("Content-Type", "application/json");
                    body = JSON.stringify(body);
                }
                headers.set("Accept", "application/json");
                const response = await fetch(`${window.SURVEYONE_CONFIG.apiBaseUrl}${path}`, {
                    ...options,
                    headers,
                    body,
                    credentials: "same-origin",
                    signal: requestController?.signal || options.signal
                });
                if (response.ok && sessionMutationEndpoints.has(endpoint)) sessionGeneration += 1;
                const sessionExpiresAt = response.headers.get("X-SurveyOne-Session-Expires-At");
                if (sessionExpiresAt && Number.isFinite(Date.parse(sessionExpiresAt))) {
                    window.dispatchEvent(new CustomEvent("surveyone:session-refreshed", {
                        detail: { expiresAt: sessionExpiresAt }
                    }));
                }
                const contentType = response.headers.get("content-type") || "";
                const rawBody = await response.text();
                const expectsJson = contentType.toLowerCase().includes("json");
                let payload = rawBody;
                if (expectsJson) {
                    if (!rawBody.trim()) {
                        payload = null;
                    } else {
                        try {
                            payload = JSON.parse(rawBody);
                        } catch (cause) {
                            const message = response.ok
                                ? "서버 응답 형식이 올바르지 않습니다. 잠시 후 다시 시도해 주세요."
                                : `요청을 처리하지 못했습니다. (${response.status})`;
                            const error = new Error(message, { cause });
                            error.status = response.status;
                            error.payload = null;
                            if (response.ok) throw serviceError("INVALID_RESPONSE", { status: response.status });
                            if (response.status >= 500) throw serviceError(response.status === 504 ? "REQUEST_TIMEOUT" : "SERVICE_UNAVAILABLE", { status: response.status });
                            throw error;
                        }
                    }
                }
                if (response.status >= 500 || response.status === 408) {
                    const code = payload?.code === "DATABASE_UNAVAILABLE" ? "DATABASE_UNAVAILABLE"
                        : response.status === 504 || response.status === 408 ? "REQUEST_TIMEOUT"
                        : response.status === 502 || response.status === 503 ? "SERVICE_UNAVAILABLE" : "SERVER_ERROR";
                    throw serviceError(code, { status: response.status, requestId: payload?.requestId });
                }
                if (response.ok && response.status !== 204 && (!expectsJson || !payload || typeof payload !== "object")) {
                    throw serviceError("INVALID_RESPONSE", { status: response.status });
                }
                if (!response.ok) {
                    const detail = payload?.detail ?? payload?.message;
                    const message = Array.isArray(detail)
                        ? detail.map((item) => item?.msg || item?.message || String(item)).join(" / ")
                        : (typeof detail === "string"
                            ? detail
                            : (typeof detail?.message === "string" ? detail.message : `요청을 처리하지 못했습니다. (${response.status})`));
                    const error = new Error(message);
                    error.status = response.status;
                    error.payload = payload;
                    if (
                        response.status === 401
                        && !credentialEndpoints.has(endpoint)
                        && !sessionProbeEndpoints.has(endpoint)
                        && requestSessionGeneration === sessionGeneration
                    ) {
                        sessionGeneration += 1;
                        error.sessionInvalid = true;
                        window.dispatchEvent(new CustomEvent("surveyone:session-invalid", {
                            detail: { endpoint, message }
                        }));
                    }
                    throw error;
                }
                if (
                    payload
                    && typeof payload === "object"
                    && !Array.isArray(payload)
                    && Object.prototype.hasOwnProperty.call(payload, "data")
                    && (payload.status === "success" || Object.keys(payload).length <= 3)
                ) {
                    return payload.data;
                }
                return payload;
            })(), { signal: options.signal, timeoutMs: options.timeoutMs ?? window.SURVEYONE_CONFIG.requestTimeoutMs ?? 30000,
                onTimeout: abortTransport });
        } catch (cause) {
            if (cause?.name === "AbortError" || options.signal?.aborted) throw cause;
            const error = cause instanceof TypeError ? serviceError(globalThis.navigator?.onLine === false ? "OFFLINE" : "NETWORK_ERROR") : cause;
            error.method = String(options.method || "GET").toUpperCase();
            if (isServiceError(error) && !options.silentFailure) {
                window.dispatchEvent(new CustomEvent("surveyone:service-error", {
                    detail: { error, signal: options.signal, method: error.method }
                }));
            }
            throw error;
        } finally {
            options.signal?.removeEventListener("abort", abortTransport);
        }
    }

    const api = {
        get(path, options = {}) { return request(path, options); },
        post(path, body, options = {}) { return request(path, { ...options, method: "POST", body }); },
        put(path, body, options = {}) { return request(path, { ...options, method: "PUT", body }); },
        patch(path, body, options = {}) { return request(path, { ...options, method: "PATCH", body }); },
        delete(path, options = {}) { return request(path, { ...options, method: "DELETE" }); }
    };

    const failureCopy = Object.freeze({
        DATABASE_UNAVAILABLE: ["데이터베이스 연결이 원활하지 않습니다", "저장소에 일시적으로 연결할 수 없어 작업을 완료하지 못했습니다.", "잠시 후 다시 시도해 주세요. 문제가 계속되면 관리자에게 아래 확인 정보를 전달해 주세요.", "database"],
        REQUEST_TIMEOUT: ["응답 대기 시간이 초과되었습니다", "서버에서 정해진 시간 안에 응답하지 않았습니다.", "네트워크 연결을 확인하고 잠시 후 다시 시도해 주세요.", "time"],
        OFFLINE: ["인터넷 연결이 끊어졌습니다", "현재 기기가 네트워크에 연결되어 있지 않습니다.", "Wi-Fi 또는 유선 연결을 확인한 뒤 다시 시도해 주세요.", "info"],
        NETWORK_ERROR: ["웹서비스에 연결할 수 없습니다", "서버까지 연결되지 않아 응답을 받지 못했습니다.", "인터넷 연결을 확인해 주세요. 서버 재시작이나 일시적인 접속 장애일 수 있습니다.", "info"],
        INVALID_RESPONSE: ["서버 응답을 확인할 수 없습니다", "정상적인 처리 결과 대신 예상하지 못한 응답을 받았습니다.", "잠시 후 다시 시도해 주세요. 계속되면 관리자에게 확인 정보를 전달해 주세요.", "info"],
        ASSET_LOAD_FAILED: ["작업 화면을 불러오지 못했습니다", "화면에 필요한 파일을 가져오지 못했습니다.", "연결 상태를 확인하고 화면을 다시 불러와 주세요.", "info"],
        SERVICE_UNAVAILABLE: ["웹서비스를 잠시 이용할 수 없습니다", "서버가 요청을 처리하지 못하고 있습니다.", "서비스 재시작 또는 일시적인 과부하일 수 있습니다. 잠시 후 다시 시도해 주세요.", "info"],
        SERVER_ERROR: ["요청 처리 중 문제가 발생했습니다", "서버에서 작업을 정상적으로 완료하지 못했습니다.", "잠시 후 다시 시도해 주세요. 문제가 계속되면 관리자에게 확인 정보를 전달해 주세요.", "info"]
    });
    function serviceError(code, values = {}) {
        const safe = Object.hasOwn(failureCopy, code) ? code : "SERVER_ERROR";
        return Object.assign(new Error(failureCopy[safe][1]), values, { code: safe, serviceFailure: true });
    }
    function isServiceError(error) {
        return error?.name !== "AbortError" && (error?.serviceFailure === true || error?.status >= 500 || error?.status === 408 || error instanceof TypeError);
    }
    function bounded(task, { signal, timeoutMs = 30000, onTimeout } = {}) {
        if (typeof setTimeout !== "function") return Promise.resolve(task);
        return new Promise((resolve, reject) => {
            let settled = false, timer;
            const finish = (error, value) => {
                if (settled) return;
                settled = true;
                clearTimeout(timer);
                signal?.removeEventListener("abort", onAbort);
                if (error) reject(error); else resolve(value);
            };
            const onAbort = () => { const error = new Error("요청이 취소되었습니다."); error.name = "AbortError"; finish(error); };
            if (signal?.aborted) onAbort();
            else {
                signal?.addEventListener("abort", onAbort, { once: true });
                timer = setTimeout(() => { finish(serviceError("REQUEST_TIMEOUT")); onTimeout?.(); }, Math.max(1, Number(timeoutMs) || 30000));
            }
            Promise.resolve(task).then(value => finish(null, value), error => finish(error));
        });
    }
    function failureInfo(error = {}) {
        const code = Object.hasOwn(failureCopy, error.code) ? error.code
            : error.status === 504 || error.status === 408 ? "REQUEST_TIMEOUT"
            : error.status === 502 || error.status === 503 ? "SERVICE_UNAVAILABLE"
            : error instanceof TypeError ? "NETWORK_ERROR" : "SERVER_ERROR";
        const [title, description, guidance, symbol] = failureCopy[code];
        return { code, title, description, guidance, symbol,
            requestId: /^[a-f0-9-]{16,40}$/i.test(error.requestId || "") ? error.requestId : "",
            status: Number.isInteger(error.status) && error.status >= 400 && error.status <= 599 ? error.status : null };
    }
    let failureSequence = 0;
    function failureMarkup(error, { heading = "h2", retry = true, preserve = false, write = false, home = true } = {}) {
        const info = failureInfo(error);
        const tag = heading === "h1" ? "h1" : "h2";
        const id = `serviceFailureTitle-${++failureSequence}`;
        return `<section class="service-failure" tabindex="-1" aria-labelledby="${id}" data-service-failure><div class="service-failure-card"><span class="service-failure-brand">IN-SURVEYONE</span><span class="service-failure-symbol">${icon(info.symbol, 36)}</span><${tag} id="${id}">${info.title}</${tag}><p class="service-failure-description">${info.description}</p><p>${info.guidance}</p>${preserve ? `<p class="service-failure-preserved">작성 중인 내용은 현재 화면에 유지되어 있습니다.${write === "submission" ? " 응답 제출 결과를 확인할 수 없습니다. 이 창을 유지하고 답변을 바꾸지 않은 채 잠시 후 다시 제출해 주세요." : write ? " 요청이 서버에서 처리됐는지는 확인할 수 없습니다. 저장 상태나 발송 이력을 먼저 확인해 주세요." : " 화면으로 돌아가 작업을 계속할 수 있습니다."}</p>` : ""}<div class="service-failure-actions">${preserve ? '<button type="button" class="service-failure-button is-primary" data-failure-return>작업 화면으로 돌아가기</button>' : ""}${retry ? `<button type="button" class="service-failure-button${preserve ? "" : " is-primary"}" data-failure-retry>${preserve ? "화면 다시 불러오기" : "다시 시도"}</button>` : ""}${home && !preserve ? '<a class="service-failure-button" href="/#/M01001" data-failure-home>홈으로</a>' : ""}</div><dl class="service-failure-meta"><div><dt>상태</dt><dd>${info.code}${info.status ? ` · HTTP ${info.status}` : ""}</dd></div>${info.requestId ? `<div><dt>문의 번호</dt><dd>${escapeHtml(info.requestId)}</dd></div>` : ""}</dl></div></section>`;
    }
    let activeFailure = null;
    function closeFailure() { if (activeFailure?.open) activeFailure.close(); }
    function openFailure(error, { onRetry = null, write = false } = {}) {
        if (activeFailure?.open) return activeFailure;
        const returnFocus = document.activeElement;
        const dialog = document.createElement("dialog");
        activeFailure = dialog;
        dialog.className = "service-failure-dialog";
        dialog.setAttribute("aria-label", failureInfo(error).title);
        dialog.innerHTML = failureMarkup(error, { preserve: true, retry: Boolean(onRetry), write, home: false });
        dialog.addEventListener("close", () => { dialog.remove(); if (activeFailure === dialog) activeFailure = null; if (returnFocus?.isConnected) returnFocus.focus({ preventScroll: true }); }, { once: true });
        dialog.querySelector("[data-failure-return]").addEventListener("click", () => dialog.close());
        dialog.querySelector("[data-failure-retry]")?.addEventListener("click", () => { dialog.close(); void onRetry(); });
        document.body.appendChild(dialog);
        dialog.showModal();
        dialog.querySelector("[data-failure-return]").focus({ preventScroll: true });
        return dialog;
    }
    const failure = Object.freeze({ create: serviceError, isService: isServiceError, info: failureInfo, markup: failureMarkup, open: openFailure, close: closeFailure, bounded });

    function escapeHtml(value) {
        return String(value ?? "")
            .replaceAll("&", "&amp;")
            .replaceAll("<", "&lt;")
            .replaceAll(">", "&gt;")
            .replaceAll('"', "&quot;")
            .replaceAll("'", "&#039;");
    }

    function formatNumber(value) {
        return new Intl.NumberFormat("ko-KR").format(Number(value || 0));
    }

    function formatDate(value, options = {}) {
        if (!value) return "-";
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) return String(value);
        return new Intl.DateTimeFormat("ko-KR", { year: "numeric", month: "short", day: "numeric", ...options }).format(date);
    }

    function debounce(callback, delay = 250) {
        let timer;
        const debounced = (...args) => {
            clearTimeout(timer);
            timer = setTimeout(() => callback(...args), delay);
        };
        debounced.cancel = () => {
            clearTimeout(timer);
            timer = null;
        };
        return debounced;
    }

    async function copyText(value) {
        const text = String(value ?? "");
        if (navigator.clipboard?.writeText) {
            await navigator.clipboard.writeText(text);
            return true;
        }
        const input = document.createElement("textarea");
        input.value = text;
        input.setAttribute("readonly", "");
        input.style.position = "fixed";
        input.style.opacity = "0";
        input.style.pointerEvents = "none";
        document.body.appendChild(input);
        input.select();
        input.setSelectionRange(0, input.value.length);
        try {
            if (!document.execCommand("copy")) throw new Error("Copy command was rejected.");
            return true;
        } finally {
            input.remove();
        }
    }

    function downloadCsv(filename, rows) {
        const encodeCell = (cell) => {
            let value = String(cell ?? "");
            if (typeof cell === "string" && /^[\t\r ]*[=+\-@]/.test(value)) value = `'${value}`;
            return `"${value.replaceAll('"', '""')}"`;
        };
        const csv = rows.map((row) => row.map(encodeCell).join(",")).join("\r\n");
        const blob = new Blob(["\ufeff", csv], { type: "text/csv;charset=utf-8" });
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement("a");
        anchor.href = url;
        anchor.download = filename;
        anchor.click();
        URL.revokeObjectURL(url);
    }

    function questionsOf(entity) {
        if (Array.isArray(entity?.questions)) return entity.questions;
        if (Array.isArray(entity?.sections)) {
            return entity.sections.flatMap((section) => Array.isArray(section?.questions) ? section.questions : []);
        }
        return [];
    }

    const preferenceDefaults = Object.freeze({ density: "comfortable", motion: "system", startPage: "M01001" });
    function normalizePreferences(value) {
        const source = value && typeof value === "object" ? value : {};
        return {
            density: source.density === "compact" ? "compact" : "comfortable",
            motion: source.motion === "reduced" ? "reduced" : "system",
            startPage: source.startPage === "M02001" ? "M02001" : "M01001"
        };
    }
    const preferences = Object.freeze({
        read() {
            try { return normalizePreferences(JSON.parse(localStorage.getItem("surveyone-system-preferences") || "{}")); }
            catch { return { ...preferenceDefaults }; }
        },
        apply(value) {
            const normalized = normalizePreferences(value);
            document.documentElement.dataset.uiDensity = normalized.density;
            document.documentElement.dataset.uiMotion = normalized.motion;
            return normalized;
        },
        save(value) {
            const normalized = normalizePreferences(value);
            localStorage.setItem("surveyone-system-preferences", JSON.stringify(normalized));
            return this.apply(normalized);
        }
    });

    window.Common = { failure, preferences, api, request, icon, escapeHtml, formatNumber, formatDate, debounce, copyText, downloadCsv, questionsOf };
})();
