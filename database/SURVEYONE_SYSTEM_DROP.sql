/*
 * IN-SURVEYONE Oracle object removal script
 *
 * !!! DESTRUCTIVE OPERATION !!!
 * This permanently removes every schema object whose name starts with
 * INIT$SVY_. Data cannot be recovered by re-running the DDL.
 *
 * Scope guard: legacy SVY$_* objects and unrelated schema objects are never
 * selected. Take and verify a database backup before script execution.
 * Re-running after a successful removal is safe and produces only the final
 * completion message.
 */
WHENEVER SQLERROR EXIT SQL.SQLCODE ROLLBACK

SET SERVEROUTPUT ON

DECLARE
    V_SCHEMA_NAME VARCHAR2(128 BYTE) := USER;
    V_CATALOG_FK_COUNT NUMBER;
    V_CATALOG_DEPENDENCY_COUNT NUMBER;
    V_EXTERNAL_FK_COUNT NUMBER;
    V_EXTERNAL_DEPENDENCY_COUNT NUMBER;

    PROCEDURE RUN_DDL(P_DDL IN VARCHAR2, P_LABEL IN VARCHAR2) IS
    BEGIN
        EXECUTE IMMEDIATE P_DDL;
        DBMS_OUTPUT.PUT_LINE('[REMOVED] ' || P_LABEL);
    END;
