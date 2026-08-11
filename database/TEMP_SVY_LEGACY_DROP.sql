/*
 * Temporary legacy cleanup for IN-SURVEYONE.
 *
 * !!! DESTRUCTIVE OPERATION !!!
 * This script drops only TABLE and standalone FUNCTION objects in the current
 * schema whose names start with SVY$. It never selects INIT$SVY_ objects.
 * Table data, grants, indexes, constraints, and dependent table-owned objects
 * removed by CASCADE/PURGE cannot be recovered without a verified DB backup.
 *
 * Required before execution:
 *   1. Connect as the owning INIT$BASE02 application schema.
 *   2. Take and verify an Oracle backup/export.
 *   3. Review the preview query below.
 *   4. Run this temporary file only when the legacy objects must be removed.
 *
 * This file is intentionally not called by the application, DDL, ALT, tests,
 * or deployment scripts. Re-running after a successful cleanup is safe.
 */
WHENEVER SQLERROR EXIT SQL.SQLCODE ROLLBACK

SET SERVEROUTPUT ON
SET VERIFY OFF

DEFINE CONFIRM_SVY_LEGACY_DROP = 'DROP_SVY_LEGACY'

PROMPT ================================================================
PROMPT Preview: legacy SVY$ tables and standalone functions to be dropped
PROMPT ================================================================

SELECT OBJECT_TYPE, OBJECT_NAME, STATUS
  FROM USER_OBJECTS
 WHERE SUBSTR(OBJECT_NAME, 1, 4) = 'SVY$'
   AND OBJECT_TYPE IN ('TABLE', 'FUNCTION')
 ORDER BY OBJECT_TYPE, OBJECT_NAME;

PROMPT
PROMPT EXECUTION ENABLED: the listed SVY$ objects will now be removed.

DECLARE
    V_EXPECTED_SCHEMA CONSTANT VARCHAR2(128 BYTE) := 'INIT$BASE02';
    V_CONFIRMATION VARCHAR2(40 BYTE) := UPPER(TRIM('&&CONFIRM_SVY_LEGACY_DROP'));
    V_EXTERNAL_FK_COUNT NUMBER := 0;
    V_EXTERNAL_DEPENDENCY_COUNT NUMBER := 0;
    V_FUNCTION_COUNT PLS_INTEGER := 0;
    V_TABLE_COUNT PLS_INTEGER := 0;
BEGIN
    IF USER <> V_EXPECTED_SCHEMA THEN
        RAISE_APPLICATION_ERROR(
            -20104
          , 'Legacy cleanup stopped: connect as INIT$BASE02. Current schema=' || USER
        );
    END IF;

    IF V_CONFIRMATION <> 'DROP_SVY_LEGACY' THEN
        RAISE_APPLICATION_ERROR(
            -20100
          , 'Legacy cleanup stopped: execution confirmation is not enabled.'
        );
    END IF;

    /* Only current-schema dictionary views are required for the object owner. */
    SELECT COUNT(*)
      INTO V_EXTERNAL_FK_COUNT
      FROM USER_CONSTRAINTS F
      JOIN USER_CONSTRAINTS P
        ON P.CONSTRAINT_NAME = F.R_CONSTRAINT_NAME
     WHERE F.CONSTRAINT_TYPE = 'R'
       AND SUBSTR(P.TABLE_NAME, 1, 4) = 'SVY$'
       AND SUBSTR(F.TABLE_NAME, 1, 4) <> 'SVY$';

    SELECT COUNT(*)
      INTO V_EXTERNAL_DEPENDENCY_COUNT
      FROM USER_DEPENDENCIES
     WHERE REFERENCED_OWNER = USER
       AND SUBSTR(REFERENCED_NAME, 1, 4) = 'SVY$'
       AND SUBSTR(NAME, 1, 4) <> 'SVY$';

    IF V_EXTERNAL_FK_COUNT > 0 THEN
        RAISE_APPLICATION_ERROR(
            -20102
          , 'Legacy cleanup stopped: non-SVY$ table FK(s) in INIT$BASE02 reference SVY$ tables.'
        );
    END IF;

    IF V_EXTERNAL_DEPENDENCY_COUNT > 0 THEN
        RAISE_APPLICATION_ERROR(
            -20103
          , 'Legacy cleanup stopped: non-SVY$ object(s) in INIT$BASE02 depend on SVY$ objects.'
        );
    END IF;

    FOR R IN (
        SELECT OBJECT_NAME
          FROM USER_OBJECTS
         WHERE SUBSTR(OBJECT_NAME, 1, 4) = 'SVY$'
           AND OBJECT_TYPE = 'FUNCTION'
         ORDER BY OBJECT_NAME
    ) LOOP
        EXECUTE IMMEDIATE
            'DROP FUNCTION "' || REPLACE(R.OBJECT_NAME, '"', '""') || '"';
        V_FUNCTION_COUNT := V_FUNCTION_COUNT + 1;
        DBMS_OUTPUT.PUT_LINE('[REMOVED] FUNCTION ' || R.OBJECT_NAME);
    END LOOP;

    FOR R IN (
        SELECT TABLE_NAME
          FROM USER_TABLES
         WHERE SUBSTR(TABLE_NAME, 1, 4) = 'SVY$'
         ORDER BY TABLE_NAME
    ) LOOP
        EXECUTE IMMEDIATE
            'DROP TABLE "' || REPLACE(R.TABLE_NAME, '"', '""') || '"'
         || ' CASCADE CONSTRAINTS PURGE';
        V_TABLE_COUNT := V_TABLE_COUNT + 1;
        DBMS_OUTPUT.PUT_LINE('[REMOVED] TABLE ' || R.TABLE_NAME);
    END LOOP;

    DBMS_OUTPUT.PUT_LINE(
        '[DONE] Legacy cleanup completed. Functions=' || V_FUNCTION_COUNT
     || ', Tables=' || V_TABLE_COUNT
    );
END;
/

UNDEFINE CONFIRM_SVY_LEGACY_DROP
