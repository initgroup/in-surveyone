/*
 * IN-SURVEYONE Oracle data reset script
 *
 * !!! DESTRUCTIVE OPERATION !!!
 * This permanently empties every INIT$SVY_ table while preserving tables,
 * indexes, constraints and PL/SQL objects. TRUNCATE commits implicitly and
 * cannot be rolled back. Take and verify a database backup first.
 *
 * Project foreign keys that are currently enabled are disabled temporarily
 * and restored with ENABLE VALIDATE. Originally disabled keys remain disabled.
 * An enabled foreign key from a non-project table causes a fail-fast stop.
 * Re-running against already-empty tables is safe.
 */
WHENEVER SQLERROR EXIT SQL.SQLCODE ROLLBACK

SET SERVEROUTPUT ON

DECLARE
    TYPE NAME_LIST IS TABLE OF VARCHAR2(128 BYTE) INDEX BY PLS_INTEGER;
    V_TABLE_NAMES NAME_LIST;
    V_CONSTRAINT_NAMES NAME_LIST;
    V_CONSTRAINT_TABLES NAME_LIST;
    V_TABLE_COUNT PLS_INTEGER := 0;
    V_CONSTRAINT_COUNT PLS_INTEGER := 0;
    V_SCHEMA_NAME VARCHAR2(128 BYTE) := USER;
    V_CATALOG_REFERENCE_COUNT NUMBER;
    V_EXTERNAL_REFERENCE_COUNT NUMBER;
    V_RESTORE_ERROR_COUNT PLS_INTEGER := 0;
    V_FIRST_RESTORE_ERROR VARCHAR2(4000 BYTE);

    PROCEDURE RESTORE_CONSTRAINTS(
        P_ERROR_COUNT OUT PLS_INTEGER
      , P_FIRST_ERROR OUT VARCHAR2
    ) IS
    BEGIN
        P_ERROR_COUNT := 0;
        P_FIRST_ERROR := NULL;

        IF V_CONSTRAINT_COUNT = 0 THEN
            RETURN;
        END IF;

        FOR I IN 1 .. V_CONSTRAINT_COUNT LOOP
            BEGIN
                EXECUTE IMMEDIATE
                    'ALTER TABLE "' || V_CONSTRAINT_TABLES(I)
                 || '" ENABLE VALIDATE CONSTRAINT "' || V_CONSTRAINT_NAMES(I) || '"';
                DBMS_OUTPUT.PUT_LINE('[ENABLED] ' || V_CONSTRAINT_NAMES(I));
            EXCEPTION
                WHEN OTHERS THEN
                    P_ERROR_COUNT := P_ERROR_COUNT + 1;
                    IF P_FIRST_ERROR IS NULL THEN
                        P_FIRST_ERROR := V_CONSTRAINT_NAMES(I) || ' - ' || SQLERRM;
                    END IF;
                    DBMS_OUTPUT.PUT_LINE(
                        '[RESTORE ERROR] ' || V_CONSTRAINT_NAMES(I) || ' - ' || SQLERRM
                    );
            END;
        END LOOP;
    END;
