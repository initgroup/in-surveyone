-- Deployment planning is intentionally separate from the immutable public
-- survey snapshot. Every statement scopes tenant, survey and owning user.

-- [DELIVERY_CONTEXT_BY_OWNER]
SELECT S.SURVEY_ID
     , S.ACTIVE_VERSION_NO AS SURVEY_VERSION_NO
     , S.PUBLIC_SLUG
     , D.DEPLOYMENT_ID
     , D.STATUS_CODE AS DEPLOYMENT_STATUS_CODE
     , V.SNAPSHOT_JSON
  FROM "INIT$SVY_TB_SURVEY" S
  JOIN "INIT$SVY_TB_SURVEY_DEPLOYMENT" D
    ON D.TENANT_ID = S.TENANT_ID
   AND D.SURVEY_ID = S.SURVEY_ID
   AND D.SURVEY_VERSION_NO = S.ACTIVE_VERSION_NO
  JOIN "INIT$SVY_TB_SURVEY_VERSION" V
    ON V.TENANT_ID = S.TENANT_ID
   AND V.SURVEY_ID = S.SURVEY_ID
   AND V.VERSION_NO = S.ACTIVE_VERSION_NO
 WHERE S.TENANT_ID = :tenantId
   AND S.SURVEY_ID = :surveyId
   AND S.OWNER_USER_ID = :ownerUserId
   AND S.STATUS_CODE = 'PUBLISHED'
   AND S.ACTIVE_VERSION_NO IS NOT NULL
   AND D.STATUS_CODE = 'ACTIVE'
;

-- [DELIVERY_BATCH_LATEST]
SELECT B.BATCH_ID
     , B.TENANT_ID
     , B.SURVEY_ID
     , B.SURVEY_VERSION_NO
     , B.DEPLOYMENT_ID
     , B.REVISION_NO
     , B.STATUS_CODE
     , B.PLAN_JSON
     , B.EXECUTION_STATUS_CODE
     , B.CREATED_BY
     , B.CREATED_AT
     , B.UPDATED_AT
  FROM "INIT$SVY_TB_DELIVERY_BATCH" B
 WHERE B.TENANT_ID = :tenantId
   AND B.SURVEY_ID = :surveyId
   AND B.DEPLOYMENT_ID = :deploymentId
   AND B.SURVEY_VERSION_NO = :surveyVersionNo
   AND B.STATUS_CODE <> 'CANCELLED'
 ORDER BY B.UPDATED_AT DESC NULLS LAST, B.CREATED_AT DESC, B.BATCH_ID DESC
 FETCH FIRST 1 ROW ONLY
;

-- [DELIVERY_BATCH_LATEST_FOR_UPDATE]
SELECT B.BATCH_ID
     , B.TENANT_ID
     , B.SURVEY_ID
     , B.SURVEY_VERSION_NO
     , B.DEPLOYMENT_ID
     , B.REVISION_NO
     , B.STATUS_CODE
     , B.PLAN_JSON
     , B.EXECUTION_STATUS_CODE
     , B.CREATED_BY
     , B.CREATED_AT
     , B.UPDATED_AT
  FROM "INIT$SVY_TB_DELIVERY_BATCH" B
 WHERE B.TENANT_ID = :tenantId
   AND B.SURVEY_ID = :surveyId
   AND B.DEPLOYMENT_ID = :deploymentId
   AND B.SURVEY_VERSION_NO = :surveyVersionNo
   AND B.STATUS_CODE <> 'CANCELLED'
   AND B.BATCH_ID = (
         SELECT L.BATCH_ID
           FROM "INIT$SVY_TB_DELIVERY_BATCH" L
          WHERE L.TENANT_ID = :tenantId
            AND L.SURVEY_ID = :surveyId
            AND L.DEPLOYMENT_ID = :deploymentId
            AND L.SURVEY_VERSION_NO = :surveyVersionNo
            AND L.STATUS_CODE <> 'CANCELLED'
          ORDER BY L.UPDATED_AT DESC NULLS LAST, L.CREATED_AT DESC, L.BATCH_ID DESC
          FETCH FIRST 1 ROW ONLY
       )
 FOR UPDATE
;

-- [DELIVERY_TARGET_LIST]
SELECT T.TARGET_ID
     , T.CLIENT_TARGET_ID
     , T.DISPLAY_NAME
     , T.COUNTRY_CODE
     , T.PREFERRED_LANG_CODE
     , T.ATTRIBUTES_JSON
     , T.STATUS_CODE
     , T.RETENTION_UNTIL
     , T.CREATED_AT
     , T.UPDATED_AT
  FROM "INIT$SVY_TB_DELIVERY_TARGET" T
 WHERE T.TENANT_ID = :tenantId
   AND T.SURVEY_ID = :surveyId
   AND T.SURVEY_VERSION_NO = :surveyVersionNo
   AND T.DEPLOYMENT_ID = :deploymentId
   AND T.BATCH_ID = :batchId
 ORDER BY T.CREATED_AT, T.TARGET_ID
