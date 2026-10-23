-- [SURVEY_LIST_BY_OWNER]
SELECT S.SURVEY_ID
     , S.SURVEY_TITLE
     , S.CATEGORY_CODE
     , S.STATUS_CODE
     , S.REVISION_NO
     , S.DRAFT_JSON
     , S.PUBLIC_SLUG
     , S.ACTIVE_VERSION_NO
     , S.CREATED_AT
     , S.UPDATED_AT
     , S.PUBLISHED_AT
     , S.SURVEY_START_AT
     , S.SURVEY_CLOSES_AT
     , S.IDENTIFIED_YN
     , S.SHOW_PROGRESS_YN
     , S.TARGET_AUDIENCE
     , S.POPULATION_MODE_CODE
     , S.POPULATION_SIZE
     , S.TARGET_RESPONSE_COUNT
     , CASE
           WHEN S.STATUS_CODE = 'PUBLISHED' AND EXISTS (
                SELECT 1
                  FROM "INIT$SVY_TB_DELIVERY_BATCH" B
                 WHERE B.TENANT_ID = S.TENANT_ID
                   AND B.SURVEY_ID = S.SURVEY_ID
                   AND B.SURVEY_VERSION_NO = S.ACTIVE_VERSION_NO
                   AND B.STATUS_CODE <> 'CANCELLED'
                   AND B.EXECUTION_STATUS_CODE IS NOT NULL
           ) THEN 'ACTIVE'
           WHEN S.STATUS_CODE = 'PUBLISHED' THEN 'READY'
       END AS DEPLOYMENT_STATUS
     , (
           SELECT COUNT(*)
             FROM "INIT$SVY_TB_RESPONSE" R
            WHERE R.TENANT_ID = S.TENANT_ID
              AND R.SURVEY_ID = S.SURVEY_ID
       ) AS RESPONSE_COUNT
  FROM "INIT$SVY_TB_SURVEY" S
 WHERE S.TENANT_ID = :tenantId
   AND S.OWNER_USER_ID = :ownerUserId
   AND S.STATUS_CODE <> 'DELETED'
   AND S.ADMIN_TEMPLATE_YN = 'N'
   AND (:statusCode IS NULL OR S.STATUS_CODE = :statusCode)
   AND (
          :deploymentStage IS NULL
       OR (:deploymentStage = 'ACTIVE' AND S.STATUS_CODE = 'PUBLISHED' AND EXISTS (
              SELECT 1 FROM "INIT$SVY_TB_DELIVERY_BATCH" B
               WHERE B.TENANT_ID = S.TENANT_ID
                 AND B.SURVEY_ID = S.SURVEY_ID
                 AND B.SURVEY_VERSION_NO = S.ACTIVE_VERSION_NO
                 AND B.STATUS_CODE <> 'CANCELLED'
                 AND B.EXECUTION_STATUS_CODE IS NOT NULL
          ))
       OR (:deploymentStage = 'CONFIRMED' AND S.STATUS_CODE = 'PUBLISHED' AND NOT EXISTS (
              SELECT 1 FROM "INIT$SVY_TB_DELIVERY_BATCH" B
               WHERE B.TENANT_ID = S.TENANT_ID
                 AND B.SURVEY_ID = S.SURVEY_ID
                 AND B.SURVEY_VERSION_NO = S.ACTIVE_VERSION_NO
                 AND B.STATUS_CODE <> 'CANCELLED'
                 AND B.EXECUTION_STATUS_CODE IS NOT NULL
          ))
   )
 ORDER BY S.UPDATED_AT DESC
;

