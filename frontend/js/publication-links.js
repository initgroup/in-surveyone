(function () {
    "use strict";

    function absoluteUrl(value, base) {
        const url = new URL(value, base);
        if (!["http:", "https:"].includes(url.protocol)) throw new Error("설문 주소 형식이 올바르지 않습니다.");
        return url.href;
    }

    function linksMarkup(view, base) {
        const escape = Common.escapeHtml;
        return `<div class="publication-link-list" data-publication-list>${view.links.map((link, index) => {
            const url = absoluteUrl(link.url, base);
            return `<article class="publication-link-card" data-publication-link><header><h3>${escape(link.label)}</h3>${link.isDefault ? '<span class="publication-default">기본 대상</span>' : ""}</header><label><span class="sr-only">${escape(link.label)} URL</span><input type="text" readonly value="${escape(url)}" data-publication-url></label><div class="publication-link-actions"><button class="button button-function" type="button" data-publication-copy="${index}">URL 복사</button><a class="button button-navigation" href="${escape(url)}" target="_blank" rel="noopener noreferrer">설문 열기 ↗</a></div></article>`;
        }).join("")}</div><div class="publication-common-actions"><button class="button button-function" type="button" data-publication-copy-all>전체 URL 복사</button><button class="button button-layer" type="button" data-publication-edit>설문 편집</button></div><p class="publication-guidance">수정 내용을 저장한 뒤 재확정하면 기존 URL을 그대로 사용합니다. 이 목록은 현재 확정된 버전의 대상 설정입니다.</p>`;
    }

    async function open({ context, surveyId, baseUrl = null, onRegenerate = null }) {
        const dialog = context.openModal(`<section class="publication-links"><header class="publication-heading"><h2>설문 대상별 URL · 관리</h2><p data-publication-title></p><output data-publication-status role="status" aria-live="polite">확정된 URL을 불러오는 중입니다.</output></header><div class="publication-scroll" role="region" aria-label="대상별 URL 목록" tabindex="0"><div data-publication-content aria-busy="true"></div></div><footer class="publication-footer"><p id="publicationRegenerateNotice">새 URL 발급 시 모든 대상의 주소가 함께 변경되며 이전 URL과 QR 코드는 중단됩니다.</p><div class="publication-footer-actions"><button class="button button-batch" type="button" data-publication-regenerate aria-describedby="publicationRegenerateNotice" disabled>새 URL 발급</button><button class="button button-navigation" type="button" data-publication-done>닫기</button></div></footer></section>`, { label: "설문 대상별 URL · 관리", wide: true, publicationLinks: true, initialFocus: "[data-publication-done]" });
        if (!dialog) return null;
        const host = dialog.querySelector(".publication-links");
        const content = host.querySelector("[data-publication-content]");
        const status = host.querySelector("[data-publication-status]");
        const regenerate = host.querySelector("[data-publication-regenerate]");
        const endpoint = `/api/surveys/${encodeURIComponent(surveyId)}`;
        let view = null, busy = false, loading = false, loadTask = null;
        const current = () => host.isConnected && dialog.open && context.isCurrentRoute?.() !== false;
        function disable(value) {
            content.querySelectorAll("button").forEach(button => { button.disabled = value; });
            regenerate.disabled = value || loading || !view;
        }
        function load() {
            if (loadTask) return loadTask;
            loading = true;
            disable(true);
            content.setAttribute?.("aria-busy", "true");
            status.textContent = "확정된 URL을 불러오는 중입니다.";
            loadTask = Promise.resolve().then(async () => {
                try {
                    const payload = await context.api.get(`${endpoint}/public-links`);
                    if (!current()) return;
                    const nextView = payload?.data || payload;
                    // Current APIs include the canonical origin. Older responses
                    // may use an explicitly supplied base or fetch configuration.
                    const nextBase = nextView.publicBaseUrl || baseUrl
                        || (await context.api.get("/api/runtime-config"))?.publicBaseUrl;
                    if (!current()) return;
                    if (!nextBase) throw new Error("공개 주소 설정을 불러오지 못했습니다. 다시 시도해 주세요.");
                    const markup = linksMarkup(nextView, nextBase);
                    baseUrl = nextBase;
                    view = nextView;
                    host.querySelector("[data-publication-title]").textContent = view.title;
                    content.innerHTML = markup;
                    status.textContent = `확정 v${view.version} · 대상별 URL ${view.links.length}개`;
                } catch (error) {
                    if (!current()) return;
                    view = null;
                    content.innerHTML = '<button class="button button-function" type="button" data-publication-retry>URL 다시 불러오기</button>';
                    status.textContent = error.message;
                } finally {
                    loading = false;
                    if (current()) { content.setAttribute?.("aria-busy", "false"); disable(busy); }
                }
            });
            const task = loadTask;
            task.then(() => { if (loadTask === task) loadTask = null; });
            return task;
        }
        host.addEventListener("click", async event => {
            if (event.target.closest("[data-publication-done]")) return dialog.close();
            if (busy || loading) return;
            if (event.target.closest("[data-publication-retry]")) return load();
            if (event.target.closest("[data-publication-edit]")) { dialog.close(); return context.navigate("M02003", { surveyId }); }
            if (!view) return;
            const copy = event.target.closest("[data-publication-copy]");
            if (copy || event.target.closest("[data-publication-copy-all]")) {
                try {
                    const link = copy ? view.links[Number(copy.dataset.publicationCopy)] : null;
                    const text = link ? absoluteUrl(link.url, baseUrl) : view.links.map(item => `${item.label}\n${absoluteUrl(item.url, baseUrl)}`).join("\n\n");
                    await Common.copyText(text);
                    if (current()) status.textContent = link ? `${link.label} URL을 복사했습니다.` : `대상별 URL ${view.links.length}개를 복사했습니다.`;
                } catch (error) { if (current()) status.textContent = error.message; }
                return;
            }
            if (!event.target.closest("[data-publication-regenerate]")) return;
            busy = true; disable(true);
            try {
                const confirmed = await context.confirmMessage(
                    `새 URL을 발급하면 대상별 주소 ${view.links.length}개가 함께 변경되고 기존 URL과 QR 코드는 즉시 중단됩니다. 새 주소를 발급할까요?`,
                    { title: "모든 대상 URL 교체", confirmLabel: "기존 URL 중단 후 새 주소 발급", tone: "warning", destructive: true }
                );
                if (!confirmed || !current()) return;
                status.textContent = "새 URL을 발급하는 중입니다.";
                const payload = await context.api.post(`${endpoint}/public-url/regenerate`, {});
                const result = payload?.data || payload;
                if (context.isCurrentRoute?.() === false) return;
                onRegenerate?.(result);
                if (!current()) return;
                // Never leave a retired address available after rotation.
                content.innerHTML = ""; view = null;
                await load();
                context.toast("모든 대상의 새 URL을 발급했습니다. 기존 주소는 중단되었습니다.", "success");
            } catch (error) { if (current()) status.textContent = error.message; }
            finally { busy = false; if (current()) disable(false); }
        });
        await load();
        return dialog;
    }

    window.SurveyPublicationLinks = Object.freeze({ open, absoluteUrl, linksMarkup });
})();