;

-- [DELIVERY_RECIPIENT_LIST]
SELECT R.RECIPIENT_ID
     , R.TARGET_ID
     , R.CONTACT_TYPE_CODE
     , R.CONTACT_VALUE_HASH
     , R.CONTACT_VALUE_ENCRYPTED
     , R.STATUS_CODE
     , R.RETENTION_UNTIL
  FROM "INIT$SVY_TB_DELIVERY_RECIPIENT" R
 WHERE R.TENANT_ID = :tenantId
   AND R.SURVEY_ID = :surveyId
   AND R.SURVEY_VERSION_NO = :surveyVersionNo
   AND R.DEPLOYMENT_ID = :deploymentId
   AND EXISTS (
         SELECT 1
           FROM "INIT$SVY_TB_DELIVERY_TARGET" T
          WHERE T.TENANT_ID = R.TENANT_ID
            AND T.TARGET_ID = R.TARGET_ID
            AND T.SURVEY_VERSION_NO = R.SURVEY_VERSION_NO
            AND T.BATCH_ID = :batchId
       )
 ORDER BY R.TARGET_ID, R.CONTACT_TYPE_CODE
;

-- [DELIVERY_BATCH_INSERT]
INSERT INTO "INIT$SVY_TB_DELIVERY_BATCH" (
       BATCH_ID
     , TENANT_ID
     , SURVEY_ID
     , SURVEY_VERSION_NO
     , DEPLOYMENT_ID
     , REVISION_NO
     , STATUS_CODE
     , PLAN_JSON
     , EXECUTION_STATUS_CODE
     , CREATED_BY
     , CREATED_AT
     , UPDATED_AT
) VALUES (
       :batchId
     , :tenantId
     , :surveyId
     , :surveyVersionNo
     , :deploymentId
     , 1
     , 'DRAFT'
     , :planJson
     , NULL
     , :createdBy
     , :updatedAt
     , :updatedAt
)
;

-- [DELIVERY_BATCH_UPDATE_DRAFT]
UPDATE "INIT$SVY_TB_DELIVERY_BATCH"
   SET PLAN_JSON = :planJson
     , REVISION_NO = REVISION_NO + 1
     , EXECUTION_STATUS_CODE = NULL
     , UPDATED_AT = :updatedAt
 WHERE TENANT_ID = :tenantId
   AND SURVEY_ID = :surveyId
   AND SURVEY_VERSION_NO = :surveyVersionNo
   AND DEPLOYMENT_ID = :deploymentId
   AND BATCH_ID = :batchId
   AND REVISION_NO = :expectedRevision
   AND STATUS_CODE = 'DRAFT'
;

-- [DELIVERY_RECIPIENT_DELETE_DRAFT]
DELETE FROM "INIT$SVY_TB_DELIVERY_RECIPIENT" R
 WHERE R.TENANT_ID = :tenantId
   AND R.SURVEY_ID = :surveyId
   AND R.SURVEY_VERSION_NO = :surveyVersionNo
   AND R.DEPLOYMENT_ID = :deploymentId
   AND EXISTS (
         SELECT 1
           FROM "INIT$SVY_TB_DELIVERY_TARGET" T
          WHERE T.TENANT_ID = R.TENANT_ID
            AND T.TARGET_ID = R.TARGET_ID
            AND T.SURVEY_VERSION_NO = R.SURVEY_VERSION_NO
            AND T.BATCH_ID = :batchId
       )
   AND EXISTS (
         SELECT 1
           FROM "INIT$SVY_TB_DELIVERY_BATCH" B
          WHERE B.TENANT_ID = R.TENANT_ID
            AND B.SURVEY_ID = R.SURVEY_ID
            AND B.SURVEY_VERSION_NO = R.SURVEY_VERSION_NO
            AND B.DEPLOYMENT_ID = R.DEPLOYMENT_ID
            AND B.BATCH_ID = :batchId
            AND B.STATUS_CODE = 'DRAFT'
       )
;