-- [SURVEY_PAGE_COUNTS_BY_OWNER]
SELECT COUNT(*) AS TOTAL_COUNT
     , COUNT(
           CASE
               WHEN (:statusCode IS NULL OR S.STATUS_CODE = :statusCode)
                AND (
                       :deploymentStage IS NULL
                    OR (:deploymentStage = 'ACTIVE' AND S.STATUS_CODE = 'PUBLISHED' AND EXISTS (
                           SELECT 1 FROM "INIT$SVY_TB_DELIVERY_BATCH" B
                            WHERE B.TENANT_ID = S.TENANT_ID
                              AND B.SURVEY_ID = S.SURVEY_ID
                              AND B.SURVEY_VERSION_NO = S.ACTIVE_VERSION_NO
                              AND B.STATUS_CODE <> 'CANCELLED'
                              AND B.EXECUTION_STATUS_CODE IS NOT NULL
                       ))
                    OR (:deploymentStage = 'CONFIRMED' AND S.STATUS_CODE = 'PUBLISHED' AND NOT EXISTS (
                           SELECT 1 FROM "INIT$SVY_TB_DELIVERY_BATCH" B
                            WHERE B.TENANT_ID = S.TENANT_ID
                              AND B.SURVEY_ID = S.SURVEY_ID
                              AND B.SURVEY_VERSION_NO = S.ACTIVE_VERSION_NO
                              AND B.STATUS_CODE <> 'CANCELLED'
                              AND B.EXECUTION_STATUS_CODE IS NOT NULL
                       ))
                )
                AND (
                       :queryPattern IS NULL
                    OR LOWER(S.SURVEY_TITLE) LIKE :queryPattern
                    OR LOWER(S.CATEGORY_CODE) LIKE :queryPattern
                    OR LOWER(S.SURVEY_ID) LIKE :queryPattern
                )
               THEN 1
           END
       ) AS FILTERED_COUNT
  FROM "INIT$SVY_TB_SURVEY" S
 WHERE S.TENANT_ID = :tenantId
   AND S.OWNER_USER_ID = :ownerUserId
   AND S.STATUS_CODE <> 'DELETED'
   AND S.ADMIN_TEMPLATE_YN = 'N'
;