BEGIN
    /*
     * A cross-schema enabled FK can make TRUNCATE fail after earlier tables
     * were already emptied. Require DBA catalog visibility and fail closed.
     */
    BEGIN
        EXECUTE IMMEDIATE q'[
            SELECT COUNT(*)
              FROM DBA_CONSTRAINTS F
              JOIN DBA_CONSTRAINTS P
                ON P.OWNER = F.R_OWNER
               AND P.CONSTRAINT_NAME = F.R_CONSTRAINT_NAME
             WHERE F.CONSTRAINT_TYPE = 'R'
               AND F.STATUS = 'ENABLED'
               AND P.OWNER = :PROJECT_OWNER
               AND SUBSTR(P.TABLE_NAME, 1, 9) = 'INIT$SVY_'
               AND (
                    F.OWNER <> :CURRENT_OWNER
                 OR SUBSTR(F.TABLE_NAME, 1, 9) <> 'INIT$SVY_'
               )
        ]'
        INTO V_CATALOG_REFERENCE_COUNT
        USING V_SCHEMA_NAME, V_SCHEMA_NAME;
    EXCEPTION
        WHEN OTHERS THEN
            RAISE_APPLICATION_ERROR(
                -20022
              , 'Reset stopped: DBA_CONSTRAINTS preflight is required. '
             || 'Run with catalog-read privilege. ' || SUBSTR(SQLERRM, 1, 1300)
            );
    END;

    IF V_CATALOG_REFERENCE_COUNT > 0 THEN
        RAISE_APPLICATION_ERROR(
            -20023
          , 'Reset stopped: another schema or non-project table has an enabled FK to INIT$SVY_.'
        );
    END IF;

    SELECT COUNT(*)
      INTO V_EXTERNAL_REFERENCE_COUNT
      FROM USER_CONSTRAINTS F
      JOIN USER_CONSTRAINTS P
        ON P.CONSTRAINT_NAME = F.R_CONSTRAINT_NAME
     WHERE F.CONSTRAINT_TYPE = 'R'
       AND F.STATUS = 'ENABLED'
       AND SUBSTR(P.TABLE_NAME, 1, 9) = 'INIT$SVY_'
       AND SUBSTR(F.TABLE_NAME, 1, 9) <> 'INIT$SVY_';

    IF V_EXTERNAL_REFERENCE_COUNT > 0 THEN
        RAISE_APPLICATION_ERROR(
            -20020
          , 'Reset stopped: non-project tables have enabled foreign keys to INIT$SVY_ tables.'
        );
    END IF;

    FOR R IN (
        SELECT TABLE_NAME, CONSTRAINT_NAME
          FROM USER_CONSTRAINTS
         WHERE CONSTRAINT_TYPE = 'R'
           AND STATUS = 'ENABLED'
           AND SUBSTR(TABLE_NAME, 1, 9) = 'INIT$SVY_'
         ORDER BY TABLE_NAME, CONSTRAINT_NAME
    ) LOOP
        V_CONSTRAINT_COUNT := V_CONSTRAINT_COUNT + 1;
        V_CONSTRAINT_TABLES(V_CONSTRAINT_COUNT) := R.TABLE_NAME;
        V_CONSTRAINT_NAMES(V_CONSTRAINT_COUNT) := R.CONSTRAINT_NAME;

        EXECUTE IMMEDIATE
            'ALTER TABLE "' || R.TABLE_NAME || '" DISABLE CONSTRAINT "'
         || R.CONSTRAINT_NAME || '"';
        DBMS_OUTPUT.PUT_LINE('[DISABLED] ' || R.CONSTRAINT_NAME);
    END LOOP;

    FOR R IN (
        SELECT TABLE_NAME
          FROM USER_TABLES
         WHERE SUBSTR(TABLE_NAME, 1, 9) = 'INIT$SVY_'
         ORDER BY TABLE_NAME
    ) LOOP
        V_TABLE_COUNT := V_TABLE_COUNT + 1;
        V_TABLE_NAMES(V_TABLE_COUNT) := R.TABLE_NAME;
        EXECUTE IMMEDIATE 'TRUNCATE TABLE "' || R.TABLE_NAME || '" DROP STORAGE';
        DBMS_OUTPUT.PUT_LINE('[EMPTIED] ' || R.TABLE_NAME);
    END LOOP;

    RESTORE_CONSTRAINTS(V_RESTORE_ERROR_COUNT, V_FIRST_RESTORE_ERROR);
    IF V_RESTORE_ERROR_COUNT > 0 THEN
        RAISE_APPLICATION_ERROR(
            -20021
          , 'Reset completed, but ' || V_RESTORE_ERROR_COUNT
         || ' foreign key(s) could not be restored. First error: '
         || SUBSTR(V_FIRST_RESTORE_ERROR, 1, 1700)
        );
    END IF;
    DBMS_OUTPUT.PUT_LINE('[DONE] ' || V_TABLE_COUNT || ' INIT$SVY_ tables are empty.');
EXCEPTION
    WHEN OTHERS THEN
        RESTORE_CONSTRAINTS(V_RESTORE_ERROR_COUNT, V_FIRST_RESTORE_ERROR);
        RAISE;
END;
/
