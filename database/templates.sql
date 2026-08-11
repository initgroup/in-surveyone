-- [TEMPLATE_LIST]
SELECT TEMPLATE_CODE
     , TEMPLATE_TITLE
     , CATEGORY_CODE
     , DESCRIPTION
     , CONTENT_JSON
  FROM "INIT$SVY_TB_TEMPLATE"
 WHERE USE_YN = 'Y'
 ORDER BY CATEGORY_CODE
        , TEMPLATE_TITLE
;

-- [TEMPLATE_DETAIL]
SELECT TEMPLATE_CODE
     , TEMPLATE_TITLE
     , CATEGORY_CODE
     , DESCRIPTION
     , CONTENT_JSON
  FROM "INIT$SVY_TB_TEMPLATE"
 WHERE TEMPLATE_CODE = :templateCode
   AND USE_YN = 'Y'
;

-- [TEMPLATE_MERGE]
MERGE INTO "INIT$SVY_TB_TEMPLATE" T
USING (
    SELECT :templateCode AS TEMPLATE_CODE FROM DUAL
) S
   ON (T.TEMPLATE_CODE = S.TEMPLATE_CODE)
 WHEN NOT MATCHED THEN
      INSERT (
          TEMPLATE_CODE
        , TEMPLATE_TITLE
        , CATEGORY_CODE
        , DESCRIPTION
        , CONTENT_JSON
        , USE_YN
        , CREATED_AT
      ) VALUES (
          :templateCode
        , :templateTitle
        , :categoryCode
        , :description
        , :contentJson
        , 'Y'
        , SYSTIMESTAMP
      )
;

-- [TEMPLATE_REPAIR]
UPDATE "INIT$SVY_TB_TEMPLATE"
   SET TEMPLATE_TITLE = :templateTitle
     , CATEGORY_CODE = :categoryCode
     , DESCRIPTION = :description
     , CONTENT_JSON = :contentJson
     , USE_YN = 'Y'
     , UPDATED_AT = SYSTIMESTAMP
 WHERE TEMPLATE_CODE = :templateCode
;