-- [SURVEY_PAGE_BY_OWNER]
SELECT S.SURVEY_ID
     , S.SURVEY_TITLE
     , S.CATEGORY_CODE
     , S.STATUS_CODE
     , S.REVISION_NO
     , S.DRAFT_JSON
     , S.PUBLIC_SLUG
     , S.ACTIVE_VERSION_NO
     , S.CREATED_AT
     , S.UPDATED_AT
     , S.PUBLISHED_AT
     , S.SURVEY_START_AT
     , S.SURVEY_CLOSES_AT
     , S.IDENTIFIED_YN
     , S.SHOW_PROGRESS_YN
     , S.TARGET_AUDIENCE
     , S.POPULATION_MODE_CODE
     , S.POPULATION_SIZE
     , S.TARGET_RESPONSE_COUNT
     , CASE
           WHEN S.STATUS_CODE = 'PUBLISHED' AND EXISTS (
                SELECT 1
                  FROM "INIT$SVY_TB_DELIVERY_BATCH" B
                 WHERE B.TENANT_ID = S.TENANT_ID
                   AND B.SURVEY_ID = S.SURVEY_ID
                   AND B.SURVEY_VERSION_NO = S.ACTIVE_VERSION_NO
                   AND B.STATUS_CODE <> 'CANCELLED'
                   AND B.EXECUTION_STATUS_CODE IS NOT NULL
           ) THEN 'ACTIVE'
           WHEN S.STATUS_CODE = 'PUBLISHED' THEN 'READY'
       END AS DEPLOYMENT_STATUS
     , (
           SELECT COUNT(*)
             FROM "INIT$SVY_TB_RESPONSE" R
            WHERE R.TENANT_ID = S.TENANT_ID
              AND R.SURVEY_ID = S.SURVEY_ID
       ) AS RESPONSE_COUNT
  FROM "INIT$SVY_TB_SURVEY" S
 WHERE S.TENANT_ID = :tenantId
   AND S.OWNER_USER_ID = :ownerUserId
   AND S.STATUS_CODE <> 'DELETED'
   AND S.ADMIN_TEMPLATE_YN = 'N'
   AND (:statusCode IS NULL OR S.STATUS_CODE = :statusCode)
   AND (
          :deploymentStage IS NULL
       OR (:deploymentStage = 'ACTIVE' AND S.STATUS_CODE = 'PUBLISHED' AND EXISTS (
              SELECT 1 FROM "INIT$SVY_TB_DELIVERY_BATCH" B
               WHERE B.TENANT_ID = S.TENANT_ID
                 AND B.SURVEY_ID = S.SURVEY_ID
                 AND B.SURVEY_VERSION_NO = S.ACTIVE_VERSION_NO
                 AND B.STATUS_CODE <> 'CANCELLED'
                 AND B.EXECUTION_STATUS_CODE IS NOT NULL
          ))
       OR (:deploymentStage = 'CONFIRMED' AND S.STATUS_CODE = 'PUBLISHED' AND NOT EXISTS (
              SELECT 1 FROM "INIT$SVY_TB_DELIVERY_BATCH" B
               WHERE B.TENANT_ID = S.TENANT_ID
                 AND B.SURVEY_ID = S.SURVEY_ID
                 AND B.SURVEY_VERSION_NO = S.ACTIVE_VERSION_NO
                 AND B.STATUS_CODE <> 'CANCELLED'
                 AND B.EXECUTION_STATUS_CODE IS NOT NULL
          ))
   )
   AND (
          :queryPattern IS NULL
       OR LOWER(S.SURVEY_TITLE) LIKE :queryPattern
       OR LOWER(S.CATEGORY_CODE) LIKE :queryPattern
       OR LOWER(S.SURVEY_ID) LIKE :queryPattern
   )
 ORDER BY CASE WHEN :sortCode = 'responses' THEN (
                  SELECT COUNT(*)
                    FROM "INIT$SVY_TB_RESPONSE" R
                   WHERE R.TENANT_ID = S.TENANT_ID
                     AND R.SURVEY_ID = S.SURVEY_ID
              ) END DESC
        , CASE WHEN :sortCode = 'updated-asc' THEN S.UPDATED_AT END ASC
        , CASE WHEN :sortCode = 'created-desc' THEN S.CREATED_AT END DESC
        , CASE WHEN :sortCode = 'title' THEN LOWER(S.SURVEY_TITLE) END ASC
        , CASE WHEN :sortCode = 'updated-desc' THEN S.UPDATED_AT END DESC
        , LOWER(S.SURVEY_TITLE) ASC
        , S.SURVEY_ID ASC
 OFFSET :offsetRows ROWS FETCH NEXT :limitRows ROWS ONLY
;

-- [SURVEY_DETAIL_BY_OWNER]
SELECT SURVEY_ID
     , TENANT_ID
     , OWNER_USER_ID
     , TEMPLATE_CODE
     , TEMPLATE_VERSION_NO
     , SURVEY_TITLE
     , DESCRIPTION
     , CATEGORY_CODE
     , STATUS_CODE
     , REVISION_NO
     , DRAFT_JSON
     , PUBLIC_SLUG
     , ACTIVE_VERSION_NO
     , CREATED_AT
     , UPDATED_AT
     , PUBLISHED_AT
     , SURVEY_START_AT
     , SURVEY_CLOSES_AT
     , IDENTIFIED_YN
     , SHOW_PROGRESS_YN
     , TARGET_AUDIENCE
     , POPULATION_MODE_CODE
     , POPULATION_SIZE
     , TARGET_RESPONSE_COUNT
     , ADMIN_TEMPLATE_YN
  FROM "INIT$SVY_TB_SURVEY"
 WHERE SURVEY_ID = :surveyId
   AND TENANT_ID = :tenantId
   AND OWNER_USER_ID = :ownerUserId
   AND STATUS_CODE <> 'DELETED'
;

