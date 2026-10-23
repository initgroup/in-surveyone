(function () {
    "use strict";
    document.addEventListener("DOMContentLoaded", () => {
        const params = new URLSearchParams(location.search);
        const error = Common.failure.create(params.get("code") || "SERVICE_UNAVAILABLE");
        const main = document.querySelector("#errorMain");
        main.classList.remove("service-failure");
        main.innerHTML = Common.failure.markup(error, { heading: "h1" });
        main.querySelector("[data-failure-retry]").addEventListener("click", () => {
            // Only a same-origin page is eligible. Never replay an API request.
            let candidate;
            try { candidate = new URL(params.get("return") || "/", location.origin); }
            catch { location.assign("/"); return; }
            if (candidate.origin !== location.origin || candidate.username || candidate.password || candidate.pathname.startsWith("/api/")) location.assign("/");
            else location.assign(candidate.href);
        });
    });
})();
