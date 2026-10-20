(function () {
    "use strict";
    function excluded(question) {
        return question.type === "notice" || question.settings?.excludeFromNumbering === true;
    }
    function numbers(sections) {
        const result = new Map();
        let number = 0;
        (sections || []).forEach(section => (section.questions || []).forEach(question => {
            result.set(String(question.id), excluded(question) ? null : ++number);
        }));
        return result;
    }
    function title(question, settings, value) {
        const source = String(value || "");
        if (settings?.showQuestionNumbers === false || excluded(question)) return source;
        // Remove only an explicit question-number prefix; preserve years and decimals.
        return source.replace(/^\s*(?:[0-9]{1,3}[.)]\s+|\([0-9]{1,3}\)\s*)/u, "");
    }
    window.SurveyQuestionNumbering = Object.freeze({ excluded, numbers, title });
})();