-- [SURVEY_DETAIL_FOR_UPDATE]
SELECT SURVEY_ID
     , TENANT_ID
     , OWNER_USER_ID
     , TEMPLATE_CODE
     , TEMPLATE_VERSION_NO
     , SURVEY_TITLE
     , DESCRIPTION
     , CATEGORY_CODE
     , STATUS_CODE
     , REVISION_NO
     , DRAFT_JSON
     , PUBLIC_SLUG
     , ACTIVE_VERSION_NO
     , CREATED_AT
     , UPDATED_AT
     , PUBLISHED_AT
     , SURVEY_START_AT
     , SURVEY_CLOSES_AT
     , IDENTIFIED_YN
     , SHOW_PROGRESS_YN
     , TARGET_AUDIENCE
     , POPULATION_MODE_CODE
     , POPULATION_SIZE
     , TARGET_RESPONSE_COUNT
     , ADMIN_TEMPLATE_YN
  FROM "INIT$SVY_TB_SURVEY"
 WHERE SURVEY_ID = :surveyId
   AND TENANT_ID = :tenantId
   AND OWNER_USER_ID = :ownerUserId
   AND STATUS_CODE <> 'DELETED'
 FOR UPDATE
;

-- [SURVEY_SOFT_DELETE_BY_OWNER]
UPDATE "INIT$SVY_TB_SURVEY"
   SET STATUS_CODE = 'DELETED'
     , UPDATED_AT = SYSTIMESTAMP
 WHERE SURVEY_ID = :surveyId
   AND TENANT_ID = :tenantId
   AND OWNER_USER_ID = :ownerUserId
   AND STATUS_CODE IN ('DRAFT', 'CLOSED')
;

-- [SURVEY_CLOSE_BY_OWNER]
UPDATE "INIT$SVY_TB_SURVEY"
   SET STATUS_CODE = 'CLOSED'
     , UPDATED_AT = SYSTIMESTAMP
 WHERE SURVEY_ID = :surveyId
   AND TENANT_ID = :tenantId
   AND OWNER_USER_ID = :ownerUserId
   AND STATUS_CODE = 'PUBLISHED'
;

-- [SURVEY_DEPLOYMENT_CLOSE]
UPDATE "INIT$SVY_TB_SURVEY_DEPLOYMENT"
   SET STATUS_CODE = 'CLOSED'
     , UPDATED_AT = SYSTIMESTAMP
 WHERE TENANT_ID = :tenantId
   AND SURVEY_ID = :surveyId
   AND STATUS_CODE IN ('ACTIVE', 'PAUSED')
;

-- [SURVEY_INSERT]
INSERT INTO "INIT$SVY_TB_SURVEY" (
       SURVEY_ID
     , TENANT_ID
     , OWNER_USER_ID
     , TEMPLATE_CODE
     , TEMPLATE_VERSION_NO
     , SURVEY_TITLE
     , DESCRIPTION
     , CATEGORY_CODE
     , STATUS_CODE
     , REVISION_NO
     , DRAFT_JSON
     , SURVEY_START_AT
     , SURVEY_CLOSES_AT
     , IDENTIFIED_YN
     , SHOW_PROGRESS_YN
     , TARGET_AUDIENCE
     , POPULATION_MODE_CODE
     , POPULATION_SIZE
     , TARGET_RESPONSE_COUNT
     , ADMIN_TEMPLATE_YN
     , CREATED_AT
     , UPDATED_AT
) VALUES (
       :surveyId
     , :tenantId
     , :ownerUserId
     , :templateCode
     , :templateVersionNo
     , :surveyTitle
     , :description
     , :categoryCode
     , 'DRAFT'
     , 1
     , :draftJson
     , :surveyStartAt
     , :surveyClosesAt
     , :identifiedYn
     , :showProgressYn
     , :targetAudience
     , :populationModeCode
     , :populationSize
     , :targetResponseCount
     , :adminTemplateYn
     , SYSTIMESTAMP
     , SYSTIMESTAMP
)
;

