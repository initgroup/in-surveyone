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

    function icon(name, size = 20) {
        const path = iconPaths[name] || iconPaths.grid;
        return `<svg class="svg-icon" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${path}</svg>`;
    }

    async function request(path, options = {}) {
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
            credentials: "same-origin"
        });
        const contentType = response.headers.get("content-type") || "";
        const payload = contentType.includes("application/json") ? await response.json() : await response.text();
        if (!response.ok) {
            const detail = payload?.detail ?? payload?.message;
            const message = Array.isArray(detail)
                ? detail.map((item) => item?.msg || item?.message || String(item)).join(" / ")
                : (typeof detail === "string" ? detail : `요청을 처리하지 못했습니다. (${response.status})`);
            const error = new Error(message);
            error.status = response.status;
            error.payload = payload;
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
    }

    const api = {
        get(path) { return request(path); },
        post(path, body, options = {}) { return request(path, { ...options, method: "POST", body }); },
        put(path, body) { return request(path, { method: "PUT", body }); },
        patch(path, body) { return request(path, { method: "PATCH", body }); },
        delete(path) { return request(path, { method: "DELETE" }); }
    };

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
        return (...args) => {
            clearTimeout(timer);
            timer = setTimeout(() => callback(...args), delay);
        };
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

    window.Common = { api, request, icon, escapeHtml, formatNumber, formatDate, debounce, downloadCsv, questionsOf };
})();
