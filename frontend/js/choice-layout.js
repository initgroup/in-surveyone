(function () {
    "use strict";
    const layouts = new Set(["vertical", "horizontal", "columns_2", "columns_3", "columns_4"]);

    function normalize(value) { return layouts.has(value) ? value : "vertical"; }

    function columnsFor(layout, width, minimum, count) {
        layout = normalize(layout);
        if (layout === "vertical" || width < 480 || count < 2) return 1;
        const fit = Math.max(1, Math.floor((width + 9) / (Math.max(168, minimum) + 9)));
        if (layout === "horizontal") return Math.min(6, count, fit);
        const desired = Math.min(count, Number(layout.slice(-1)));
        return fit >= desired ? desired : 1;
    }

    function mount(root) {
        const groups = [...root.querySelectorAll("[data-choice-layout]")];
        if (!groups.length) return () => {};
        let active = true, frame = null, canvas = null;
        const number = value => Number.parseFloat(value) || 0;
        function minimumWidth(group) {
            canvas ||= document.createElement("canvas");
            const context = canvas.getContext("2d");
            let minimum = 168;
            group.querySelectorAll("[data-choice-item]").forEach(item => {
                const label = item.querySelector("[data-choice-label]");
                if (!label) return;
                const style = getComputedStyle(label), itemStyle = getComputedStyle(item);
                context.font = style.font || `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
                const text = label.matches("input,textarea") ? label.value : label.textContent;
                const widest = Math.max(0, ...String(text || "").split(/\r?\n/).map(line => context.measureText(line).width + number(style.letterSpacing) * Array.from(line).length));
                const controls = [...item.children].filter(child => child !== label);
                const fixed = controls.reduce((sum, child) => {
                    const controlStyle = getComputedStyle(child);
                    return sum + (number(controlStyle.width) || child.getBoundingClientRect().width) + number(controlStyle.marginLeft) + number(controlStyle.marginRight);
                }, 0);
                const padding = number(itemStyle.paddingLeft) + number(itemStyle.paddingRight) + number(itemStyle.borderLeftWidth) + number(itemStyle.borderRightWidth)
                    + number(style.paddingLeft) + number(style.paddingRight) + number(style.borderLeftWidth) + number(style.borderRightWidth);
                minimum = Math.max(minimum, Math.ceil(widest + fixed + padding + number(itemStyle.columnGap) * controls.length + 10));
            });
            return minimum;
        }
        function refresh() {
            frame = null;
            if (!active) return;
            groups.forEach(group => {
                if (!group.isConnected) return;
                const width = group.getBoundingClientRect().width;
                if (!width) return;
                const count = group.querySelectorAll("[data-choice-item]").length;
                const columns = columnsFor(group.dataset.choiceLayout, width, minimumWidth(group), count);
                if (group.dataset.choiceColumns === String(columns)) return;
                group.dataset.choiceColumns = String(columns);
                group.style.setProperty("--choice-columns", String(columns));
            });
        }
        function schedule() { if (active && frame === null) frame = requestAnimationFrame(refresh); }
        const observer = typeof ResizeObserver === "function" ? new ResizeObserver(schedule) : null;
        groups.forEach(group => observer?.observe(group));
        window.addEventListener("resize", schedule);
        root.addEventListener("input", schedule);
        document.fonts?.addEventListener?.("loadingdone", schedule);
        document.fonts?.ready?.then(schedule);
        schedule();
        return () => {
            active = false;
            if (frame !== null) cancelAnimationFrame(frame);
            observer?.disconnect();
            window.removeEventListener("resize", schedule);
            root.removeEventListener("input", schedule);
            document.fonts?.removeEventListener?.("loadingdone", schedule);
        };
    }

    window.SurveyChoiceLayout = Object.freeze({ normalize, columnsFor, mount });
})();