-- [SURVEY_UPDATE_BY_OWNER]
UPDATE "INIT$SVY_TB_SURVEY"
   SET SURVEY_TITLE = :surveyTitle
     , DESCRIPTION = :description
     , CATEGORY_CODE = :categoryCode
     , SURVEY_START_AT = :surveyStartAt
     , SURVEY_CLOSES_AT = :surveyClosesAt
     , IDENTIFIED_YN = :identifiedYn
     , SHOW_PROGRESS_YN = :showProgressYn
     , TARGET_AUDIENCE = :targetAudience
     , POPULATION_MODE_CODE = :populationModeCode
     , POPULATION_SIZE = :populationSize
     , TARGET_RESPONSE_COUNT = :targetResponseCount
     , DRAFT_JSON = :draftJson
     , REVISION_NO = REVISION_NO + 1
     , UPDATED_AT = SYSTIMESTAMP
 WHERE SURVEY_ID = :surveyId
   AND TENANT_ID = :tenantId
   AND OWNER_USER_ID = :ownerUserId
;

-- [SURVEY_APPLY_TEMPLATE_BY_OWNER]
UPDATE "INIT$SVY_TB_SURVEY"
   SET TEMPLATE_CODE = :templateCode
     , TEMPLATE_VERSION_NO = :templateVersionNo
     , DRAFT_JSON = :draftJson
     , REVISION_NO = REVISION_NO + 1
     , UPDATED_AT = SYSTIMESTAMP
 WHERE SURVEY_ID = :surveyId
   AND TENANT_ID = :tenantId
   AND OWNER_USER_ID = :ownerUserId
   AND STATUS_CODE = 'DRAFT'
   AND ACTIVE_VERSION_NO IS NULL
;

-- [SURVEY_VERSION_NEXT]
SELECT NVL(MAX(VERSION_NO), 0) + 1 AS VERSION_NO
  FROM "INIT$SVY_TB_SURVEY_VERSION"
 WHERE TENANT_ID = :tenantId
   AND SURVEY_ID = :surveyId
;

-- [SURVEY_VERSION_INSERT]
INSERT INTO "INIT$SVY_TB_SURVEY_VERSION" (
       SURVEY_ID
     , VERSION_NO
     , SNAPSHOT_JSON
     , CONTENT_HASH
     , PUBLISHED_BY
     , PUBLISHED_AT
     , TENANT_ID
) VALUES (
       :surveyId
     , :versionNo
     , :snapshotJson
     , :contentHash
     , :publishedBy
     , :publishedAt
     , :tenantId
)
;

-- [SURVEY_VERSION_BY_NO]
SELECT VERSION_NO
     , SNAPSHOT_JSON
     , CONTENT_HASH
     , PUBLISHED_AT
  FROM "INIT$SVY_TB_SURVEY_VERSION"
 WHERE TENANT_ID = :tenantId
   AND SURVEY_ID = :surveyId
   AND VERSION_NO = :versionNo
;

-- [SURVEY_MARK_PUBLISHED_BY_OWNER]
UPDATE "INIT$SVY_TB_SURVEY"
   SET STATUS_CODE = 'PUBLISHED'
     , PUBLIC_SLUG = :publicSlug
     , ACTIVE_VERSION_NO = :versionNo
     , PUBLISHED_AT = :publishedAt
     , UPDATED_AT = :publishedAt
 WHERE SURVEY_ID = :surveyId
   AND TENANT_ID = :tenantId
   AND OWNER_USER_ID = :ownerUserId
;

-- [SURVEY_SLUG_OWNER]
SELECT SURVEY_ID
  FROM "INIT$SVY_TB_SURVEY"
 WHERE PUBLIC_SLUG = :publicSlug
;

-- [SURVEY_PUBLIC_SLUG_REGENERATE_BY_OWNER]
UPDATE "INIT$SVY_TB_SURVEY"
   SET PUBLIC_SLUG = :publicSlug
     , UPDATED_AT = :regeneratedAt
 WHERE SURVEY_ID = :surveyId
   AND TENANT_ID = :tenantId
   AND OWNER_USER_ID = :ownerUserId
   AND STATUS_CODE = 'PUBLISHED'
   AND PUBLIC_SLUG = :previousSlug
;

