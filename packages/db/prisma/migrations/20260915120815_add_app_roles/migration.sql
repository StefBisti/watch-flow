-- App roles. Created without LOGIN or a password: credentials are set per
-- environment, outside git (see README). IF NOT EXISTS because roles are
-- cluster-wide and outlive `migrate reset` and the shadow database.
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'wf_web') THEN
    CREATE ROLE wf_web NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'wf_worker') THEN
    CREATE ROLE wf_worker NOLOGIN;
  END IF;
END
$$;

GRANT USAGE ON SCHEMA public TO wf_web, wf_worker;

-- wf_web -------------------------------------------------------------------

GRANT SELECT, INSERT, UPDATE, DELETE
  ON "User", "Account", "Session", "VerificationToken", "Watch"
  TO wf_web;

GRANT SELECT, INSERT, UPDATE ON "Run" TO wf_web;

-- 🔒 Write-only secrets: web can store, replace and list them by name, but has
-- no SELECT on ciphertext or iv. A compromised web server holds the key and
-- still cannot read a single secret back out of the database.
GRANT SELECT ("id", "watchId", "name", "createdAt") ON "WatchSecret" TO wf_web;
GRANT INSERT, UPDATE ON "WatchSecret" TO wf_web;

-- wf_worker ----------------------------------------------------------------

GRANT SELECT ON "User", "Watch", "WatchSecret" TO wf_worker;
GRANT UPDATE ON "Watch" TO wf_worker;
GRANT SELECT, INSERT, UPDATE ON "Run" TO wf_worker;
GRANT SELECT, INSERT ON "Snapshot" TO wf_worker;
