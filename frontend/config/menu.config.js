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
                { code: "M02001", label: "설문 프로젝트", description: "신규 생성부터 편집까지 통합 관리" },
                { code: "M02002", label: "템플릿 선택", description: "신규 프로젝트의 시작 구조 선택", hidden: true, navigationCode: "M02001" },
                { code: "M02003", label: "설문 편집", description: "문항·분기·검증 설계", hidden: true, navigationCode: "M02001" },
                { code: "M02004", label: "응답 UI 선택", description: "응답자 화면 진행 방식 선택", hidden: true, navigationCode: "M02001" },
                { code: "M02005", label: "스킨 설정", description: "프로젝트 색상·글꼴·응답 화면", hidden: true, navigationCode: "M02001" }
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
            items: [{ code: "M06001", label: "시스템 환경 설정", description: "IN-SURVEYONE 작업 환경과 실행 상태" }]
        },
        {
            code: "M07",
            label: "플랫폼 관리",
            icon: "grid",
            roles: ["SYSTEM_ADMIN"],
            items: [
                { code: "M07001", label: "공용 템플릿 관리", description: "회원 공용 설문 템플릿 설계·배포", roles: ["SYSTEM_ADMIN"] },
                { code: "M07002", label: "회원 관리", description: "가입 회원 조회·계정 복구·이용 상태 관리", roles: ["SYSTEM_ADMIN"] }
            ]
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