-- [SURVEY_DEPLOYMENT_SLUG_REGENERATE]
UPDATE "INIT$SVY_TB_SURVEY_DEPLOYMENT"
   SET PUBLIC_SLUG = :publicSlug
     , UPDATED_AT = :regeneratedAt
 WHERE TENANT_ID = :tenantId
   AND SURVEY_ID = :surveyId
   AND PUBLIC_SLUG = :previousSlug
   AND STATUS_CODE = 'ACTIVE'
;

-- [SURVEY_PUBLIC_BY_SLUG]
SELECT S.SURVEY_ID
     , S.TENANT_ID
     , S.PUBLIC_SLUG
     , V.VERSION_NO
     , V.SNAPSHOT_JSON
     , V.CONTENT_HASH
     , V.PUBLISHED_AT
     , T.TENANT_TYPE_CODE
     , T.EXPIRES_AT AS TENANT_EXPIRES_AT
  FROM "INIT$SVY_TB_SURVEY" S
  JOIN "INIT$SVY_TB_SURVEY_VERSION" V
    ON V.TENANT_ID = S.TENANT_ID
   AND V.SURVEY_ID = S.SURVEY_ID
   AND V.VERSION_NO = S.ACTIVE_VERSION_NO
  JOIN "INIT$SVY_TB_TENANT" T
    ON T.TENANT_ID = S.TENANT_ID
 WHERE S.PUBLIC_SLUG = :publicSlug
   AND S.STATUS_CODE = 'PUBLISHED'
   AND T.STATUS_CODE = 'ACTIVE'
   AND T.TENANT_TYPE_CODE = 'MEMBER'
;

-- [SURVEY_DEPLOYMENT_MERGE]
MERGE INTO "INIT$SVY_TB_SURVEY_DEPLOYMENT" D
USING (
    SELECT :tenantId AS TENANT_ID, :surveyId AS SURVEY_ID FROM DUAL
) S
   ON (D.TENANT_ID = S.TENANT_ID AND D.SURVEY_ID = S.SURVEY_ID)
 WHEN MATCHED THEN UPDATE SET
      D.SURVEY_VERSION_NO = :versionNo
    , D.PUBLIC_SLUG = :publicSlug
    , D.STATUS_CODE = 'ACTIVE'
    , D.RESPONSE_POLICY_JSON = :responsePolicyJson
    , D.SKIN_SNAPSHOT_JSON = :skinSnapshotJson
    , D.UPDATED_AT = :publishedAt
 WHEN NOT MATCHED THEN INSERT (
      DEPLOYMENT_ID
    , TENANT_ID
    , SURVEY_ID
    , SURVEY_VERSION_NO
    , PUBLIC_SLUG
    , STATUS_CODE
    , RESPONSE_POLICY_JSON
    , SKIN_SNAPSHOT_JSON
    , CREATED_BY
    , CREATED_AT
    , UPDATED_AT
 ) VALUES (
      :deploymentId
    , :tenantId
    , :surveyId
    , :versionNo
    , :publicSlug
    , 'ACTIVE'
    , :responsePolicyJson
    , :skinSnapshotJson
    , :createdBy
    , :publishedAt
    , :publishedAt
 )
;

-- [SURVEY_LANG_DELETE]
DELETE FROM "INIT$SVY_TB_SURVEY_LANG"
 WHERE TENANT_ID = :tenantId
   AND SURVEY_ID = :surveyId
;

-- [LANGUAGE_MERGE]
MERGE INTO "INIT$SVY_TB_LANGUAGE" L
USING (SELECT :langCode AS LANG_CODE FROM DUAL) S
   ON (L.LANG_CODE = S.LANG_CODE)
 WHEN NOT MATCHED THEN INSERT (
      LANG_CODE
    , LANG_NAME
    , NATIVE_NAME
    , DIRECTION_CODE
    , USE_YN
    , SORT_ORDER
    , CREATED_AT
 ) VALUES (
      :langCode
    , :langName
    , :nativeName
    , :directionCode
    , 'Y'
    , 0
    , SYSTIMESTAMP
 )
;

