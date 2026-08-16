(function () {
    "use strict";

    window.SURVEYONE_CONFIG = Object.freeze({
        productName: "IN-SURVEYONE",
        companyName: "inIT",
        assetVersion: "20260816.56",
        apiBaseUrl: "",
        defaultRoute: "M01001",
        publicPathPrefix: "/s/",
        guestProjectLimit: 2,
        locales: [
            { code: "ko", label: "한국어", nativeLabel: "한국어" },
            { code: "en", label: "영어", nativeLabel: "English" },
            { code: "ja", label: "일본어", nativeLabel: "日本語" },
            { code: "zh", label: "중국어", nativeLabel: "中文" },
            { code: "vi", label: "베트남어", nativeLabel: "Tiếng Việt" },
            { code: "fil", label: "필리핀어", nativeLabel: "Filipino" }
        ],
        questionTypes: [
            { code: "single", label: "객관식", description: "하나만 선택", icon: "radio" },
            { code: "multiple", label: "복수응답", description: "여러 개 선택", icon: "check-square" },
            { code: "dropdown", label: "목록 선택", description: "드롭다운", icon: "chevron-down" },
            { code: "short_text", label: "단답형", description: "짧은 주관식", icon: "text" },
            { code: "long_text", label: "장문형", description: "긴 주관식", icon: "align-left" },
            { code: "number", label: "숫자", description: "범위·단위 검증", icon: "hash" },
            { code: "scale", label: "척도", description: "5·7·10점 척도", icon: "bar-chart" },
            { code: "slider", label: "슬라이더", description: "연속 범위", icon: "sliders" },
            { code: "matrix_single", label: "매트릭스", description: "행별 단일선택", icon: "grid" },
            { code: "matrix_multiple", label: "복수 매트릭스", description: "행별 복수선택", icon: "table" },
            { code: "table", label: "표", description: "고정 행 입력", icon: "table" },
            { code: "repeat_table", label: "반복표", description: "행 추가 입력", icon: "copy" },
            { code: "date", label: "날짜", description: "날짜·기간", icon: "calendar" },
            { code: "notice", label: "텍스트 안내", description: "설명·동의문", icon: "info" }
        ],
        skinPresets: [
            { code: "ocean", name: "오션 블루", primary: "#2457d6", accent: "#4ed7bd", surface: "#f3f7ff", radius: "18px" },
            { code: "forest", name: "포레스트", primary: "#166b57", accent: "#8bd8b7", surface: "#f1f8f4", radius: "12px" },
            { code: "violet", name: "바이올렛", primary: "#7048c8", accent: "#e0c5ff", surface: "#f7f2ff", radius: "22px" },
            { code: "public", name: "공공 신뢰", primary: "#183b66", accent: "#e7b84b", surface: "#f4f6f8", radius: "6px" }
        ]
    });
})();
