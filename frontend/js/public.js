(function () {
    "use strict";

    const PUBLIC_UI = Object.freeze({
        ko: {
            pageTitle: "설문 참여", skipToSurvey: "설문 본문 바로가기", safeSurvey: "안전한 온라인 설문", surveyLanguage: "설문 언어", surveyLanguageAria: "설문 표시 언어",
            loadingTitle: "설문을 불러오고 있습니다.", loadingMessage: "잠시만 기다려 주세요.", estimatedTimeLabel: "예상 소요", questionCountLabel: "문항 수", responseModeLabel: "응답 방식",
            validationTitle: "확인이 필요한 문항이 있습니다.", pagerAria: "문항 이동", previous: "이전", next: "다음", draftLocal: "이 탭에 임시 저장됩니다.", notSentBeforeSubmit: "제출 전에는 서버에 전송하지 않습니다.", submit: "응답 제출하기",
            invalidUrlTitle: "설문 주소가 올바르지 않습니다.", invalidUrlMessage: "전달받은 링크를 다시 확인해 주세요.", openFailedTitle: "설문을 열 수 없습니다.", descriptionFallback: "설문에 참여해 주세요.", scheduledTitle: "아직 설문 기간이 시작되지 않았습니다.", scheduledMessage: "{title} 설문은 {start}부터 참여할 수 있습니다. 시작 시간 이후 이 페이지를 새로고침해 주세요.", closedTitle: "설문 기간이 종료되었습니다.", closedMessage: "{title} 설문은 {end}에 종료되어 더 이상 응답을 제출할 수 없습니다.",
            languageChangeFailed: "언어를 바꾸지 못했습니다. {message}", retry: "다시 시도해 주세요.", languageChangeTitle: "설문 언어를 바꾸지 못했습니다.", languageChangeRefresh: "페이지를 새로 고침한 뒤 다시 시도해 주세요.",
            expiryPolicy: "운영 정책에 따른 만료 시각", expiryUnknown: "확인되지 않은 만료 시각", demoBanner: "체험용 설문 · {expiry}까지만 접근할 수 있습니다. 실제 개인정보를 입력하지 마세요.",
            minutes: "약 {count}분", questions: "{count}개", identified: "기명", anonymous: "익명", required: "필수", selectPlaceholder: "선택하세요", shortPlaceholder: "답변을 입력하세요", longPlaceholder: "의견을 자유롭게 입력하세요", numberPlaceholder: "숫자 입력",
            item: "항목", content: "내용", rowDefault: "1행", addRow: "＋ 행 추가", rowInputAria: "{number}행 {column}", rowDeleteAria: "{number}행 삭제", draftSaving: "임시 저장 중…", draftSaved: "이 탭에 임시 저장했습니다.", draftRestored: "이 탭에 저장된 답변을 복원했습니다.", draftUnavailable: "임시 저장을 사용할 수 없습니다.",
            requiredError: "필수 문항에 응답해 주세요.", emailError: "이메일 형식으로 입력해 주세요.", questionFallback: "문항", questionLink: "{number}번 {title}", pageStatus: "{current} / {total} 문항", requiredToast: "{number}번 필수 문항에 응답해 주세요.",
            submitting: "제출 중…", submitted: "응답을 제출했습니다.", thanks: "소중한 의견을 보내주셔서 감사합니다.", submitFailed: "응답을 제출하지 못했습니다.", home: "IN-SURVEYONE 홈", sectionDefault: "설문 문항", sectionNumber: "섹션 {number}", sectionLabel: "섹션", questionLabel: "문항"
        },
        en: {
            pageTitle: "Survey participation", skipToSurvey: "Skip to survey", safeSurvey: "Secure online survey", surveyLanguage: "Survey language", surveyLanguageAria: "Survey display language",
            loadingTitle: "Loading the survey.", loadingMessage: "Please wait a moment.", estimatedTimeLabel: "Estimated time", questionCountLabel: "Questions", responseModeLabel: "Response mode",
            validationTitle: "Some questions need your attention.", pagerAria: "Question navigation", previous: "Previous", next: "Next", draftLocal: "Your draft is saved in this tab.", notSentBeforeSubmit: "Nothing is sent to the server before submission.", submit: "Submit response",
            invalidUrlTitle: "This survey address is invalid.", invalidUrlMessage: "Please check the link you received.", openFailedTitle: "The survey could not be opened.", descriptionFallback: "Please take part in this survey.", scheduledTitle: "This survey has not started yet.", scheduledMessage: "{title} will open on {start}. Refresh this page after the start time.", closedTitle: "This survey has ended.", closedMessage: "{title} closed on {end} and no longer accepts responses.",
            languageChangeFailed: "The language could not be changed. {message}", retry: "Please try again.", languageChangeTitle: "The survey language could not be changed.", languageChangeRefresh: "Refresh the page and try again.",
            expiryPolicy: "the expiry time set by policy", expiryUnknown: "an unknown expiry time", demoBanner: "Demo survey · Available only until {expiry}. Do not enter real personal information.",
            minutes: "About {count} min", questions: "{count}", identified: "Identified", anonymous: "Anonymous", required: "Required", selectPlaceholder: "Select an option", shortPlaceholder: "Enter your answer", longPlaceholder: "Enter your comments", numberPlaceholder: "Enter a number",
            item: "Item", content: "Details", rowDefault: "Row 1", addRow: "＋ Add row", rowInputAria: "Row {number}, {column}", rowDeleteAria: "Delete row {number}", draftSaving: "Saving draft…", draftSaved: "Draft saved in this tab.", draftRestored: "Your saved answers were restored in this tab.", draftUnavailable: "Draft saving is unavailable.",
            requiredError: "Please answer this required question.", emailError: "Enter a valid email address.", questionFallback: "Question", questionLink: "Question {number}: {title}", pageStatus: "Question {current} of {total}", requiredToast: "Please answer required question {number}.",
            submitting: "Submitting…", submitted: "Your response was submitted.", thanks: "Thank you for sharing your feedback.", submitFailed: "Your response could not be submitted.", home: "IN-SURVEYONE home", sectionDefault: "Survey questions", sectionNumber: "Section {number}", sectionLabel: "Section", questionLabel: "Question"
        },
        ja: {
            pageTitle: "アンケートに回答", skipToSurvey: "アンケート本文へ移動", safeSurvey: "安全なオンラインアンケート", surveyLanguage: "アンケート言語", surveyLanguageAria: "アンケートの表示言語",
            loadingTitle: "アンケートを読み込んでいます。", loadingMessage: "しばらくお待ちください。", estimatedTimeLabel: "所要時間", questionCountLabel: "設問数", responseModeLabel: "回答方式",
            validationTitle: "確認が必要な設問があります。", pagerAria: "設問の移動", previous: "前へ", next: "次へ", draftLocal: "このタブに一時保存されます。", notSentBeforeSubmit: "送信するまでサーバーには送られません。", submit: "回答を送信",
            invalidUrlTitle: "アンケートのURLが正しくありません。", invalidUrlMessage: "受け取ったリンクをもう一度確認してください。", openFailedTitle: "アンケートを開けません。", descriptionFallback: "アンケートにご協力ください。", scheduledTitle: "アンケート期間はまだ始まっていません。", scheduledMessage: "{title}は{start}から回答できます。開始時刻後にこのページを再読み込みしてください。", closedTitle: "アンケート期間は終了しました。", closedMessage: "{title}は{end}に終了したため、回答を送信できません。",
            languageChangeFailed: "言語を変更できませんでした。{message}", retry: "もう一度お試しください。", languageChangeTitle: "アンケートの言語を変更できませんでした。", languageChangeRefresh: "ページを再読み込みして、もう一度お試しください。",
            expiryPolicy: "運用ポリシーで定められた有効期限", expiryUnknown: "確認できない有効期限", demoBanner: "体験用アンケート · {expiry}まで利用できます。実際の個人情報は入力しないでください。",
            minutes: "約{count}分", questions: "{count}問", identified: "記名", anonymous: "匿名", required: "必須", selectPlaceholder: "選択してください", shortPlaceholder: "回答を入力してください", longPlaceholder: "ご意見を自由に入力してください", numberPlaceholder: "数値を入力",
            item: "項目", content: "内容", rowDefault: "1行目", addRow: "＋ 行を追加", rowInputAria: "{number}行目 {column}", rowDeleteAria: "{number}行目を削除", draftSaving: "一時保存中…", draftSaved: "このタブに一時保存しました。", draftRestored: "このタブに保存された回答を復元しました。", draftUnavailable: "一時保存を利用できません。",
            requiredError: "必須設問に回答してください。", emailError: "正しいメールアドレスを入力してください。", questionFallback: "設問", questionLink: "設問{number}: {title}", pageStatus: "{current} / {total}問", requiredToast: "必須設問{number}に回答してください。",
            submitting: "送信中…", submitted: "回答を送信しました。", thanks: "ご回答ありがとうございました。", submitFailed: "回答を送信できませんでした。", home: "IN-SURVEYONE ホーム", sectionDefault: "アンケート設問", sectionNumber: "セクション {number}", sectionLabel: "セクション", questionLabel: "設問"
        },
        zh: {
            pageTitle: "参与问卷", skipToSurvey: "跳到问卷正文", safeSurvey: "安全的在线问卷", surveyLanguage: "问卷语言", surveyLanguageAria: "问卷显示语言",
            loadingTitle: "正在加载问卷。", loadingMessage: "请稍候。", estimatedTimeLabel: "预计用时", questionCountLabel: "题目数", responseModeLabel: "答题方式",
            validationTitle: "有题目需要检查。", pagerAria: "题目导航", previous: "上一题", next: "下一题", draftLocal: "草稿将保存在此标签页。", notSentBeforeSubmit: "提交前不会发送到服务器。", submit: "提交答卷",
            invalidUrlTitle: "问卷地址无效。", invalidUrlMessage: "请重新检查您收到的链接。", openFailedTitle: "无法打开问卷。", descriptionFallback: "请参与本次问卷。", scheduledTitle: "问卷尚未开始。", scheduledMessage: "{title}将于{start}开始。请在开始时间后刷新此页面。", closedTitle: "问卷已结束。", closedMessage: "{title}已于{end}结束，无法继续提交答卷。",
            languageChangeFailed: "无法切换语言。{message}", retry: "请重试。", languageChangeTitle: "无法切换问卷语言。", languageChangeRefresh: "请刷新页面后重试。",
            expiryPolicy: "按运营政策设定的到期时间", expiryUnknown: "未知的到期时间", demoBanner: "体验问卷 · 仅可使用至{expiry}。请勿填写真实个人信息。",
            minutes: "约{count}分钟", questions: "{count}题", identified: "实名", anonymous: "匿名", required: "必填", selectPlaceholder: "请选择", shortPlaceholder: "请输入答案", longPlaceholder: "请自由填写意见", numberPlaceholder: "请输入数字",
            item: "项目", content: "内容", rowDefault: "第1行", addRow: "＋ 添加行", rowInputAria: "第{number}行 {column}", rowDeleteAria: "删除第{number}行", draftSaving: "正在保存草稿…", draftSaved: "草稿已保存在此标签页。", draftRestored: "已恢复此标签页保存的答案。", draftUnavailable: "无法保存草稿。",
            requiredError: "请回答此必填题。", emailError: "请输入有效的电子邮箱地址。", questionFallback: "题目", questionLink: "第{number}题：{title}", pageStatus: "第{current}题，共{total}题", requiredToast: "请回答第{number}道必填题。",
            submitting: "正在提交…", submitted: "答卷已提交。", thanks: "感谢您的宝贵意见。", submitFailed: "无法提交答卷。", home: "IN-SURVEYONE 首页", sectionDefault: "问卷题目", sectionNumber: "第{number}部分", sectionLabel: "部分", questionLabel: "题目"
        },
        vi: {
            pageTitle: "Tham gia khảo sát", skipToSurvey: "Đi đến nội dung khảo sát", safeSurvey: "Khảo sát trực tuyến an toàn", surveyLanguage: "Ngôn ngữ khảo sát", surveyLanguageAria: "Ngôn ngữ hiển thị khảo sát",
            loadingTitle: "Đang tải khảo sát.", loadingMessage: "Vui lòng chờ trong giây lát.", estimatedTimeLabel: "Thời gian dự kiến", questionCountLabel: "Số câu hỏi", responseModeLabel: "Hình thức trả lời",
            validationTitle: "Có câu hỏi cần được kiểm tra.", pagerAria: "Điều hướng câu hỏi", previous: "Trước", next: "Tiếp", draftLocal: "Bản nháp được lưu trong thẻ này.", notSentBeforeSubmit: "Dữ liệu chưa được gửi đến máy chủ trước khi nộp.", submit: "Gửi câu trả lời",
            invalidUrlTitle: "Địa chỉ khảo sát không hợp lệ.", invalidUrlMessage: "Vui lòng kiểm tra lại liên kết bạn nhận được.", openFailedTitle: "Không thể mở khảo sát.", descriptionFallback: "Vui lòng tham gia khảo sát này.", scheduledTitle: "Khảo sát chưa bắt đầu.", scheduledMessage: "{title} sẽ mở vào {start}. Hãy tải lại trang sau thời gian bắt đầu.", closedTitle: "Khảo sát đã kết thúc.", closedMessage: "{title} đã kết thúc vào {end} và không còn nhận phản hồi.",
            languageChangeFailed: "Không thể đổi ngôn ngữ. {message}", retry: "Vui lòng thử lại.", languageChangeTitle: "Không thể đổi ngôn ngữ khảo sát.", languageChangeRefresh: "Hãy tải lại trang rồi thử lại.",
            expiryPolicy: "thời điểm hết hạn theo chính sách", expiryUnknown: "thời điểm hết hạn chưa xác định", demoBanner: "Khảo sát dùng thử · Chỉ truy cập được đến {expiry}. Không nhập thông tin cá nhân thật.",
            minutes: "Khoảng {count} phút", questions: "{count} câu", identified: "Có danh tính", anonymous: "Ẩn danh", required: "Bắt buộc", selectPlaceholder: "Vui lòng chọn", shortPlaceholder: "Nhập câu trả lời", longPlaceholder: "Tự do nhập ý kiến", numberPlaceholder: "Nhập số",
            item: "Mục", content: "Nội dung", rowDefault: "Dòng 1", addRow: "＋ Thêm dòng", rowInputAria: "Dòng {number}, {column}", rowDeleteAria: "Xóa dòng {number}", draftSaving: "Đang lưu bản nháp…", draftSaved: "Đã lưu bản nháp trong thẻ này.", draftRestored: "Đã khôi phục câu trả lời lưu trong thẻ này.", draftUnavailable: "Không thể lưu bản nháp.",
            requiredError: "Vui lòng trả lời câu hỏi bắt buộc này.", emailError: "Vui lòng nhập địa chỉ email hợp lệ.", questionFallback: "Câu hỏi", questionLink: "Câu {number}: {title}", pageStatus: "Câu {current} / {total}", requiredToast: "Vui lòng trả lời câu bắt buộc số {number}.",
            submitting: "Đang gửi…", submitted: "Đã gửi câu trả lời.", thanks: "Cảm ơn bạn đã chia sẻ ý kiến.", submitFailed: "Không thể gửi câu trả lời.", home: "Trang chủ IN-SURVEYONE", sectionDefault: "Câu hỏi khảo sát", sectionNumber: "Phần {number}", sectionLabel: "Phần", questionLabel: "Câu"
        },
        fil: {
            pageTitle: "Pagsagot sa survey", skipToSurvey: "Pumunta sa survey", safeSurvey: "Ligtas na online survey", surveyLanguage: "Wika ng survey", surveyLanguageAria: "Wika ng pagpapakita ng survey",
            loadingTitle: "Nilo-load ang survey.", loadingMessage: "Mangyaring maghintay sandali.", estimatedTimeLabel: "Tinatayang oras", questionCountLabel: "Mga tanong", responseModeLabel: "Paraan ng pagsagot",
            validationTitle: "May mga tanong na kailangang suriin.", pagerAria: "Paglipat sa mga tanong", previous: "Nakaraan", next: "Susunod", draftLocal: "Naka-save ang draft sa tab na ito.", notSentBeforeSubmit: "Hindi ito ipapadala sa server bago isumite.", submit: "Isumite ang sagot",
            invalidUrlTitle: "Hindi wasto ang address ng survey.", invalidUrlMessage: "Pakisuring muli ang link na natanggap mo.", openFailedTitle: "Hindi mabuksan ang survey.", descriptionFallback: "Mangyaring lumahok sa survey na ito.", scheduledTitle: "Hindi pa nagsisimula ang survey.", scheduledMessage: "Magbubukas ang {title} sa {start}. I-refresh ang pahinang ito pagkatapos ng oras ng pagsisimula.", closedTitle: "Tapos na ang survey.", closedMessage: "Nagsara ang {title} noong {end} at hindi na tumatanggap ng mga sagot.",
            languageChangeFailed: "Hindi mapalitan ang wika. {message}", retry: "Pakisubukang muli.", languageChangeTitle: "Hindi mapalitan ang wika ng survey.", languageChangeRefresh: "I-refresh ang pahina at subukang muli.",
            expiryPolicy: "oras ng pag-expire ayon sa patakaran", expiryUnknown: "hindi matukoy na oras ng pag-expire", demoBanner: "Demo survey · Maa-access lamang hanggang {expiry}. Huwag maglagay ng totoong personal na impormasyon.",
            minutes: "Humigit-kumulang {count} min", questions: "{count}", identified: "May pangalan", anonymous: "Anonymous", required: "Kailangan", selectPlaceholder: "Pumili", shortPlaceholder: "Ilagay ang sagot", longPlaceholder: "Malayang ilagay ang iyong opinyon", numberPlaceholder: "Maglagay ng numero",
            item: "Item", content: "Nilalaman", rowDefault: "Hanay 1", addRow: "＋ Magdagdag ng hanay", rowInputAria: "Hanay {number}, {column}", rowDeleteAria: "Tanggalin ang hanay {number}", draftSaving: "Sine-save ang draft…", draftSaved: "Naka-save ang draft sa tab na ito.", draftRestored: "Naibalik ang mga sagot na naka-save sa tab na ito.", draftUnavailable: "Hindi magagamit ang pag-save ng draft.",
            requiredError: "Pakisagutan ang kinakailangang tanong na ito.", emailError: "Maglagay ng wastong email address.", questionFallback: "Tanong", questionLink: "Tanong {number}: {title}", pageStatus: "Tanong {current} sa {total}", requiredToast: "Pakisagutan ang kinakailangang tanong {number}.",
            submitting: "Isinusumite…", submitted: "Naisumite ang iyong sagot.", thanks: "Salamat sa pagbabahagi ng iyong opinyon.", submitFailed: "Hindi maisumite ang iyong sagot.", home: "Home ng IN-SURVEYONE", sectionDefault: "Mga tanong sa survey", sectionNumber: "Seksyon {number}", sectionLabel: "Seksyon", questionLabel: "Tanong"
        }
    });

    const PUBLIC_TYPE_LABELS = Object.freeze({
        ko: { single: "객관식", multiple: "복수응답", dropdown: "목록 선택", short_text: "단답형", long_text: "장문형", number: "숫자", scale: "척도", slider: "슬라이더", matrix_single: "매트릭스", matrix_multiple: "복수 매트릭스", table: "표", repeat_table: "반복표", date: "날짜", notice: "텍스트 안내" },
        en: { single: "Single choice", multiple: "Multiple choice", dropdown: "Dropdown", short_text: "Short answer", long_text: "Long answer", number: "Number", scale: "Scale", slider: "Slider", matrix_single: "Matrix", matrix_multiple: "Multiple matrix", table: "Table", repeat_table: "Repeat table", date: "Date", notice: "Information" },
        ja: { single: "単一選択", multiple: "複数選択", dropdown: "リスト選択", short_text: "短文回答", long_text: "長文回答", number: "数値", scale: "尺度", slider: "スライダー", matrix_single: "マトリクス", matrix_multiple: "複数マトリクス", table: "表", repeat_table: "繰り返し表", date: "日付", notice: "案内" },
        zh: { single: "单选", multiple: "多选", dropdown: "下拉选择", short_text: "简答", long_text: "长文本", number: "数字", scale: "量表", slider: "滑块", matrix_single: "矩阵", matrix_multiple: "多选矩阵", table: "表格", repeat_table: "重复表格", date: "日期", notice: "说明" },
        vi: { single: "Một lựa chọn", multiple: "Nhiều lựa chọn", dropdown: "Danh sách", short_text: "Câu trả lời ngắn", long_text: "Câu trả lời dài", number: "Số", scale: "Thang đo", slider: "Thanh trượt", matrix_single: "Ma trận", matrix_multiple: "Ma trận nhiều lựa chọn", table: "Bảng", repeat_table: "Bảng lặp", date: "Ngày", notice: "Thông tin" },
        fil: { single: "Isang pagpipilian", multiple: "Maramihang pagpipilian", dropdown: "Listahan", short_text: "Maikling sagot", long_text: "Mahabang sagot", number: "Numero", scale: "Iskala", slider: "Slider", matrix_single: "Matrix", matrix_multiple: "Multiple matrix", table: "Talahanayan", repeat_table: "Paulit-ulit na talahanayan", date: "Petsa", notice: "Impormasyon" }
    });

    const state = {
        survey: null,
        choiceLayoutCleanup: null,
        preview: false,
        slug: "",
        audienceCode: null,
        sections: [],
        questions: [],
        answers: {},
        saveTimer: null,
        respondentKey: null,
        languages: { sourceLocale: "ko", defaultLocale: "ko", enabled: ["ko"] },
        translations: {},
        locale: "ko",
        requestedLocale: "",
        idempotencyKey: null,
        activeQuestionIndex: 0,
        draftRestored: false
    };
    const dom = {};

    document.addEventListener("DOMContentLoaded", init);

    function uiLocale(value = state.locale) {
        const candidate = String(value || "").trim().replaceAll("_", "-").split("-")[0].toLowerCase();
        if (PUBLIC_UI[candidate]) return candidate;
        const defaultLocale = String(state.languages?.defaultLocale || "").split("-")[0].toLowerCase();
        return PUBLIC_UI[defaultLocale] ? defaultLocale : "ko";
    }

    function text(key, parameters = {}, locale = state.locale) {
        const selected = PUBLIC_UI[uiLocale(locale)];
        const fallback = PUBLIC_UI.ko;
        const value = selected?.[key] ?? fallback[key] ?? key;
        return String(value).replace(/\{([A-Za-z0-9_]+)\}/g, (match, name) => parameters[name] == null ? match : String(parameters[name]));
    }

    function applyShellTranslations() {
        const locale = uiLocale();
        document.documentElement.lang = state.locale || locale;
        document.querySelectorAll("[data-public-i18n]").forEach((element) => {
            element.textContent = text(element.dataset.publicI18n);
        });
        document.querySelectorAll("[data-public-i18n-aria-label]").forEach((element) => {
            element.setAttribute("aria-label", text(element.dataset.publicI18nAriaLabel));
        });
        if (!state.survey) {
            document.title = `${text("pageTitle")} | IN-SURVEYONE`;
            const organization = document.querySelector("[data-public-organization]");
            if (organization) organization.textContent = text("safeSurvey");
        }
    }

    async function init() {
        cacheDom();
        state.requestedLocale = preferredLanguage();
        state.locale = uiLocale(state.requestedLocale);
        applyShellTranslations();
        if (new URLSearchParams(location.search).get("preview") === "1") { bind(); initializePreview(); return; }
        state.slug = decodeURIComponent(location.pathname.split("/").filter(Boolean).pop() || new URLSearchParams(location.search).get("slug") || "");
        if (!state.slug) return showState("!", text("invalidUrlTitle"), text("invalidUrlMessage"));
        bind();
        try {
            let payload = await Common.api.get(publicSurveyPath(state.requestedLocale));
            state.survey = payload.survey || payload;
            normalizeSurvey();
            const servedLocale = localeCode(state.survey.requestedLocale || state.survey.requested_locale, null, null);
            if (state.locale && (!servedLocale || servedLocale.toLowerCase() !== state.locale.toLowerCase())) {
                payload = await Common.api.get(publicSurveyPath(state.locale));
                state.survey = payload.survey || payload;
                normalizeSurvey();
            }
            restoreDraft();
            render();
        } catch (error) {
            showState("!", text("openFailedTitle"), error.message);
        }
    }


    function initializePreview() {
        const token = new URLSearchParams(location.search).get("previewToken");
        if (window.parent === window || !token || !/^[a-f0-9-]{36}$/i.test(token)) return showState("!", "미리보기를 열 수 없습니다.", "제작기의 미리보기 버튼을 사용해 주세요.");
        state.preview = true;
        let received = false;
        window.addEventListener("message", (event) => {
            if (received || event.source !== window.parent || event.origin !== location.origin || event.data?.type !== "surveyone-preview-draft" || event.data.token !== token) return;
            if (!event.data.draft || !Array.isArray(event.data.draft.sections)) return;
            received = true;
            state.survey = event.data.draft;
            state.requestedLocale = event.data.locale || "ko";
            state.answers = {};
            normalizeSurvey();
            render();
        });
        window.parent.postMessage({ type: "surveyone-preview-ready", token }, location.origin);
    }

    function emitCustomEvent(type, detail) {
        const frame = document.querySelector("[data-public-custom-code]");
        if (frame?.dataset.enabled === "true") window.SurveyCodeEditor.sendEvent?.(frame, type, detail);
    }

    function preferredLanguage() {
        const query = new URLSearchParams(location.search).get("lang");
        if (query && query.trim()) return query.trim();
        return (navigator.languages || [navigator.language]).find((locale) => typeof locale === "string" && locale.trim()) || "";
    }

    function cacheDom() {
        dom.loading = document.querySelector("[data-public-loading]");
        dom.form = document.querySelector("[data-public-form]");
        dom.list = document.querySelector("[data-public-question-list]");
        dom.state = document.querySelector("[data-public-state]");
        dom.progress = document.querySelector("[data-public-progress]");
        dom.saveState = document.querySelector("[data-public-save-state]");
        dom.summary = document.querySelector("[data-validation-summary]");
        dom.pager = document.querySelector("[data-public-pager]");
        dom.previous = document.querySelector("[data-public-previous]");
        dom.next = document.querySelector("[data-public-next]");
        dom.pageStatus = document.querySelector("[data-public-page-status]");
        dom.toastStack = document.querySelector("[data-public-toast-stack]");
        dom.language = document.querySelector("[data-public-language]");
        dom.languageWrap = document.querySelector("[data-public-language-wrap]");
        dom.demoBanner = document.querySelector("[data-public-demo-banner]");
    }

    function bind() {
        dom.form.addEventListener("input", onInput);
        dom.form.addEventListener("change", onInput);
        dom.form.addEventListener("click", onClick);
        dom.toastStack.addEventListener("click", onClick);
        dom.form.addEventListener("pointerup", (event) => {
            if (event.target.matches("[data-slider]")) onInput(event);
        });
        dom.form.addEventListener("submit", submit);
        dom.form.addEventListener("keyup", (event) => {
            if (event.target.matches("[data-slider]") && ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End", "PageUp", "PageDown"].includes(event.key)) onInput(event);
        });
        dom.form.addEventListener("keydown", (event) => {
            if (event.target.matches("[data-slider]") && ["Enter", " "].includes(event.key)) { event.preventDefault(); onInput(event); return; }
            if (state.preview && event.key === "Enter" && !event.isComposing && event.target.matches("input:not([type=search])")) submit(event);
        });
        dom.language.addEventListener("change", changeLanguage);
        dom.previous.addEventListener("click", () => moveQuestionPage(-1));
        dom.next.addEventListener("click", () => moveQuestionPage(1));
        window.addEventListener("scroll", updateProgress, { passive: true });
    }

    function publicSurveyPath(locale) {
        const params = new URLSearchParams();
        if (locale) params.set("lang", locale);
        const audience = new URLSearchParams(location.search).get("audience");
        if (audience !== null) params.set("audience", audience);
        return `/api/public/surveys/${encodeURIComponent(state.slug)}?${params}`;
    }

    function draftStorageKey() {
        return `surveyone:draft:${state.slug}${state.audienceCode ? `:audience:${state.audienceCode}` : ""}`;
    }

    function normalizeSurvey() {
        normalizeLanguages();
        const flatQuestions = Array.isArray(state.survey.questions) ? state.survey.questions : [];
        state.sections = Array.isArray(state.survey.sections) && state.survey.sections.length
            ? state.survey.sections
            : [{ id: "section-default", title: text("sectionDefault"), description: "", questions: flatQuestions }];
        const routes = state.survey.settings?.audienceRoutes || [];
        state.audienceCode = state.survey.audienceCode ?? new URLSearchParams(location.search).get("audience") ?? state.survey.settings?.defaultAudience ?? null;
        if (state.audienceCode !== null) {
            const route = routes.find(item => item.code === state.audienceCode);
            if (!route) throw new Error(uiLocale() === "ko" ? "설문 대상 구분자가 올바르지 않습니다." : "Invalid survey audience.");
            state.sections = state.sections.filter(section => route.sectionIds.includes(section.id));
        }
        state.sections = state.sections.map((section, index) => ({
            ...section,
            id: section.id || `section-${index + 1}`,
            title: section.title || text("sectionNumber", { number: index + 1 }),
            questions: (Array.isArray(section.questions) ? section.questions : []).map((question) => {
                const behavior = question.behavior || (question.required ? "fixed_required" : "fixed_optional");
                return {
                    ...question,
                    behavior,
                    required: ["fixed_required", "dynamic_required"].includes(behavior),
                    activationCondition: question.activationCondition || question.activation_condition || null
                };
            })
        }));
        state.questions = state.sections.flatMap((section) => section.questions);
    }

    function localeCatalog() {
        const configured = window.SURVEYONE_CONFIG?.locales;
        const recommendations = Array.isArray(configured) && configured.length ? configured : [
            { code: "ko", label: "한국어", nativeLabel: "한국어" },
            { code: "en", label: "영어", nativeLabel: "English" },
            { code: "ja", label: "일본어", nativeLabel: "日本語" },
            { code: "zh", label: "중국어", nativeLabel: "中文" },
            { code: "vi", label: "베트남어", nativeLabel: "Tiếng Việt" },
            { code: "fil", label: "필리핀어", nativeLabel: "Filipino" }
        ];
        const result = recommendations.map((item) => ({ ...item, code: localeCode(item.code, null, item.code) }));
        [...(state.languages?.enabled || []), ...Object.keys(state.translations || {})].forEach((code) => {
            const canonical = localeCode(code, null, null);
            if (canonical && !result.some((item) => item.code.toLowerCase() === canonical.toLowerCase())) result.push({ code: canonical, label: canonical, nativeLabel: canonical });
        });
        return result;
    }

    function localeCode(value, supported = null, fallback = null) {
        const candidate = String(value || "").trim().replaceAll("_", "-");
        let canonical = null;
        try { canonical = Intl.getCanonicalLocales(candidate)[0] || null; } catch { canonical = null; }
        if (!canonical) return fallback;
        if (!supported) return canonical;
        return [...supported].find((code) => String(code).toLowerCase() === canonical.toLowerCase()) || fallback;
    }

    function resolveLocale(value, enabled) {
        const canonical = localeCode(value, null, null);
        if (!canonical) return null;
        const exact = enabled.find((code) => code.toLowerCase() === canonical.toLowerCase());
        if (exact) return exact;
        const base = canonical.split("-")[0].toLowerCase();
        return enabled.find((code) => code.toLowerCase() === base)
            || enabled.find((code) => code.split("-")[0].toLowerCase() === base)
            || null;
    }

    function normalizeLanguages() {
        const compatibility = state.survey.skin?.i18n || {};
        const raw = state.survey.languages || compatibility.languages || {
            sourceLocale: state.survey.defaultLocale || state.survey.default_locale || "ko",
            defaultLocale: state.survey.defaultLocale || state.survey.default_locale || "ko",
            enabled: state.survey.supportedLocales || state.survey.supported_locales || ["ko"]
        };
        const sourceLocale = localeCode(raw.sourceLocale || raw.source_locale || raw.source || "ko", null, "ko");
        const rawEnabled = Array.isArray(raw) ? raw : (raw.enabled || raw.locales || raw.codes || [sourceLocale]);
        const enabled = [...new Set(rawEnabled.filter((item) => typeof item === "string" || item?.enabled !== false)
            .map((item) => typeof item === "string" ? item : item?.code)
            .map((item) => localeCode(item, null, null)).filter(Boolean))];
        if (!enabled.includes(sourceLocale)) enabled.unshift(sourceLocale);
        const requestedDefault = localeCode(raw.defaultLocale || raw.default_locale || raw.default || sourceLocale, null, sourceLocale);
        const defaultLocale = resolveLocale(requestedDefault, enabled) || sourceLocale;
        state.languages = { sourceLocale, defaultLocale, enabled };
        const rawTranslations = state.survey.translations || compatibility.translations || {};
        const translations = Array.isArray(rawTranslations)
            ? Object.fromEntries(rawTranslations.map((item) => [item.locale || item.code, item.translations || item.content || item]).filter(([code]) => code))
            : (rawTranslations && typeof rawTranslations === "object" ? rawTranslations : {});
        state.translations = Object.fromEntries(Object.entries(translations).map(([locale, value]) => [localeCode(locale, null, null), value]).filter(([locale]) => locale));
        const requested = new URLSearchParams(location.search).get("lang");
        const preferences = [requested, ...(navigator.languages || [navigator.language]), defaultLocale, sourceLocale];
        state.locale = preferences.map((item) => resolveLocale(item, enabled)).find(Boolean) || sourceLocale;
    }

    function localeLabel(code) {
        const locale = localeCatalog().find((item) => item.code.toLowerCase() === String(code).toLowerCase());
        if (locale) return locale.nativeLabel || locale.label || code;
        const base = String(code).split("-")[0];
        const baseLocale = localeCatalog().find((item) => item.code === base);
        return baseLocale ? `${baseLocale.nativeLabel || baseLocale.label} (${code})` : code;
    }

    function translationBucket(locale = state.locale) {
        return locale === state.languages.sourceLocale ? null : state.translations[locale] || null;
    }

    function localizedValue(value, fallback = "") {
        return typeof value === "string" && value.trim() ? value : String(fallback ?? "");
    }

    function localizedTranslation(primary, defaultValue, source) {
        if (state.locale === state.languages.sourceLocale) return String(source ?? "");
        return localizedValue(primary, localizedValue(defaultValue, source));
    }

    function localizedSurveyField(field) {
        const base = field === "confirmationMessage" ? state.survey.settings?.confirmationMessage : state.survey[field];
        return localizedTranslation(translationBucket()?.[field], translationBucket(state.languages.defaultLocale)?.[field], base);
    }

    function localizedSectionField(section, field) {
        return localizedTranslation(
            translationBucket()?.sections?.[section.id]?.[field],
            translationBucket(state.languages.defaultLocale)?.sections?.[section.id]?.[field],
            section[field]
        );
    }

    function translatedQuestion(question, locale = state.locale) {
        if (!question) return null;
        const section = state.sections.find((item) => item.questions.some((candidate) => String(candidate.id) === String(question.id)));
        return section ? translationBucket(locale)?.sections?.[section.id]?.questions?.[question.id] : null;
    }

    function localizedQuestionField(question, field) {
        if (!question) return "";
        return localizedTranslation(
            translatedQuestion(question)?.[field],
            translatedQuestion(question, state.languages.defaultLocale)?.[field],
            question[field]
        );
    }

    function localizedOptionLabel(question, option) {
        return localizedTranslation(
            translatedQuestion(question)?.options?.[option.id],
            translatedQuestion(question, state.languages.defaultLocale)?.options?.[option.id],
            option.label
        );
    }

    function localizedIndexedLabel(question, field, index) {
        const stableKey = axisItemId(question, field, index);
        const current = translatedQuestion(question)?.[field];
        const fallback = translatedQuestion(question, state.languages.defaultLocale)?.[field];
        const defaultItems = field === "columns" ? [text("item"), text("content")] : [text("rowDefault")];
        return localizedTranslation(
            current?.[stableKey] ?? current?.[index],
            fallback?.[stableKey] ?? fallback?.[index],
            question[field]?.[index] ?? defaultItems[index] ?? ""
        );
    }

    function axisItemId(question, field, index) {
        return String(question.settings?.[field]?.[index]?.id ?? index);
    }

    function renderLanguageSelector() {
        document.documentElement.lang = state.locale;
        applyShellTranslations();
        dom.language.innerHTML = state.languages.enabled.map((code) => `<option value="${Common.escapeHtml(code)}" ${code === state.locale ? "selected" : ""}>${Common.escapeHtml(localeLabel(code))}</option>`).join("");
        dom.languageWrap.hidden = state.languages.enabled.length < 2;
    }

    function cloneSerializable(value) {
        if (typeof structuredClone === "function") return structuredClone(value);
        return JSON.parse(JSON.stringify(value));
    }

    function languageStateSnapshot() {
        return cloneSerializable({
            survey: state.survey,
            sections: state.sections,
            questions: state.questions,
            answers: state.answers,
            languages: state.languages,
            translations: state.translations,
            locale: state.locale,
            requestedLocale: state.requestedLocale,
            idempotencyKey: state.idempotencyKey,
            draftRestored: state.draftRestored
        });
    }

    function restoreLanguageState(snapshot) {
        Object.entries(snapshot).forEach(([key, value]) => { state[key] = value; });
    }

    async function changeLanguage(event) {
        const locale = event.target.value;
        if (!state.languages.enabled.includes(locale) || locale === state.locale) return;
        collectAnswers();
        if (state.preview) { state.locale = locale; state.requestedLocale = locale; render(); return; }
        const previousState = languageStateSnapshot();
        const previousUrl = `${location.pathname}${location.search}${location.hash}`;
        const url = new URL(location.href);
        url.searchParams.set("lang", locale);
        history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
        dom.language.disabled = true;
        try {
            const payload = await Common.api.get(publicSurveyPath(locale));
            state.survey = payload.survey || payload;
            normalizeSurvey();
            render();
            state.idempotencyKey = null;
        } catch (error) {
            restoreLanguageState(previousState);
            history.replaceState(null, "", previousUrl);
            try {
                render();
                dom.saveState.textContent = text("languageChangeFailed", { message: error?.message || text("retry") });
            } catch {
                showState("!", text("languageChangeTitle"), text("languageChangeRefresh"));
            }
        } finally {
            dom.language.disabled = false;
            dom.language.focus({ preventScroll: true });
        }
    }

    function formatExperienceExpiry(value) {
        if (!value) return text("expiryPolicy");
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) return text("expiryUnknown");
        try {
            return new Intl.DateTimeFormat(state.locale, { dateStyle: "medium", timeStyle: "short" }).format(date);
        } catch {
            return text("expiryUnknown");
        }
    }

    function formatSurveyBoundary(value) {
        const date = new Date(value || "");
        if (Number.isNaN(date.getTime())) return "-";
        try {
            return new Intl.DateTimeFormat(state.locale, {
                year: "numeric",
                month: "long",
                day: "numeric",
                hour: "2-digit",
                minute: "2-digit",
                timeZone: "Asia/Seoul",
                timeZoneName: "short"
            }).format(date);
        } catch {
            return date.toLocaleString();
        }
    }

    function renderAvailabilityState() {
        const status = String(state.survey.availabilityStatus || state.survey.availability_status || "OPEN").toUpperCase();
        const title = localizedSurveyField("title");
        if (status === "SCHEDULED") {
            showState("◷", text("scheduledTitle"), text("scheduledMessage", {
                title,
                start: formatSurveyBoundary(setting("startsAt", "starts_at", null))
            }));
            return true;
        }
        if (status === "CLOSED") {
            showState("■", text("closedTitle"), text("closedMessage", {
                title,
                end: formatSurveyBoundary(setting("closesAt", "closes_at", null))
            }));
            return true;
        }
        return false;
    }

    function render() {
        applySkin();
        renderLanguageSelector();
        dom.state.hidden = true;
        document.title = `${localizedSurveyField("title")} | IN-SURVEYONE`;
        document.querySelector("[data-public-organization]").textContent = state.survey.organizationName || state.survey.tenantName || text("safeSurvey");
        if (!state.preview && renderAvailabilityState()) return;
        document.querySelector("[data-public-category]").textContent = (state.survey.category || "ONLINE SURVEY").toUpperCase();
        document.querySelector("[data-public-title]").textContent = localizedSurveyField("title");
        document.querySelector("[data-public-description]").textContent = localizedSurveyField("description") || text("descriptionFallback");
        const guestDemo = Boolean(state.survey.guestDemo ?? state.survey.guest_demo);
        const expiresAt = state.survey.experienceExpiresAt || state.survey.experience_expires_at;
        dom.demoBanner.hidden = !guestDemo && !state.preview;
        if (guestDemo) {
            const expires = formatExperienceExpiry(expiresAt);
            dom.demoBanner.textContent = text("demoBanner", { expiry: expires });
        }
        if (state.preview) dom.demoBanner.textContent = "미리보기 · 현재 초안입니다. 입력 내용은 저장하거나 제출하지 않습니다.";
        const answerableQuestions = state.questions.filter((item) => item.type !== "notice");
        document.querySelector("[data-public-time]").textContent = text("minutes", { count: Math.max(1, Math.ceil(answerableQuestions.length * .35)) });
        document.querySelector("[data-public-count]").textContent = text("questions", { count: answerableQuestions.length });
        document.querySelector("[data-public-mode]").textContent = state.survey.settings?.anonymous === false ? text("identified") : text("anonymous");
        document.querySelector("[data-public-notice]").hidden = true;

        state.questionNumbers = window.SurveyQuestionNumbering.numbers(state.sections);
        let questionIndex = 0;
        dom.list.innerHTML = state.sections.map((section, sectionIndex) => {
            const result = sectionMarkup(section, sectionIndex, questionIndex);
            questionIndex += section.questions.filter((question) => question.type !== "notice").length;
            return result;
        }).join("");
        renderCustomCode();

        const showProgress = setting("showProgressBar", "showProgress", true);
        document.querySelector(".public-progress").hidden = !showProgress;
        populateDraft();
        if (state.draftRestored) dom.saveState.textContent = text("draftRestored");
        collectAnswers();
        applyLogic();
        updatePresentation();
        dom.loading.hidden = true;
        dom.form.hidden = false;
        state.choiceLayoutCleanup?.();
        state.choiceLayoutCleanup = window.SurveyChoiceLayout?.mount(dom.list);
        document.querySelector("#surveyMain").focus({ preventScroll: true });
        updateProgress();
        if (state.preview) {
            dom.saveState.textContent = "미리보기 응답은 저장되지 않습니다.";
            const button = dom.form.querySelector(".public-submit");
            button.type = "button";
            button.textContent = "입력 동작 확인";
        }
    }

    function applySkin() {
        const skin = state.survey.skin || {};
        const preset = window.SURVEYONE_CONFIG.skinPresets.find((item) => item.code === skin.preset) || {};
        const root = document.documentElement;
        const safeColor = (value, fallback) => /^#[0-9a-f]{6}$/i.test(String(value || "")) ? String(value) : fallback;
        const safeRadius = /^(?:0|[1-9][0-9]?)px$/.test(String(skin.radius || "")) ? String(skin.radius) : (preset.radius || "18px");
        root.style.setProperty("--survey-primary", safeColor(skin.primary, preset.primary || "#2457d6"));
        root.style.setProperty("--survey-accent", safeColor(skin.accent, preset.accent || "#4ed7bd"));
        root.style.setProperty("--survey-surface", safeColor(skin.surface, preset.surface || "#f3f7ff"));
        root.style.setProperty("--survey-radius", safeRadius);
        if (skin.font === "serif") root.style.setProperty("--survey-font", '"Batang",serif');
        document.body.classList.toggle("high-contrast", Boolean(skin.highContrast));
        const image = document.querySelector("[data-public-cover-image]");
        const headerImage = safeAssetUrl(skin.headerImageUrl);
        image.classList.toggle("has-image", Boolean(headerImage));
        image.style.backgroundImage = "";
        if (headerImage) {
            image.classList.add("has-image");
            image.style.backgroundImage = `linear-gradient(90deg,rgba(7,22,45,.25),rgba(7,22,45,0)),url("${headerImage}")`;
        }
    }

    function splitSelectorList(value) {
        const selectors = [];
        let start = 0;
        let depth = 0;
        let quote = "";
        for (let index = 0; index < value.length; index += 1) {
            const character = value[index];
            if (quote) {
                if (character === quote && value[index - 1] !== "\\") quote = "";
                continue;
            }
            if (character === '"' || character === "'") quote = character;
            else if (character === "(" || character === "[") depth += 1;
            else if (character === ")" || character === "]") depth = Math.max(0, depth - 1);
            else if (character === "," && depth === 0) { selectors.push(value.slice(start, index)); start = index + 1; }
        }
        selectors.push(value.slice(start));
        return selectors.map((item) => item.trim()).filter(Boolean);
    }

    function scopedCustomCss(source) {
        const value = String(source || "");
        if (!value.trim() || /@import|expression\s*\(|behavior\s*:|-moz-binding|javascript\s*:|position\s*:\s*fixed|url\s*\(/i.test(value)) return "";
        try {
            const sheet = new CSSStyleSheet();
            sheet.replaceSync(value);
            const serialize = (rules) => [...rules].map((rule) => {
                if (rule.type === CSSRule.STYLE_RULE) {
                    const selector = splitSelectorList(rule.selectorText).map((item) => item.includes(":scope") ? item.replaceAll(":scope", ".public-form") : `.public-form ${item}`).join(",");
                    return selector ? `${selector}{${rule.style.cssText}}` : "";
                }
                if (rule.type === CSSRule.MEDIA_RULE) return `@media ${rule.conditionText}{${serialize(rule.cssRules)}}`;
                if (rule.type === CSSRule.SUPPORTS_RULE) return `@supports ${rule.conditionText}{${serialize(rule.cssRules)}}`;
                if (rule.type === CSSRule.KEYFRAMES_RULE) return rule.cssText;
                return "";
            }).join("");
            return serialize(sheet.cssRules);
        } catch {
            return "";
        }
    }

    function renderCustomCode() {
        const frame = document.querySelector("[data-public-custom-code]");
        let style = document.querySelector("[data-public-custom-style]");
        if (!style) {
            style = document.createElement("style");
            style.dataset.publicCustomStyle = "";
            document.head.append(style);
        }
        const source = window.SurveyCodeEditor.normalize(state.survey.skin?.customCode);
        style.textContent = source.enabled ? scopedCustomCss(source.css) : "";
        frame.hidden = true;
        frame.dataset.enabled = "false";
        frame.removeAttribute("srcdoc");
        if (!source.enabled || (!source.html.trim() && !source.javascript.trim())) return;
        frame.dataset.enabled = "true";
        frame.dataset.placement = source.placement;
        if (source.placement === "afterQuestions") dom.list.after(frame); else dom.list.before(frame);
        frame.onload = () => emitCustomEvent("load", { survey: { title: localizedSurveyField("title"), language: state.locale }, mode: state.preview ? "preview" : "public" });
        frame.srcdoc = window.SurveyCodeEditor.sandboxDocument(source);
        frame.hidden = false;
        if (!state.customMessageHandler) {
            state.customMessageHandler = (event) => {
                const currentFrame = document.querySelector("[data-public-custom-code]");
                if (event.source !== currentFrame?.contentWindow || event.data?.type !== "surveyone-custom-resize") return;
                const height = Math.max(80, Math.min(1600, Number(event.data.height) || 100));
                currentFrame.style.height = `${height}px`;
            };
            window.addEventListener("message", state.customMessageHandler);
        }
    }

    function safeAssetUrl(value) {
        if (!value) return "";
        try {
            const candidate = new URL(String(value), location.origin);
            if (candidate.origin !== location.origin) return "";
            if (!["/frontend/assets/", "/uploads/"].some((prefix) => candidate.pathname.startsWith(prefix))) return "";
            return candidate.href.replace(/["\\\n\r]/g, "");
        } catch {
            return "";
        }
    }

    function sectionMarkup(section, sectionIndex, questionOffset) {
        let localIndex = 0;
        const content = section.questions.map((question) => {
            if (question.type === "notice") return noticeMarkup(question);
            const markup = questionMarkup(question, questionOffset + localIndex);
            localIndex += 1;
            return markup;
        }).join("");
        const sectionDescription = localizedSectionField(section, "description");
        const description = sectionDescription ? `<p class="public-section-description">${Common.escapeHtml(sectionDescription)}</p>` : "";
        return `<fieldset class="public-section" data-section-id="${Common.escapeHtml(section.id)}"><legend><span>${Common.escapeHtml(text("sectionLabel").toUpperCase())} ${String(sectionIndex + 1).padStart(2, "0")}</span><strong>${Common.escapeHtml(localizedSectionField(section, "title"))}</strong></legend>${description}<div class="public-section-questions">${content}</div></fieldset>`;
    }

    function noticeMarkup(question) {
        const content = question.settings?.contentHtml ? window.SurveyContent.render(question.settings.contentHtml) : `<p>${Common.escapeHtml(localizedQuestionField(question, "description"))}</p>`;
        return `<aside class="public-notice survey-document" role="note"><h2>${Common.escapeHtml(localizedQuestionField(question, "title"))}</h2>${content}</aside>`;
    }

    function questionMarkup(question, index) {
        const token = domToken(question.id, index);
        const titleId = `question-title-${token}`;
        const helpId = `question-help-${token}`;
        const errorId = `question-error-${token}`;
        const title = window.SurveyQuestionNumbering.title(question, state.survey.settings, localizedQuestionField(question, "title"));
        const help = localizedQuestionField(question, "description");
        const describedBy = `${help ? `${helpId} ` : ""}${errorId}`;
        const behavior = question.behavior || (question.required ? "fixed_required" : "fixed_optional");
        const numbered = state.survey.settings?.showQuestionNumbers !== false && !window.SurveyQuestionNumbering.excluded(question);
        const number = state.questionNumbers?.has(String(question.id)) ? state.questionNumbers.get(String(question.id)) : index + 1;
        return `<section id="question-${token}" class="public-question-card" data-question-id="${Common.escapeHtml(question.id)}" data-question-number="${numbered ? number : ""}" data-question-behavior="${Common.escapeHtml(behavior)}" tabindex="-1" aria-labelledby="${titleId}"><div class="question-number"><span>${Common.escapeHtml(text("questionLabel").toUpperCase())}${numbered ? ` ${String(number).padStart(2, "0")}` : ""}</span><span>${Common.escapeHtml(typeLabel(question.type))}</span></div><h2 id="${titleId}">${numbered ? `${number}. ` : ""}${Common.escapeHtml(title)} ${question.required ? `<span class="required-mark" aria-label="${Common.escapeHtml(text("required"))}">*</span>` : ""}</h2>${help ? `<p id="${helpId}" class="question-help">${Common.escapeHtml(help)}</p>` : ""}<div class="public-answer">${answerMarkup(question, { titleId, describedBy })}</div><p id="${errorId}" class="question-error" role="alert" aria-live="polite" hidden></p></section>`;
    }

    function typeLabel(type) {
        return PUBLIC_TYPE_LABELS[uiLocale()]?.[type]
            || PUBLIC_TYPE_LABELS.ko[type]
            || window.SURVEYONE_CONFIG?.questionTypes?.find((item) => item.code === type)?.label
            || type;
    }

    function answerMarkup(question, ids) {
        const name = `q_${question.id}`;
        const aria = `aria-labelledby="${ids.titleId}" aria-describedby="${ids.describedBy}"`;
        if (question.type === "multiple" && question.settings?.choiceInput === "codes") return codedChoiceMarkup(question, aria);
        if (question.type === "single" || question.type === "multiple") {
            const inputType = question.type === "multiple" ? "checkbox" : "radio";
            const layout = window.SurveyChoiceLayout?.normalize(question.settings?.choiceLayout) || "vertical";
            const choices = (question.options || []).map((option) => `<label class="public-choice" data-choice-item><input type="${inputType}" name="${Common.escapeHtml(name)}" value="${Common.escapeHtml(option.id)}" ${aria}><span data-choice-label>${Common.escapeHtml(localizedOptionLabel(question, option))}</span></label>`).join("");
            return `${choiceSearchMarkup(question)}<fieldset class="public-answer-group public-choice-options" data-choice-layout="${layout}" ${aria}><legend class="public-visually-hidden">${Common.escapeHtml(localizedQuestionField(question, "title"))}</legend>${choices}</fieldset>`;
        }
        if (question.type === "dropdown") return `${choiceSearchMarkup(question)}<select name="${Common.escapeHtml(name)}" ${aria}><option value="">${Common.escapeHtml(text("selectPlaceholder"))}</option>${(question.options || []).map((option) => `<option value="${Common.escapeHtml(option.id)}">${Common.escapeHtml(localizedOptionLabel(question, option))}</option>`).join("")}</select>`;
        if (question.type === "short_text") return `<input type="text" name="${Common.escapeHtml(name)}" placeholder="${Common.escapeHtml(text("shortPlaceholder"))}" ${aria}>`;
        if (question.type === "long_text") return `<textarea name="${Common.escapeHtml(name)}" placeholder="${Common.escapeHtml(text("longPlaceholder"))}" ${aria}></textarea>`;
        if (question.type === "number") return `<label class="input-with-unit"><input type="number" name="${Common.escapeHtml(name)}" min="${question.min ?? ""}" max="${question.max ?? ""}" placeholder="${Common.escapeHtml(text("numberPlaceholder"))}" ${aria}><span>${Common.escapeHtml(localizedQuestionField(question, "unit"))}</span></label>`;
        if (question.type === "date") return `<input type="date" name="${Common.escapeHtml(name)}" ${aria}>`;
        if (question.type === "scale" && question.settings?.scaleDisplay === "slider") return ratingMarkup(question, name, aria);
        if (question.type === "scale") {
            const minimum = Number(question.min ?? 1);
            const maximum = Number(question.max ?? 5);
            const count = Math.min(11, Math.max(2, maximum - minimum + 1));
            const descending = question.settings?.scaleOrder === "descending";
            const values = Array.from({ length: count }, (_, index) => minimum + index);
            if (descending) values.reverse();
            const choices = values.map((value) => `<label><input type="radio" name="${Common.escapeHtml(name)}" value="${value}" ${aria}><span>${value}</span></label>`).join("");
            return `<fieldset class="public-answer-group" ${aria}><legend class="public-visually-hidden">${Common.escapeHtml(localizedQuestionField(question, "title"))}</legend><div class="public-scale" style="--scale-count:${count}">${choices}</div><div class="scale-labels"><span>${Common.escapeHtml(localizedQuestionField(question, descending ? "maxLabel" : "minLabel"))}</span><span>${Common.escapeHtml(localizedQuestionField(question, descending ? "minLabel" : "maxLabel"))}</span></div></fieldset>`;
        }
        if (question.type === "slider") return ratingMarkup(question, name, aria);
        if (["matrix_single", "matrix_multiple"].includes(question.type)) return matrixMarkup(question, name, aria);
        if (question.type === "table") return fixedTableMarkup(question, name, aria);
        if (question.type === "repeat_table") return repeatTableMarkup(question, name, aria);
        return `<input type="text" name="${Common.escapeHtml(name)}" placeholder="${Common.escapeHtml(text("shortPlaceholder"))}" ${aria}>`;
    }


    const RATING_COPY = {
        ko: { selected: "선택한 점수", empty: "미응답", direct: "점수 직접 선택", clear: "선택 지우기", hint: "선 위의 동그라미를 누르거나 손잡이를 움직여 점수를 선택해 주세요." },
        en: { selected: "Selected score", empty: "Not answered", direct: "Choose a score", clear: "Clear selection", hint: "Tap a circle on the line or drag the handle to choose a score." },
        ja: { selected: "選択した点数", empty: "未回答", direct: "点数を選択", clear: "選択をクリア", hint: "線上の丸を押すか、つまみを動かして点数を選んでください。" },
        zh: { selected: "所选分数", empty: "未作答", direct: "直接选择分数", clear: "清除选择", hint: "点击线上的圆点或拖动滑块选择分数。" },
        vi: { selected: "Điểm đã chọn", empty: "Chưa trả lời", direct: "Chọn điểm", clear: "Xóa lựa chọn", hint: "Chạm vào vòng tròn trên thanh hoặc kéo nút để chọn điểm." },
        fil: { selected: "Napiling puntos", empty: "Walang sagot", direct: "Pumili ng puntos", clear: "Alisin ang pinili", hint: "Pindutin ang bilog sa linya o i-drag ang hawakan upang pumili ng puntos." }
    };

    function ratingCopy() { return RATING_COPY[uiLocale()] || RATING_COPY.ko; }

    function ratingMarkup(question, name, aria) {
        const discrete = question.type === "scale";
        const minimum = Number(question.min ?? (discrete ? 1 : 0));
        const maximum = Number(question.max ?? (discrete ? 5 : 100));
        const step = discrete ? 1 : Number(question.settings?.step || 1);
        const descending = question.settings?.scaleOrder === "descending";
        const values = discrete ? Array.from({length: maximum - minimum + 1}, (_, i) => minimum + i) : [minimum, maximum];
        if (descending) values.reverse();
        const intervals = Math.floor((maximum - minimum) / step + 1e-9);
        const stopCount = Math.min(intervals + 1, 11);
        const stops = Array.from({ length: stopCount }, (_, i) => Number((minimum + Math.round(i * intervals / Math.max(1, stopCount - 1)) * step).toFixed(8)));
        if (descending) stops.reverse();
        const position = value => `${Number(((descending ? maximum - value : value - minimum) / (maximum - minimum || 1) * 100).toFixed(6))}%`;
        const ticks = discrete ? stops : values;
        const copy = ratingCopy(), token = `rating-${domToken(question.id, 0)}`;
        const escape = Common.escapeHtml;
        const directAria = aria.replace(/aria-labelledby="([^"]*)"/, (_, ids) => `aria-labelledby="${ids} ${token}-label"`);
        const rangeAria = aria.replace(/aria-describedby="([^"]*)"/, (_, ids) => `aria-describedby="${ids} ${token}-start ${token}-end ${token}-hint"`);
        const control = discrete
            ? `<select name="${escape(name)}" data-rating-input ${directAria}><option value="">${escape(copy.empty)}</option>${values.map(value => `<option value="${value}">${value}${value === minimum && question.minLabel ? ` · ${escape(localizedQuestionField(question, "minLabel"))}` : value === maximum && question.maxLabel ? ` · ${escape(localizedQuestionField(question, "maxLabel"))}` : ""}</option>`).join("")}</select>`
            : `<input type="number" name="${escape(name)}" min="${minimum}" max="${maximum}" step="${step}" inputmode="decimal" placeholder="${minimum}–${maximum}" data-rating-input ${directAria}>`;
        return `<div class="slider-answer is-unanswered" data-rating><div class="rating-track"><div class="scale-labels rating-endpoints"><span id="${token}-start"><b>${descending ? maximum : minimum}</b><span>${escape(localizedQuestionField(question, descending ? "maxLabel" : "minLabel"))}</span></span><span id="${token}-end"><b>${descending ? minimum : maximum}</b><span>${escape(localizedQuestionField(question, descending ? "minLabel" : "maxLabel"))}</span></span></div><div class="rating-rail"><input type="range" min="${minimum}" max="${maximum}" step="${step}" value="${minimum}" dir="${descending ? "rtl" : "ltr"}" data-slider ${rangeAria} aria-valuetext="${escape(copy.empty)}"><div class="rating-stops" aria-hidden="true">${stops.map(value => `<span class="rating-stop" data-rating-stop="${value}" style="--rating-position:${position(value)}"></span>`).join("")}</div></div><div class="rating-ticks" aria-hidden="true">${ticks.map(value => `<span style="--rating-position:${position(value)}">${value}</span>`).join("")}</div></div><div class="rating-selection"><span>${escape(copy.selected)}</span><output class="slider-value" data-slider-value aria-live="polite">${escape(copy.empty)}</output></div><div class="rating-controls"><label><span id="${token}-label">${escape(copy.direct)}</span>${control}</label><button type="button" data-rating-clear disabled>${escape(copy.clear)}</button></div><p id="${token}-hint" class="rating-hint">${escape(copy.hint)}</p></div>`;
    }

    function updateRating(card) {
        const group = card?.querySelector("[data-rating]");
        if (!group) return;
        const input = group.querySelector("[data-rating-input]"), range = group.querySelector("[data-slider]");
        const answered = input.value !== "" && Number.isFinite(Number(input.value));
        const current = question(card.dataset.questionId);
        const endpoint = Number(input.value) === Number(range.min) ? localizedQuestionField(current, "minLabel") : Number(input.value) === Number(range.max) ? localizedQuestionField(current, "maxLabel") : "";
        const valueText = answered ? `${input.value}${localizedQuestionField(current, "unit")}${endpoint ? ` · ${endpoint}` : ""}` : ratingCopy().empty;
        if (answered) range.value = input.value;
        else range.value = range.min;
        range.setAttribute("aria-valuetext", valueText);
        const output = group.querySelector("[data-slider-value]");
        const scoreText = answered && current.type === "scale"
            ? `${input.value}${localizedQuestionField(current, "unit")} / ${range.max}${localizedQuestionField(current, "unit")}${endpoint ? ` · ${endpoint}` : ""}`
            : valueText;
        if (output.textContent !== scoreText) output.textContent = scoreText;
        group.querySelector("[data-rating-clear]").disabled = !answered;
        group.classList.toggle("is-unanswered", !answered);
        group.querySelectorAll(".rating-ticks span").forEach(tick => tick.classList.toggle("is-selected", answered && Number(tick.textContent) === Number(input.value)));
        group.querySelectorAll("[data-rating-stop]").forEach(stop => stop.classList.toggle("is-selected", answered && Number(stop.dataset.ratingStop) === Number(input.value)));
    }

    function choiceSearchMarkup(question) {
        if (!question.settings?.searchable) return "";
        const searchLabel = uiLocale() === "ko" ? "보기 검색" : "Search options";
        return `<label class="public-choice-search">${searchLabel}<input type="search" data-choice-search placeholder="${searchLabel}" autocomplete="off"></label><output class="public-choice-search-status" data-choice-search-status aria-live="polite"></output>`;
    }

    function filterChoiceOptions(card) {
        if (!card) return;
        const input = card.querySelector("[data-choice-search]");
        if (!input) return;
        const term = input.value.trim().toLocaleLowerCase();
        let visible = 0;
        const select = card.querySelector("select");
        if (select) {
            const item = question(card.dataset.questionId);
            const selected = select.value;
            const sourceValue = item.settings?.excludeSelectedFrom ? state.answers[item.settings.excludeSelectedFrom] : [];
            const excluded = new Set((Array.isArray(sourceValue) ? sourceValue : [sourceValue]).map(String));
            const options = (item.options || []).filter((option) => String(option.id) === selected || localizedOptionLabel(item, option).toLocaleLowerCase().includes(term));
            select.replaceChildren(new Option(text("selectPlaceholder"), ""));
            for (const option of options) {
                const node = new Option(localizedOptionLabel(item, option), option.id);
                node.disabled = excluded.has(String(option.id));
                select.append(node);
                if (!node.disabled) visible += 1;
            }
            select.value = selected;
        }
        card.querySelectorAll(".public-choice").forEach((element) => {
            const control = element.matches("option") ? element : element.querySelector("input");
            const selected = control.checked || control.selected;
            element.hidden = !selected && !element.textContent.toLocaleLowerCase().includes(term);
            if (!element.hidden && !control.disabled) visible += 1;
        });
        card.querySelector("[data-choice-search-status]").textContent = uiLocale() === "ko" ? `선택 가능한 보기 ${visible}개 · 선택한 보기는 검색 중에도 표시됩니다.` : `${visible} available options. Selected options stay visible.`;
    }

    function codeText(key) {
        const labels = {
            ko: { jump: "번호 입력칸으로 이동 ↓", legend: "보기 · 번호 범례", help: "아래 보기에서 번호를 확인한 뒤 입력하세요. 같은 번호는 한 번만 입력할 수 있습니다.", slot: "번호", empty: "선택할 번호 입력", invalid: "보기에 있는 번호를 입력해 주세요.", duplicate: "같은 번호를 중복 입력할 수 없습니다.", excluded: "선행 문항에서 선택한 항목은 입력할 수 없습니다.", blocked: "선택 제외" },
            en: { jump: "Go to number entry ↓", legend: "Reference · option numbers", help: "Find an option number below and enter it. Each number can be used only once.", slot: "Number", empty: "Enter an option number", invalid: "Enter a number from the reference.", duplicate: "Each number can be entered only once.", excluded: "This option was selected in the preceding question and is excluded.", blocked: "Excluded" }
        };
        return (labels[uiLocale()] || labels.en)[key];
    }

    function codedChoiceMarkup(question, aria) {
        const escapedId = Common.escapeHtml(question.id);
        const count = Math.min(20, Math.max(1, Number(question.settings.maxSelections || 5)));
        return `<fieldset class="coded-choice" ${aria}><legend class="public-visually-hidden">${Common.escapeHtml(localizedQuestionField(question, "title"))}</legend><p class="coded-choice-help">${codeText("help")}</p><a class="choice-code-jump" href="#code-${escapedId}-0">${codeText("jump")}</a><div class="choice-code-legend" role="group" aria-label="${codeText("legend")}"><strong>${codeText("legend")}</strong><ul>${(question.options || []).map(option => `<li data-code-option="${Common.escapeHtml(option.id)}"><b>(${Common.escapeHtml(option.code)})</b> <span>${Common.escapeHtml(localizedOptionLabel(question, option).replace(new RegExp(`^\\(${option.code}\\)\\s*`), ""))}</span><small data-code-excluded hidden>${codeText("blocked")}</small></li>`).join("")}</ul></div><div class="choice-code-inputs">${Array.from({length: count}, (_, index) => `<div class="choice-code-slot"><label for="code-${escapedId}-${index}">${codeText("slot")} ${index + 1}</label><input id="code-${escapedId}-${index}" type="text" inputmode="numeric" pattern="[0-9]*" maxlength="6" autocomplete="off" data-choice-code-input aria-describedby="code-status-${escapedId}-${index} ${aria.match(/aria-describedby="([^"]*)"/)?.[1] || ""}"><output id="code-status-${escapedId}-${index}" data-code-status aria-live="polite">${codeText("empty")}</output></div>`).join("")}</div></fieldset>`;
    }

    function codeEntries(card, item) {
        return [...card.querySelectorAll("[data-choice-code-input]")].map(input => {
            const raw = input.value.trim();
            const code = /^[0-9]{1,6}$/.test(raw) ? String(Number(raw)) : null;
            return { input, raw, option: (item.options || []).find(option => option.code === code) };
        });
    }

    function codeEntryError(entry, entries, item) {
        if (!entry.raw) return "";
        if (!entry.option) return codeText("invalid");
        const value = state.answers[item.settings?.excludeSelectedFrom];
        if ((Array.isArray(value) ? value : [value]).includes(entry.option.id)) return codeText("excluded");
        if (entries.filter(other => other.option?.id === entry.option.id).length > 1) return codeText("duplicate");
        return "";
    }

    function updateCodeInputs(card, item) {
        if (!card || item?.settings?.choiceInput !== "codes") return;
        const entries = codeEntries(card, item);
        entries.forEach(entry => {
            const error = codeEntryError(entry, entries, item);
            const status = entry.input.parentElement.querySelector("[data-code-status]");
            status.textContent = error || (entry.option ? localizedOptionLabel(item, entry.option) : codeText("empty"));
            status.classList.toggle("is-error", Boolean(error));
        });
    }

    function applyChoiceExclusions() {
        let cleared = false;
        state.questions.forEach((item) => {
            if (!["single", "multiple", "dropdown"].includes(item.type)) return;
            const card = dom.list.querySelector(`[data-question-id="${CSS.escape(String(item.id))}"]`);
            if (!isCardActive(card)) return;
            const source = item.settings?.excludeSelectedFrom;
            const value = source ? state.answers[source] : [];
            const excluded = new Set((Array.isArray(value) ? value : [value]).map(String));
            if (item.settings?.choiceInput === "codes") {
                const fingerprint = JSON.stringify([...excluded].sort());
                if (card.dataset.codeExclusions !== undefined && card.dataset.codeExclusions !== fingerprint) {
                    codeEntries(card, item).forEach(entry => {
                        if (entry.option && excluded.has(entry.option.id)) { entry.input.value = ""; cleared = true; }
                    });
                    state.answers[item.id] = codeEntries(card, item).filter(entry => entry.raw).map(entry => entry.option?.id || entry.raw);
                }
                card.dataset.codeExclusions = fingerprint;
                card.querySelectorAll("[data-code-option]").forEach(entry => {
                    const blocked = excluded.has(entry.dataset.codeOption);
                    entry.classList.toggle("is-excluded", blocked);
                    entry.querySelector("[data-code-excluded]").hidden = !blocked;
                });
                updateCodeInputs(card, item);
                return;
            }
            card.querySelectorAll('input[type="radio"],input[type="checkbox"],select option[value]:not([value=""])').forEach((control) => {
                const blocked = excluded.has(control.value);
                control.disabled = blocked;
                control.closest(".public-choice")?.classList.toggle("is-excluded", blocked);
                if (blocked && (control.checked || control.selected)) {
                    if (control.matches("option")) control.closest("select").value = "";
                    else control.checked = false;
                    const current = state.answers[item.id];
                    state.answers[item.id] = Array.isArray(current) ? current.filter((entry) => !excluded.has(String(entry))) : "";
                    cleared = true;
                }
            });
            filterChoiceOptions(card);
        });
        return cleared;
    }

    function matrixMarkup(question, name, aria) {
        const multiple = question.type === "matrix_multiple";
        const columns = (question.columns || []).map((column, index) => localizedIndexedLabel(question, "columns", index));
        const rows = (question.rows || []).map((row, index) => localizedIndexedLabel(question, "rows", index));
        return `<div class="public-matrix${columns.length > 7 ? " is-wide" : ""}${columns.length > 12 ? " is-stacked" : ""}" role="group" ${aria}><table role="table"><caption class="public-visually-hidden">${Common.escapeHtml(localizedQuestionField(question, "title"))}</caption><thead role="rowgroup"><tr role="row"><th role="columnheader" scope="col">${Common.escapeHtml(text("item"))}</th>${columns.map((column) => `<th role="columnheader" scope="col">${Common.escapeHtml(column)}</th>`).join("")}</tr></thead><tbody role="rowgroup">${rows.map((row, rowIndex) => `<tr role="row" data-matrix-row-id="${Common.escapeHtml(axisItemId(question, "rows", rowIndex))}"><th role="rowheader" scope="row">${Common.escapeHtml(row)}</th>${columns.map((column, columnIndex) => `<td role="cell"><label class="public-matrix-choice"><input type="${multiple ? "checkbox" : "radio"}" name="${Common.escapeHtml(name)}_${rowIndex}${multiple ? `_${columnIndex}` : ""}" value="${Common.escapeHtml(axisItemId(question, "columns", columnIndex))}" aria-label="${Common.escapeHtml(row)} - ${Common.escapeHtml(column)}" aria-describedby="${aria.match(/aria-describedby="([^"]*)"/)?.[1] || ""}"><span>${Common.escapeHtml(column)}</span></label></td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
    }

    function repeatTableMarkup(question, name, aria) {
        const sourceColumns = question.columns?.length ? question.columns : [text("item"), text("content")];
        const columns = sourceColumns.map((column, index) => localizedIndexedLabel(question, "columns", index));
        return `<div class="repeat-table" role="group" ${aria} data-repeat-table="${Common.escapeHtml(question.id)}"><div class="repeat-table-row" style="--columns:${columns.length}" aria-hidden="true">${columns.map((column) => `<strong>${Common.escapeHtml(column)}</strong>`).join("")}<span></span></div><div data-repeat-rows>${repeatRow(columns, name, 0, aria)}</div><button class="repeat-add" type="button" data-repeat-add>${Common.escapeHtml(text("addRow"))}</button></div>`;
    }

    function fixedTableMarkup(question, name, aria) {
        const sourceColumns = question.columns?.length ? question.columns : [text("item"), text("content")];
        const sourceRows = question.rows?.length ? question.rows : [text("rowDefault")];
        const columns = sourceColumns.map((column, index) => localizedIndexedLabel(question, "columns", index));
        const rows = sourceRows.map((row, index) => localizedIndexedLabel(question, "rows", index));
        const describedBy = aria.match(/aria-describedby="([^"]*)"/)?.[1] || "";
        return `<div class="public-fixed-table" role="group" ${aria}><table><caption class="public-visually-hidden">${Common.escapeHtml(localizedQuestionField(question, "title"))}</caption><thead><tr><th scope="col">${Common.escapeHtml(text("item"))}</th>${columns.map((column) => `<th scope="col">${Common.escapeHtml(column)}</th>`).join("")}</tr></thead><tbody data-repeat-rows>${rows.map((row, rowIndex) => `<tr data-repeat-row><th scope="row">${Common.escapeHtml(row)}</th>${columns.map((column, columnIndex) => `<td><label class="public-table-cell"><span>${Common.escapeHtml(column)}</span><input type="text" name="${Common.escapeHtml(name)}_${rowIndex}_${columnIndex}" aria-label="${Common.escapeHtml(row)} - ${Common.escapeHtml(column)}" aria-describedby="${Common.escapeHtml(describedBy)}"></label></td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
    }

    function repeatRow(columns, name, index, aria = "") {
        return `<div class="repeat-table-row" style="--columns:${columns.length}" data-repeat-row>${columns.map((column, columnIndex) => `<label class="public-repeat-cell"><span>${Common.escapeHtml(column)}</span><input type="text" name="${Common.escapeHtml(name)}_${index}_${columnIndex}" placeholder="${Common.escapeHtml(column)}" aria-label="${Common.escapeHtml(text("rowInputAria", { number: index + 1, column }))}" ${aria}></label>`).join("")}<button type="button" data-repeat-remove aria-label="${Common.escapeHtml(text("rowDeleteAria", { number: index + 1 }))}">×</button></div>`;
    }

    function onClick(event) {
        const errorJump = event.target.closest("[data-public-error-jump]");
        if (errorJump) {
            event.preventDefault();
            const card = [...dom.list.querySelectorAll("[data-question-id]")].find(item => item.dataset.questionId === errorJump.dataset.publicErrorJump);
            if (focusQuestion(card)) clearValidationToasts();
            return;
        }
        // An opaque preview has no allow-forms permission: validate through an
        // explicit button action without triggering the browser form algorithm.
        if (state.preview && event.target.closest(".public-submit")) return submit(event);
        if (event.target.matches?.("[data-slider]")) { onInput(event); return; }
        const clearRating = event.target.closest("[data-rating-clear]");
        if (clearRating) {
            const input = clearRating.closest("[data-rating]").querySelector("[data-rating-input]");
            input.value = ""; onInput({ target: input }); input.focus(); return;
        }
        const add = event.target.closest("[data-repeat-add]");
        const remove = event.target.closest("[data-repeat-remove]");
        if (add || remove) state.idempotencyKey = null;
        if (add) {
            const table = add.closest("[data-repeat-table]");
            const currentQuestion = question(table.dataset.repeatTable);
            const rows = table.querySelector("[data-repeat-rows]");
            const card = table.closest("[data-question-id]");
            const description = card.querySelector(".question-help")?.id;
            const error = card.querySelector(".question-error")?.id;
            const aria = `aria-labelledby="${card.querySelector("h2").id}" aria-describedby="${[description, error].filter(Boolean).join(" ")}"`;
            const sourceColumns = currentQuestion.columns?.length ? currentQuestion.columns : [text("item"), text("content")];
            const localizedColumns = sourceColumns.map((column, index) => localizedIndexedLabel(currentQuestion, "columns", index));
            rows.insertAdjacentHTML("beforeend", repeatRow(localizedColumns, `q_${currentQuestion.id}`, rows.children.length, aria));
            collectAnswers();
            applyLogic();
            updatePresentation();
            scheduleDraft();
        }
        if (remove && remove.closest("[data-repeat-rows]").children.length > 1) {
            remove.closest("[data-repeat-row]").remove();
            collectAnswers();
            applyLogic();
            updatePresentation();
            scheduleDraft();
        }
    }

    function onInput(event) {
        if (event.target.matches("[data-choice-search]")) { filterChoiceOptions(event.target.closest("[data-question-id]")); return; }
        state.idempotencyKey = null;
        if (event.target.matches("[data-slider]")) {
            event.target.closest("[data-rating]").querySelector("[data-rating-input]").value = event.target.value;
        }
        updateRating(event.target.closest("[data-question-id]"));
        collectAnswers();
        applyLogic();
        updatePresentation();
        clearQuestionError(event.target.closest("[data-question-id]"));
        renderValidationSummary();
        scheduleDraft();
        updateProgress();
        const changedId = event.target.closest("[data-question-id]")?.dataset.questionId;
        if (changedId) emitCustomEvent("answerChange", { questionId: changedId, answer: state.answers[changedId] });
    }

    function question(id) {
        return state.questions.find((item) => String(item.id) === String(id));
    }

    function collectAnswers() {
        const result = {};
        dom.list.querySelectorAll("[data-question-id]").forEach((card) => {
            const id = card.dataset.questionId;
            const currentQuestion = question(id);
            const name = `q_${id}`;
            let value = "";
            const rating = card.querySelector("[data-rating-input]");
            if (rating) {
                value = rating.value;
            } else if (currentQuestion.type === "multiple" && currentQuestion.settings?.choiceInput === "codes") {
                value = codeEntries(card, currentQuestion).filter(entry => entry.raw).map(entry => entry.option?.id || entry.raw);
            } else if (currentQuestion.type === "multiple") {
                value = [...card.querySelectorAll(`input[name="${CSS.escape(name)}"]:checked`)].map((input) => input.value);
            } else if (["single", "scale"].includes(currentQuestion.type)) {
                value = card.querySelector(`input[type="radio"][name="${CSS.escape(name)}"]:checked`)?.value ?? "";
            } else if (currentQuestion.type.startsWith("matrix_")) {
                value = {};
                (currentQuestion.rows || []).forEach((row, rowIndex) => {
                    const rowName = `${name}_${rowIndex}`;
                    const selector = currentQuestion.type === "matrix_single"
                        ? `input[name="${CSS.escape(rowName)}"]:checked`
                        : `input[name^="${CSS.escape(`${rowName}_`)}"]:checked`;
                    const checked = [...card.querySelectorAll(selector)].map((input) => input.value);
                    const rowId = axisItemId(currentQuestion, "rows", rowIndex);
                    if (checked.length) value[rowId] = currentQuestion.type === "matrix_single" ? checked[0] : checked;
                });
            } else if (["table", "repeat_table"].includes(currentQuestion.type)) {
                value = [...card.querySelectorAll("[data-repeat-row]")].map((row) => [...row.querySelectorAll("input")].map((input) => input.value));
            } else {
                const input = card.querySelector(`[name="${CSS.escape(name)}"]`);
                value = input?.value ?? "";
            }
            result[id] = hasValue(value) ? value : "";
        });
        state.answers = result;
    }

    function scheduleDraft() {
        if (state.preview) return;
        clearTimeout(state.saveTimer);
        state.draftRestored = false;
        dom.saveState.textContent = text("draftSaving");
        state.saveTimer = setTimeout(() => {
            try {
                sessionStorage.setItem(draftStorageKey(), JSON.stringify(state.answers));
                dom.saveState.textContent = text("draftSaved");
            } catch {
                dom.saveState.textContent = text("draftUnavailable");
            }
        }, 300);
    }

    function restoreDraft() {
        if (state.preview) return;
        try {
            state.answers = JSON.parse(sessionStorage.getItem(draftStorageKey()) || "{}");
            state.draftRestored = Boolean(state.answers && Object.keys(state.answers).some((key) => hasValue(state.answers[key])));
        } catch {
            state.answers = {};
            state.draftRestored = false;
        }
    }

    function populateDraft() {
        Object.entries(state.answers).forEach(([id, value]) => {
            const card = dom.list.querySelector(`[data-question-id="${CSS.escape(id)}"]`);
            const currentQuestion = question(id);
            if (!card || value == null || !currentQuestion) return;
            const name = `q_${id}`;
            const rating = card.querySelector("[data-rating-input]");
            if (rating) {
                rating.value = typeof value === "object" ? "" : String(value);
                updateRating(card);
            } else if (Array.isArray(value) && currentQuestion.type === "multiple" && currentQuestion.settings?.choiceInput === "codes") {
                card.querySelectorAll("[data-choice-code-input]").forEach((input, index) => {
                    input.value = (currentQuestion.options || []).find(option => option.id === value[index])?.code || value[index] || "";
                });
                updateCodeInputs(card, currentQuestion);
            } else if (Array.isArray(value) && currentQuestion.type === "multiple") {
                value.forEach((item) => {
                    const input = card.querySelector(`input[name="${CSS.escape(name)}"][value="${CSS.escape(String(item))}"]`);
                    if (input) input.checked = true;
                });
            } else if (Array.isArray(value) && currentQuestion.type === "table") {
                value.forEach((row, rowIndex) => {
                    (Array.isArray(row) ? row : []).forEach((cell, columnIndex) => {
                        const input = card.querySelector(`[name="${CSS.escape(name)}_${rowIndex}_${columnIndex}"]`);
                        if (input) input.value = cell ?? "";
                    });
                });
            } else if (Array.isArray(value) && currentQuestion.type === "repeat_table") {
                const sourceColumns = currentQuestion.columns?.length ? currentQuestion.columns : [text("item"), text("content")];
                const columns = sourceColumns.map((column, index) => localizedIndexedLabel(currentQuestion, "columns", index));
                const rowsHost = card.querySelector("[data-repeat-rows]");
                const description = card.querySelector(".question-help")?.id;
                const error = card.querySelector(".question-error")?.id;
                const aria = `aria-labelledby="${card.querySelector("h2").id}" aria-describedby="${[description, error].filter(Boolean).join(" ")}"`;
                const rows = value.length ? value : [columns.map(() => "")];
                rowsHost.innerHTML = rows.map((row, rowIndex) => repeatRow(columns, name, rowIndex, aria)).join("");
                rows.forEach((row, rowIndex) => {
                    (Array.isArray(row) ? row : []).forEach((cell, columnIndex) => {
                        const input = rowsHost.querySelector(`[name="${CSS.escape(name)}_${rowIndex}_${columnIndex}"]`);
                        if (input) input.value = cell ?? "";
                    });
                });
            } else if (currentQuestion.type.startsWith("matrix_") && typeof value === "object") {
                Object.entries(value).forEach(([rowKey, selected]) => {
                    const stableRowIndex = (currentQuestion.rows || []).findIndex((row, index) => axisItemId(currentQuestion, "rows", index) === String(rowKey));
                    const rowIndex = stableRowIndex >= 0 ? stableRowIndex : Number(rowKey);
                    if (!Number.isInteger(rowIndex) || rowIndex < 0 || rowIndex >= (currentQuestion.rows || []).length) return;
                    const selectedValues = Array.isArray(selected) ? selected : [selected];
                    selectedValues.forEach((columnKey) => {
                        const stableColumnIndex = (currentQuestion.columns || []).findIndex((column, index) => axisItemId(currentQuestion, "columns", index) === String(columnKey));
                        const columnIndex = stableColumnIndex >= 0 ? stableColumnIndex : Number(columnKey);
                        if (!Number.isInteger(columnIndex) || columnIndex < 0 || columnIndex >= (currentQuestion.columns || []).length) return;
                        const columnId = axisItemId(currentQuestion, "columns", columnIndex);
                        const rowName = `${name}_${rowIndex}`;
                        const selector = currentQuestion.type === "matrix_single"
                            ? `input[name="${CSS.escape(rowName)}"][value="${CSS.escape(columnId)}"]`
                            : `input[name^="${CSS.escape(`${rowName}_`)}"][value="${CSS.escape(columnId)}"]`;
                        const input = card.querySelector(selector);
                        if (input) input.checked = true;
                    });
                });
            } else if (typeof value !== "object") {
                const radio = card.querySelector(`input[name="${CSS.escape(name)}"][value="${CSS.escape(String(value))}"]`);
                const input = radio || card.querySelector(`[name="${CSS.escape(name)}"]`);
                if (input) {
                    if (radio) radio.checked = true;
                    else input.value = value;
                    if (input.matches("[data-slider]")) input.dispatchEvent(new Event("input", { bubbles: false }));
                }
            }
        });
    }

    function hasValue(value) {
        if (Array.isArray(value)) return value.some((item) => Array.isArray(item) ? item.some(Boolean) : Boolean(item));
        if (value && typeof value === "object") return Object.values(value).some(hasValue);
        return String(value ?? "").trim() !== "";
    }

    function displayQuestionLabel(card) {
        const current = question(card.dataset.questionId);
        const title = window.SurveyQuestionNumbering.title(current, state.survey.settings, localizedQuestionField(current, "title")) || text("questionFallback");
        return card.dataset.questionNumber ? text("questionLink", { number: card.dataset.questionNumber, title }) : title;
    }

    function validate() {
        collectAnswers();
        applyLogic();
        const errors = [];
        dom.list.querySelectorAll("[data-question-id]").forEach((card) => {
            const currentQuestion = question(card.dataset.questionId);
            const errorElement = card.querySelector(".question-error");
            const visible = isCardActive(card);
            let message = "";
            if (visible && currentQuestion.required && !hasValue(state.answers[currentQuestion.id])) message = text("requiredError");
            if (visible && !message && currentQuestion.validation?.type === "email" && hasValue(state.answers[currentQuestion.id]) && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(state.answers[currentQuestion.id])) message = text("emailError");
            const answer = state.answers[currentQuestion.id];
            const settings = currentQuestion.settings || {};
            if (visible && !message && settings.choiceInput === "codes") {
                const entries = codeEntries(card, currentQuestion);
                message = entries.map(entry => codeEntryError(entry, entries, currentQuestion)).find(Boolean) || "";
            }
            const rating = card.querySelector("[data-rating-input]");
            if (visible && !message && rating && !rating.validity.valid) message = rating.validationMessage;
            if (visible && !message && currentQuestion.type === "multiple" && hasValue(answer)) {
                if (settings.minSelections != null && answer.length < settings.minSelections) message = `최소 ${settings.minSelections}개를 선택해 주세요.`;
                if (settings.maxSelections != null && answer.length > settings.maxSelections) message = `최대 ${settings.maxSelections}개까지 선택할 수 있습니다.`;
            }
            if (visible && !message && currentQuestion.required && currentQuestion.type.startsWith("matrix_") && (currentQuestion.rows || []).some((row, index) => !hasValue(answer?.[axisItemId(currentQuestion, "rows", index)]))) message = "모든 항목에 응답해 주세요.";
            setQuestionError(card, message);
            if (message) errors.push({ label: displayQuestionLabel(card), message, card });
            if (!visible) errorElement.hidden = true;
        });
        renderValidationSummary();
        if (errors.length) {
            clearValidationToasts();
            const first = errors[0];
            showQuestionToast(`${first.label} · ${first.message}`, first.card, errors.slice(1));
            focusQuestion(first.card);
        }
        return !errors.length;
    }

    function focusQuestion(card) {
        if (!isCardActive(card)) return false;
        if (presentationMode() === "one_at_a_time") {
            state.activeQuestionIndex = Math.max(0, activeQuestionCards().indexOf(card));
            updatePresentation();
        }
        const controls = [...card.querySelectorAll("input,select,textarea,button")].filter(control =>
            !control.disabled && control.type !== "hidden" && !control.closest("[hidden]") && control.getClientRects().length
        );
        const missingRow = [...card.querySelectorAll("[data-matrix-row-id]")].find(row =>
            !row.querySelector("input:checked") && row.querySelector('input[type="radio"],input[type="checkbox"]')
        );
        const target = controls.find(control => missingRow?.contains(control)) || controls[0] || card;
        target.focus({ preventScroll: true });
        // Start alignment keeps the heading visible even for very tall option lists.
        card.scrollIntoView({ behavior: "instant", block: "start" });
        const bounds = target.getBoundingClientRect?.();
        if (bounds) {
            const headerBottom = document.querySelector(".public-header")?.getBoundingClientRect().bottom || 0;
            const footerTop = dom.form?.querySelector(".public-submit-row")?.getBoundingClientRect().top || innerHeight;
            if (bounds.top < headerBottom + 12 || bounds.bottom > Math.min(innerHeight, footerTop) - 12) {
                target.scrollIntoView({ behavior: "instant", block: "center" });
            }
        }
        return true;
    }

    function clearValidationToasts() {
        dom.toastStack?.querySelectorAll("[data-public-validation-toast]").forEach(item => {
            clearTimeout(item.dismissTimer);
            item.remove();
        });
    }

    function setQuestionError(card, message) {
        if (!card) return;
        const errorElement = card.querySelector(".question-error");
        card.classList.toggle("has-error", Boolean(message));
        errorElement.hidden = !message;
        errorElement.textContent = message;
        card.querySelectorAll("input,select,textarea").forEach((control) => {
            if (message) control.setAttribute("aria-invalid", "true");
            else control.removeAttribute("aria-invalid");
        });
    }

    function clearQuestionError(card) {
        if (card?.classList.contains("has-error")) {
            setQuestionError(card, "");
            clearValidationToasts();
        }
    }

    function renderValidationSummary() {
        const errors = [...dom.list.querySelectorAll("[data-question-id].has-error")].map((card) => ({
            card,
            label: displayQuestionLabel(card)
        }));
        dom.summary.querySelector("strong").textContent = text("validationTitle");
        dom.summary.querySelector("ul").innerHTML = errors.map((error) => `<li><a href="#${Common.escapeHtml(error.card.id)}" data-public-error-jump="${Common.escapeHtml(error.card.dataset.questionId)}">${Common.escapeHtml(error.label)}</a></li>`).join("");
        dom.summary.hidden = !errors.length;
        if (!errors.length) clearValidationToasts();
    }

    function presentationMode() {
        return state.survey.settings?.presentationMode || state.survey.settings?.presentation_mode || "scroll";
    }

    function activeQuestionCards() {
        return [...dom.list.querySelectorAll("[data-question-id]")].filter((card) => isCardActive(card));
    }

    function isCardActive(card) {
        return Boolean(card && !card.closest("[data-section-id]")?.hidden && !card.hidden);
    }


    function noticePageVisible(sectionId, currentSectionId, activeSectionIds, pageIndex) {
        if (String(sectionId) === String(currentSectionId)) return true;
        const order = state.sections.map((section) => String(section.id));
        const noticeIndex = order.indexOf(String(sectionId));
        const activeOrder = activeSectionIds.map(String);
        const preceding = order.slice(0, noticeIndex).some((id) => activeOrder.includes(id));
        if (!preceding) return pageIndex === 0;
        const next = order.slice(noticeIndex + 1).find((id) => activeOrder.includes(id));
        if (!next) return pageIndex === activeOrder.length - 1;
        return String(currentSectionId) === next && pageIndex === activeOrder.indexOf(next);
    }

    function updatePresentation() {
        const paged = presentationMode() === "one_at_a_time";
        dom.form.classList.toggle("is-one-at-a-time", paged);
        dom.pager.hidden = !paged;
        const cards = activeQuestionCards();
        const customFrame = document.querySelector("[data-public-custom-code]");
        const updateCustomFrame = () => {
            if (!customFrame) return;
            const afterLastQuestion = customFrame.dataset.placement === "afterQuestions";
            customFrame.hidden = customFrame.dataset.enabled !== "true" || (paged && afterLastQuestion && state.activeQuestionIndex < cards.length - 1);
        };
        if (!paged) {
            cards.forEach((card) => card.classList.remove("is-current-question"));
            dom.list.querySelectorAll(".public-notice").forEach((notice) => { notice.hidden = false; });
            updateCustomFrame();
            return;
        }
        state.activeQuestionIndex = Math.min(Math.max(0, state.activeQuestionIndex), Math.max(0, cards.length - 1));
        cards.forEach((card, index) => card.classList.toggle("is-current-question", index === state.activeQuestionIndex));
        dom.previous.disabled = state.activeQuestionIndex === 0;
        dom.next.hidden = state.activeQuestionIndex >= cards.length - 1;
        dom.pageStatus.textContent = text("pageStatus", { current: cards.length ? state.activeQuestionIndex + 1 : 0, total: cards.length });
        updateCustomFrame();
        const current = cards[state.activeQuestionIndex];
        emitCustomEvent("pageChange", { questionId: current?.dataset.questionId || null, sectionId: current?.closest("[data-section-id]")?.dataset.sectionId || null });
        const activeSectionIds = cards.map((card) => card.closest("[data-section-id]")?.dataset.sectionId);
        dom.list.querySelectorAll(".public-notice").forEach((notice) => {
            notice.hidden = Boolean(current) && !noticePageVisible(notice.closest("[data-section-id]")?.dataset.sectionId, current.closest("[data-section-id]")?.dataset.sectionId, activeSectionIds, state.activeQuestionIndex);
        });
    }

    function moveQuestionPage(delta) {
        const cards = activeQuestionCards();
        if (!cards.length) return;
        const current = cards[state.activeQuestionIndex];
        if (delta > 0) {
            collectAnswers();
            const currentQuestion = question(current.dataset.questionId);
            if (currentQuestion?.required && !hasValue(state.answers[currentQuestion.id])) {
                setQuestionError(current, text("requiredError"));
                clearValidationToasts();
                showQuestionToast(`${displayQuestionLabel(current)} · ${text("requiredError")}`, current);
                renderValidationSummary();
                focusQuestion(current);
                return;
            }
        }
        state.activeQuestionIndex = Math.min(Math.max(0, state.activeQuestionIndex + delta), cards.length - 1);
        updatePresentation();
        const target = cards[state.activeQuestionIndex];
        target.scrollIntoView({ behavior: "smooth", block: "start" });
        target.focus({ preventScroll: true });
    }

    const ERROR_NAV_COPY = {
        ko: { jump: "문항으로 이동", more: "다른 오류 문항 {count}개 보기" },
        en: { jump: "Go to question", more: "Show {count} other questions" },
        ja: { jump: "質問へ移動", more: "ほかの質問を表示（{count}件）" },
        zh: { jump: "转到题目", more: "查看其他 {count} 道题目" },
        vi: { jump: "Đến câu hỏi", more: "Xem {count} câu hỏi khác" },
        fil: { jump: "Pumunta sa tanong", more: "Ipakita ang {count} iba pang tanong" }
    };

    function showQuestionToast(message, card = null, others = []) {
        const item = document.createElement("div");
        item.className = "public-toast";
        item.setAttribute("role", "alert");
        const escape = Common.escapeHtml;
        const copy = ERROR_NAV_COPY[uiLocale()] || ERROR_NAV_COPY.ko;
        const jumpButton = (target, label) => `<button class="public-toast-target" type="button" data-public-error-jump="${escape(target.dataset.questionId)}">${escape(label)}<small>${escape(copy.jump)} →</small></button>`;
        if (card) item.dataset.publicValidationToast = "true";
        const content = card
            ? `<div>${jumpButton(card, message)}${others.length ? `<details class="public-toast-details"><summary>${escape(copy.more.replace("{count}", others.length))}</summary><ul>${others.map(error => `<li>${jumpButton(error.card, `${error.label} · ${error.message}`)}</li>`).join("")}</ul></details>` : ""}</div>`
            : `<span>${escape(message)}</span>`;
        item.innerHTML = `${content}<span class="public-toast-actions"><button type="button" data-public-toast-copy title="메시지 복사" aria-label="메시지 내용 복사">${Common.icon("copy", 16)}</button><button type="button" data-public-toast-close title="닫기" aria-label="메시지 닫기">×</button></span>`;
        const dismiss = () => {
            clearTimeout(item.dismissTimer);
            item.remove();
        };
        item.querySelector("[data-public-toast-close]").addEventListener("click", dismiss);
        item.querySelector("[data-public-toast-copy]").addEventListener("click", async (event) => {
            const button = event.currentTarget;
            try {
                await Common.copyText(message);
                button.innerHTML = Common.icon("check", 16);
                button.setAttribute("aria-label", "복사됨");
            } catch {
                button.textContent = "!";
                button.setAttribute("aria-label", "복사 실패");
            }
        });
        dom.toastStack.appendChild(item);
        if (!card) item.dismissTimer = setTimeout(dismiss, 5000);
    }

    function applyLogic(stabilizing = false) {
        const rules = Array.isArray(state.survey.logicRules) ? state.survey.logicRules : [];
        const visibleIds = new Set();
        let clearedAnswer = false;
        if (!rules.length) state.sections.forEach((section) => visibleIds.add(String(section.id)));
        else {
            const sectionByQuestion = new Map();
            state.sections.forEach((section, sectionIndex) => section.questions.forEach((item) => sectionByQuestion.set(String(item.id), sectionIndex)));
            const visited = new Set();
            let index = 0;
            while (index >= 0 && index < state.sections.length && !visited.has(index)) {
                visited.add(index);
                const section = state.sections[index];
                visibleIds.add(String(section.id));
                const matchingRule = rules.find((rule) => {
                    const sourceId = String(rule.sourceQuestionId || rule.questionId || "");
                    return sectionByQuestion.get(sourceId) === index && ruleMatches(rule, state.answers[sourceId]);
                });
                if (!matchingRule) {
                    index += 1;
                    continue;
                }
                const destination = String(matchingRule.targetSectionId || matchingRule.destinationSectionId || matchingRule.gotoSectionId || matchingRule.destination || "next");
                if (["complete", "submit", "end"].includes(destination)) break;
                if (destination === "next") {
                    index += 1;
                    continue;
                }
                const targetIndex = state.sections.findIndex((item) => String(item.id) === destination);
                index = targetIndex >= 0 ? targetIndex : index + 1;
            }
        }
        dom.list.querySelectorAll("[data-section-id]").forEach((section) => {
            const hidden = !visibleIds.has(String(section.dataset.sectionId));
            section.hidden = hidden;
            section.setAttribute("aria-hidden", String(hidden));
            if (hidden) section.querySelectorAll("[data-question-id]").forEach((card) => {
                const questionId = card.dataset.questionId;
                if (hasValue(state.answers[questionId])) clearedAnswer = true;
                delete state.answers[questionId];
                card.querySelectorAll("input,select,textarea").forEach((control) => {
                    if (control.matches('[type="checkbox"], [type="radio"]')) control.checked = false;
                    else if (control.tagName === "SELECT") control.selectedIndex = 0;
                    else control.value = control.matches('[type="range"]') ? control.defaultValue : "";
                });
                card.querySelectorAll("input,select,textarea,button").forEach((control) => { control.disabled = true; });
                updateRating(card);
                setQuestionError(card, "");
            });
        });
        const answers = state.answers;
        state.questions.forEach((currentQuestion) => {
            const card = dom.list.querySelector(`[data-question-id="${CSS.escape(String(currentQuestion.id))}"]`);
            if (!card || card.closest("[data-section-id]").hidden) return;
            const active = questionActive(currentQuestion, answers);
            card.hidden = !active;
            card.setAttribute("aria-hidden", String(!active));
            card.querySelectorAll("input,select,textarea,button").forEach((control) => { control.disabled = !active; });
            if (!active) {
                if (hasValue(state.answers[currentQuestion.id])) clearedAnswer = true;
                delete state.answers[currentQuestion.id];
                card.querySelectorAll("input,select,textarea").forEach((control) => {
                    if (control.matches('[type="checkbox"], [type="radio"]')) control.checked = false;
                    else if (control.tagName === "SELECT") control.selectedIndex = 0;
                    else control.value = control.matches('[type="range"]') ? control.defaultValue : "";
                });
                setQuestionError(card, "");
            }
            updateRating(card);
        });
        clearedAnswer = applyChoiceExclusions() || clearedAnswer;
        // A hidden source answer can affect another dynamic question or section.
        // Re-evaluate once after clearing it so the visible path converges during
        // the same input/change event on mouse, touch, and keyboard devices.
        if (clearedAnswer && !stabilizing) applyLogic(true);
    }

    function questionActive(currentQuestion, answers) {
        const group = currentQuestion.activationCondition || currentQuestion.activation_condition;
        if (!group?.conditions?.length) return true;
        const results = group.conditions.map((condition) => conditionMatches(condition, answers[condition.sourceQuestionId || condition.source_question_id]));
        return (group.combinator || "all") === "any" ? results.some(Boolean) : results.every(Boolean);
    }

    function conditionMatches(condition, answer) {
        const operator = condition.operator || "equals";
        if (operator === "exists") return hasValue(answer);
        if (operator === "not_exists") return !hasValue(answer);
        if (!hasValue(answer)) return false;
        const actual = Array.isArray(answer) ? answer : [answer];
        const expected = Array.isArray(condition.value) ? condition.value : [condition.value];
        if (operator === "contains") return actual.some((item) => expected.some((value) => String(item).includes(String(value))));
        if (operator === "in") return actual.some((item) => expected.some((value) => String(item) === String(value)));
        if (["greater_than", "greater_or_equal", "less_than", "less_or_equal"].includes(operator)) {
            const left = Number(actual[0]);
            const right = Number(expected[0]);
            if (!Number.isFinite(left) || !Number.isFinite(right)) return false;
            return operator === "greater_than" ? left > right : operator === "greater_or_equal" ? left >= right : operator === "less_than" ? left < right : left <= right;
        }
        const equal = actual.some((item) => expected.some((value) => String(item) === String(value)));
        return operator === "not_equals" ? !equal : equal;
    }

    function ruleMatches(rule, answer) {
        if (!hasValue(answer)) return false;
        const expected = String(rule.value ?? rule.optionId ?? rule.equals ?? "");
        if (!expected) return false;
        const values = Array.isArray(answer) ? answer.map(String) : [String(answer)];
        if (rule.operator === "notEquals" || rule.operator === "not_equals") return !values.includes(expected);
        if (rule.operator === "contains") return values.some((value) => value.includes(expected));
        return values.includes(expected);
    }

    async function submit(event) {
        event.preventDefault();
        emitCustomEvent("beforeSubmit", {});
        if (!validate()) return;
        if (state.preview) {
            dom.saveState.textContent = "입력 동작 확인을 완료했습니다. 미리보기 응답은 저장되지 않습니다.";
            dom.demoBanner.textContent = "입력 검증 통과 · 미리보기 응답은 서버에 제출되지 않았습니다.";
            dom.demoBanner.scrollIntoView({ block: "center" });
            return;
        }
        const button = dom.form.querySelector('button[type="submit"]');
        button.disabled = true;
        button.textContent = text("submitting");
        const oneResponse = setting("oneResponsePerRespondent", "oneResponse", false);
        const visibleQuestionIds = new Set(
            activeQuestionCards()
                .map((card) => String(card.dataset.questionId))
        );
        const visibleAnswers = Object.fromEntries(
            Object.entries(state.answers).filter(([questionId]) => visibleQuestionIds.has(String(questionId)))
        );
        state.idempotencyKey ||= `submission_${globalThis.crypto?.randomUUID?.() || `${Date.now()}_${Math.random().toString(36).slice(2)}`}`;
        try {
            const recipientToken = new URLSearchParams(location.search).get("r");
            await Common.api.post(`/api/public/surveys/${encodeURIComponent(state.slug)}/responses`, {
                answers: visibleAnswers,
                audienceCode: state.audienceCode,
                respondentKey: recipientToken || (oneResponse ? respondentKey() : undefined),
                client: { language: state.locale, viewport: `${innerWidth}x${innerHeight}` }
            }, { headers: { "Idempotency-Key": state.idempotencyKey } });
            sessionStorage.removeItem(draftStorageKey());
            dom.form.hidden = true;
            showState("✓", text("submitted"), localizedSurveyField("confirmationMessage") || text("thanks"));
        } catch (error) {
            button.disabled = false;
            button.textContent = text("submit");
            dom.summary.hidden = false;
            dom.summary.querySelector("strong").textContent = text("submitFailed");
            dom.summary.querySelector("ul").innerHTML = `<li>${Common.escapeHtml(error.message)}</li>`;
            dom.summary.setAttribute("tabindex", "-1");
            dom.summary.focus();
        }
    }

    function respondentKey() {
        if (state.respondentKey) return state.respondentKey;
        const storageKey = `surveyone:respondent:${state.slug}`;
        try {
            const existing = localStorage.getItem(storageKey);
            if (existing) return (state.respondentKey = existing);
            const value = createBrowserKey();
            localStorage.setItem(storageKey, value);
            return (state.respondentKey = value);
        } catch {
            return (state.respondentKey = createBrowserKey());
        }
    }

    function createBrowserKey() {
        if (globalThis.crypto?.randomUUID) return `browser_${globalThis.crypto.randomUUID()}`;
        const bytes = new Uint8Array(16);
        globalThis.crypto?.getRandomValues?.(bytes);
        const randomPart = bytes.some(Boolean) ? [...bytes].map((item) => item.toString(16).padStart(2, "0")).join("") : `${Date.now()}_${Math.random().toString(36).slice(2)}`;
        return `browser_${randomPart}`;
    }

    function setting(canonicalName, compatibilityName, fallback) {
        const settings = state.survey.settings || {};
        return settings[canonicalName] ?? settings[compatibilityName] ?? fallback;
    }

    function updateProgress() {
        if (!state.survey) return;
        const visibleQuestions = [...dom.list.querySelectorAll("[data-section-id]:not([hidden]) [data-question-id]:not([hidden])")].map((card) => question(card.dataset.questionId));
        const answered = visibleQuestions.filter((item) => hasValue(state.answers[item.id])).length;
        dom.progress.style.width = `${visibleQuestions.length ? Math.round(answered / visibleQuestions.length * 100) : 0}%`;
    }

    function domToken(id, index) {
        return `${index + 1}-${String(id).replace(/[^A-Za-z0-9_-]/g, "_")}`;
    }

    function showState(icon, title, message) {
        dom.loading.hidden = true;
        dom.form.hidden = true;
        document.querySelector(".public-progress").hidden = true;
        dom.state.hidden = false;
        dom.state.innerHTML = `<span class="public-state-icon">${Common.escapeHtml(icon)}</span><h1>${Common.escapeHtml(title)}</h1><p>${Common.escapeHtml(message)}</p><a href="/">${Common.escapeHtml(text("home"))}</a>`;
        document.querySelector("#surveyMain")?.focus({ preventScroll: true });
    }
})();
