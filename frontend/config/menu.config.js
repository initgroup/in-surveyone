(function () {
    "use strict";

    window.MENU_CONFIG = Object.freeze([
        {
            code: "M01",
            label: "홈",
            icon: "home",
            items: [{ code: "M01001", label: "대시보드", description: "오늘의 설문 운영 현황" }]
        },
        {
            code: "M02",
            label: "설문 만들기",
            icon: "edit",
            items: [
                { code: "M02001", label: "설문 프로젝트", description: "초안부터 종료까지 관리" },
                { code: "M02002", label: "템플릿 라이브러리", description: "검증된 설문에서 시작" },
                { code: "M02003", label: "설문 편집기", description: "문항·분기·검증 설계" }
            ]
        },
        {
            code: "M03",
            label: "배포 및 안내",
            icon: "send",
            items: [{ code: "M03001", label: "배포 센터", description: "URL·이메일·문자·카카오 안내" }]
        },
        {
            code: "M04",
            label: "응답 데이터",
            icon: "database",
            items: [{ code: "M04001", label: "로우데이터", description: "응답 조회·필터·다운로드" }]
        },
        {
            code: "M05",
            label: "결과 및 보고서",
            icon: "chart",
            items: [
                { code: "M05001", label: "기본형 보고서", description: "표준 통계와 문항별 결과" },
                { code: "M05002", label: "맞춤형 보고서", description: "기관별 보고서 레이아웃" }
            ]
        },
        {
            code: "M06",
            label: "운영 설정",
            icon: "settings",
            items: [{ code: "M06001", label: "스킨 및 프로젝트 설정", description: "브랜드·응답 정책 관리" }]
        }
    ]);

    window.PAGE_CONFIG = Object.freeze(Object.fromEntries(
        window.MENU_CONFIG.flatMap((group) => group.items).map((item) => [item.code, {
            ...item,
            groupCode: window.MENU_CONFIG.find((group) => group.items.some((candidate) => candidate.code === item.code)).code,
            html: `/frontend/pages/${item.code}.html`,
            script: `/frontend/js/${item.code}.js`,
            style: `/frontend/css/pages/${item.code}.css`
        }])
    ));
})();