-- [SURVEY_LANG_INSERT]
INSERT INTO "INIT$SVY_TB_SURVEY_LANG" (
       TENANT_ID
     , SURVEY_ID
     , LANG_CODE
     , DEFAULT_YN
     , USE_YN
     , CREATED_AT
) VALUES (
       :tenantId
     , :surveyId
     , :langCode
     , :defaultYn
     , 'Y'
     , SYSTIMESTAMP
)
;

-- [SURVEY_I18N_DELETE_VERSION]
DELETE FROM "INIT$SVY_TB_SURVEY_I18N"
 WHERE TENANT_ID = :tenantId
   AND SURVEY_ID = :surveyId
   AND VERSION_NO = :versionNo
;

-- [SURVEY_I18N_INSERT]
INSERT INTO "INIT$SVY_TB_SURVEY_I18N" (
       TENANT_ID
     , SURVEY_ID
     , VERSION_NO
     , LANG_CODE
     , RESOURCE_TYPE_CODE
     , RESOURCE_ID
     , FIELD_CODE
     , TEXT_VALUE
     , CREATED_AT
) VALUES (
       :tenantId
     , :surveyId
     , :versionNo
     , :langCode
     , :resourceTypeCode
     , :resourceId
     , :fieldCode
     , :textValue
     , SYSTIMESTAMP
)
;

-- [PAGE_HELP_SELECT]
SELECT MENU_ID
     , LANG_CODE
     , HELP_TITLE
     , HELP_BODY
     , GUIDE_JSON
  FROM "INIT$SVY_TB_PAGE_HELP"
 WHERE MENU_ID = :menuId
   AND LANG_CODE = :langCode
   AND USE_YN = 'Y'
;

-- [SURVEY_PUBLIC_LINKS_BY_OWNER]
SELECT S.SURVEY_ID
     , S.PUBLIC_SLUG
     , S.STATUS_CODE
     , V.VERSION_NO
     , COALESCE(
           (SELECT L.LOCALIZED_TITLE
              FROM JSON_TABLE(V.SNAPSHOT_JSON, '$.translations.keyvalue()'
                   COLUMNS (
                       LOCALE_KEY VARCHAR2(100) PATH '$.key'
                     , LOCALIZED_TITLE VARCHAR2(2000) PATH '$.value.title' ERROR ON ERROR NULL ON EMPTY
                   )) L
             WHERE L.LOCALE_KEY = JSON_VALUE(V.SNAPSHOT_JSON, '$.defaultLocale'))
         , JSON_VALUE(V.SNAPSHOT_JSON, '$.title' RETURNING VARCHAR2(2000) ERROR ON ERROR)
       ) AS PUBLISHED_TITLE
     , JSON_QUERY(V.SNAPSHOT_JSON, '$.settings.audienceRoutes' RETURNING CLOB ERROR ON ERROR NULL ON EMPTY) AS AUDIENCE_ROUTES_JSON
     , JSON_VALUE(V.SNAPSHOT_JSON, '$.settings.defaultAudience' RETURNING VARCHAR2(40) ERROR ON ERROR NULL ON EMPTY) AS DEFAULT_AUDIENCE
     , JSON_VALUE(V.SNAPSHOT_JSON, '$.guestDemo') AS GUEST_DEMO
  FROM "INIT$SVY_TB_SURVEY" S
  JOIN "INIT$SVY_TB_TENANT" T ON T.TENANT_ID = S.TENANT_ID
  LEFT JOIN "INIT$SVY_TB_SURVEY_VERSION" V
    ON V.TENANT_ID = S.TENANT_ID
   AND V.SURVEY_ID = S.SURVEY_ID
   AND V.VERSION_NO = S.ACTIVE_VERSION_NO
 WHERE S.SURVEY_ID = :surveyId
   AND S.TENANT_ID = :tenantId
   AND S.OWNER_USER_ID = :ownerUserId
   AND S.STATUS_CODE <> 'DELETED'
   AND T.STATUS_CODE = 'ACTIVE'
   AND T.TENANT_TYPE_CODE = 'MEMBER'
;