-- [DELIVERY_TARGET_DELETE_DRAFT]
DELETE FROM "INIT$SVY_TB_DELIVERY_TARGET" T
 WHERE T.TENANT_ID = :tenantId
   AND T.SURVEY_ID = :surveyId
   AND T.SURVEY_VERSION_NO = :surveyVersionNo
   AND T.DEPLOYMENT_ID = :deploymentId
   AND T.BATCH_ID = :batchId
   AND EXISTS (
         SELECT 1
           FROM "INIT$SVY_TB_DELIVERY_BATCH" B
          WHERE B.TENANT_ID = T.TENANT_ID
            AND B.SURVEY_ID = T.SURVEY_ID
            AND B.SURVEY_VERSION_NO = T.SURVEY_VERSION_NO
            AND B.DEPLOYMENT_ID = T.DEPLOYMENT_ID
            AND B.BATCH_ID = :batchId
            AND B.STATUS_CODE = 'DRAFT'
       )
;

-- [DELIVERY_TARGET_INSERT]
INSERT INTO "INIT$SVY_TB_DELIVERY_TARGET" (
       TARGET_ID
     , CLIENT_TARGET_ID
     , TENANT_ID
     , SURVEY_ID
     , SURVEY_VERSION_NO
     , DEPLOYMENT_ID
     , BATCH_ID
     , DISPLAY_NAME
     , COUNTRY_CODE
     , PREFERRED_LANG_CODE
     , ATTRIBUTES_JSON
     , STATUS_CODE
     , RETENTION_UNTIL
     , CREATED_AT
     , UPDATED_AT
) VALUES (
       :targetId
     , :clientTargetId
     , :tenantId
     , :surveyId
     , :surveyVersionNo
     , :deploymentId
     , :batchId
     , :displayName
     , :countryCode
     , :preferredLangCode
     , :attributesJson
     , 'READY'
     , :retentionUntil
     , :createdAt
     , :createdAt
)
;

-- [DELIVERY_RECIPIENT_INSERT]
INSERT INTO "INIT$SVY_TB_DELIVERY_RECIPIENT" (
       RECIPIENT_ID
     , TENANT_ID
     , SURVEY_ID
     , SURVEY_VERSION_NO
     , DEPLOYMENT_ID
     , CONTACT_TYPE_CODE
     , CONTACT_VALUE_HASH
     , CONTACT_VALUE_ENCRYPTED
     , DISPLAY_NAME
     , ATTRIBUTES_JSON
     , STATUS_CODE
     , RETENTION_UNTIL
     , CREATED_AT
     , UPDATED_AT
     , TARGET_ID
) VALUES (
       :recipientId
     , :tenantId
     , :surveyId
     , :surveyVersionNo
     , :deploymentId
     , :contactTypeCode
     , :contactValueHash
     , :contactValueEncrypted
     , :displayName
     , :attributesJson
     , 'READY'
     , :retentionUntil
     , :createdAt
     , :createdAt
     , :targetId
)
;

-- [DELIVERY_QUEUE_INSERT]
INSERT INTO "INIT$SVY_TB_DELIVERY" (
       DELIVERY_ID
     , TENANT_ID
     , SURVEY_ID
     , SURVEY_VERSION_NO
     , DEPLOYMENT_ID
     , RECIPIENT_ID
     , CHANNEL_CODE
     , PROVIDER_CODE
     , STATUS_CODE
     , MESSAGE_TEMPLATE_JSON
     , PROVIDER_MESSAGE_ID
     , ATTEMPT_COUNT
     , SCHEDULED_AT
     , SENT_AT
     , LAST_ERROR_CODE
     , CREATED_AT
     , UPDATED_AT
     , BATCH_ID
     , LANG_CODE
) VALUES (
       :deliveryId
     , :tenantId
     , :surveyId
     , :surveyVersionNo
     , :deploymentId
     , :recipientId
     , :channelCode
     , :providerCode
     , :statusCode
     , :messageTemplateJson
     , NULL
     , 0
     , :scheduledAt
     , NULL
     , :lastErrorCode
     , :createdAt
     , :createdAt
     , :batchId
     , :langCode
)
;

-- [DELIVERY_BATCH_MARK_EXECUTED]
UPDATE "INIT$SVY_TB_DELIVERY_BATCH"
   SET STATUS_CODE = 'EXECUTED'
     , EXECUTION_STATUS_CODE = :executionStatusCode
     , UPDATED_AT = :updatedAt
 WHERE TENANT_ID = :tenantId
   AND SURVEY_ID = :surveyId
   AND SURVEY_VERSION_NO = :surveyVersionNo
   AND DEPLOYMENT_ID = :deploymentId
   AND BATCH_ID = :batchId
   AND REVISION_NO = :expectedRevision
   AND STATUS_CODE = 'DRAFT'
;