BEGIN
    /*
     * CASCADE can remove a foreign key owned by another schema. Require DBA
     * catalog visibility and fail closed when that preflight cannot run.
     */
    BEGIN
        EXECUTE IMMEDIATE q'[
            SELECT COUNT(*)
              FROM DBA_CONSTRAINTS F
              JOIN DBA_CONSTRAINTS P
                ON P.OWNER = F.R_OWNER
               AND P.CONSTRAINT_NAME = F.R_CONSTRAINT_NAME
             WHERE F.CONSTRAINT_TYPE = 'R'
               AND P.OWNER = :PROJECT_OWNER
               AND SUBSTR(P.TABLE_NAME, 1, 9) = 'INIT$SVY_'
               AND (
                    F.OWNER <> :CURRENT_OWNER
                 OR SUBSTR(F.TABLE_NAME, 1, 9) <> 'INIT$SVY_'
               )
        ]'
        INTO V_CATALOG_FK_COUNT
        USING V_SCHEMA_NAME, V_SCHEMA_NAME;

        EXECUTE IMMEDIATE q'[
            SELECT COUNT(*)
              FROM DBA_DEPENDENCIES
             WHERE REFERENCED_OWNER = :PROJECT_OWNER
               AND SUBSTR(REFERENCED_NAME, 1, 9) = 'INIT$SVY_'
               AND (
                    OWNER <> :CURRENT_OWNER
                 OR SUBSTR(NAME, 1, 9) <> 'INIT$SVY_'
               )
        ]'
        INTO V_CATALOG_DEPENDENCY_COUNT
        USING V_SCHEMA_NAME, V_SCHEMA_NAME;
    EXCEPTION
        WHEN OTHERS THEN
            RAISE_APPLICATION_ERROR(
                -20032
              , 'Drop stopped: DBA_CONSTRAINTS/DBA_DEPENDENCIES preflight is required. '
             || 'Run with catalog-read privilege. ' || SUBSTR(SQLERRM, 1, 1200)
            );
    END;

    IF V_CATALOG_FK_COUNT > 0 THEN
        RAISE_APPLICATION_ERROR(
            -20033
          , 'Drop stopped: another schema or non-project table has an FK to INIT$SVY_.'
        );
    END IF;

    IF V_CATALOG_DEPENDENCY_COUNT > 0 THEN
        RAISE_APPLICATION_ERROR(
            -20034
          , 'Drop stopped: another schema or non-project object depends on INIT$SVY_.'
        );
    END IF;

    /* Never let CASCADE remove a foreign key owned by a non-project table. */
    SELECT COUNT(*)
      INTO V_EXTERNAL_FK_COUNT
      FROM USER_CONSTRAINTS F
      JOIN USER_CONSTRAINTS P
        ON P.CONSTRAINT_NAME = F.R_CONSTRAINT_NAME
     WHERE F.CONSTRAINT_TYPE = 'R'
       AND SUBSTR(P.TABLE_NAME, 1, 9) = 'INIT$SVY_'
       AND SUBSTR(F.TABLE_NAME, 1, 9) <> 'INIT$SVY_';

    IF V_EXTERNAL_FK_COUNT > 0 THEN
        RAISE_APPLICATION_ERROR(
            -20030
          , 'Drop stopped: non-project tables have foreign keys to INIT$SVY_ tables.'
        );
    END IF;

    /* Dropping project code must not silently invalidate non-project code/views. */
    SELECT COUNT(*)
      INTO V_EXTERNAL_DEPENDENCY_COUNT
      FROM USER_DEPENDENCIES
     WHERE REFERENCED_OWNER = USER
       AND SUBSTR(REFERENCED_NAME, 1, 9) = 'INIT$SVY_'
       AND SUBSTR(NAME, 1, 9) <> 'INIT$SVY_';

    IF V_EXTERNAL_DEPENDENCY_COUNT > 0 THEN
        RAISE_APPLICATION_ERROR(
            -20031
          , 'Drop stopped: non-project objects depend on INIT$SVY_ objects.'
        );
    END IF;

    /* Remove code and query objects before their table dependencies. */
    FOR R IN (
        SELECT OBJECT_NAME, OBJECT_TYPE
          FROM USER_OBJECTS
         WHERE SUBSTR(OBJECT_NAME, 1, 9) = 'INIT$SVY_'
           AND OBJECT_TYPE IN (
               'TRIGGER', 'VIEW', 'MATERIALIZED VIEW', 'FUNCTION', 'PROCEDURE',
               'PACKAGE', 'TYPE', 'SEQUENCE', 'SYNONYM'
           )
         ORDER BY CASE OBJECT_TYPE
                    WHEN 'TRIGGER' THEN 1
                    WHEN 'VIEW' THEN 2
                    WHEN 'MATERIALIZED VIEW' THEN 3
                    WHEN 'FUNCTION' THEN 4
                    WHEN 'PROCEDURE' THEN 5
                    WHEN 'PACKAGE' THEN 6
                    WHEN 'TYPE' THEN 7
                    WHEN 'SEQUENCE' THEN 8
                    WHEN 'SYNONYM' THEN 9
                    ELSE 10
                  END,
                  OBJECT_NAME
    ) LOOP
        IF R.OBJECT_TYPE = 'MATERIALIZED VIEW' THEN
            RUN_DDL(
                'DROP MATERIALIZED VIEW "' || R.OBJECT_NAME || '"'
              , R.OBJECT_TYPE || ' ' || R.OBJECT_NAME
            );
        ELSE
            RUN_DDL(
                'DROP ' || R.OBJECT_TYPE || ' "' || R.OBJECT_NAME || '"'
              , R.OBJECT_TYPE || ' ' || R.OBJECT_NAME
            );
        END IF;
    END LOOP;

    /* CASCADE removes project foreign keys and their constraint indexes. */
    FOR R IN (
        SELECT TABLE_NAME
          FROM USER_TABLES
         WHERE SUBSTR(TABLE_NAME, 1, 9) = 'INIT$SVY_'
         ORDER BY TABLE_NAME
    ) LOOP
        RUN_DDL(
            'DROP TABLE "' || R.TABLE_NAME || '" CASCADE CONSTRAINTS PURGE'
          , 'TABLE ' || R.TABLE_NAME
        );
    END LOOP;

    /* Defensive cleanup for a project index not owned by a removed table. */
    FOR R IN (
        SELECT INDEX_NAME
          FROM USER_INDEXES
         WHERE SUBSTR(INDEX_NAME, 1, 9) = 'INIT$SVY_'
         ORDER BY INDEX_NAME
    ) LOOP
        RUN_DDL('DROP INDEX "' || R.INDEX_NAME || '"', 'INDEX ' || R.INDEX_NAME);
    END LOOP;

    DBMS_OUTPUT.PUT_LINE('[DONE] All INIT$SVY_ objects have been removed.');
END;
/
