// One place that decides whether database tests may run (review finding 11).
//
// Database tests only run if you switch them on (RUN_DB_TESTS=yes) AND name the database on purpose
// (TEST_DATABASE_HOST must equal the host in DATABASE_URL). That way a stray DATABASE_URL that points at
// the wrong database (for example production) makes the run fail loudly instead of touching it.

export type DatabaseTestGuard = { enabled: boolean; error?: string };

export function checkDatabaseTestGuard(env: Record<string, string | undefined>): DatabaseTestGuard {
  if (env.RUN_DB_TESTS !== "yes") return { enabled: false };
  const url = env.DATABASE_URL;
  if (!url) return { enabled: false, error: "RUN_DB_TESTS is on but DATABASE_URL is not set." };

  let host = "";
  try {
    host = new URL(url).hostname;
  } catch {
    return { enabled: false, error: "DATABASE_URL is not a valid address." };
  }
  if (!env.TEST_DATABASE_HOST) {
    return {
      enabled: false,
      error: `Database tests are on but TEST_DATABASE_HOST is not set. Set it to the host of the DEVELOPMENT database (${host}) only if that is the database you mean to test against.`,
    };
  }
  if (env.TEST_DATABASE_HOST !== host) {
    return {
      enabled: false,
      error: `Refusing to run database tests: TEST_DATABASE_HOST (${env.TEST_DATABASE_HOST}) is not the host in DATABASE_URL (${host}).`,
    };
  }
  return { enabled: true };
}

/** True when database tests may run. Throws, so the run fails visibly, if they were switched on unsafely. */
export function databaseTestsEnabled(): boolean {
  const guard = checkDatabaseTestGuard(process.env);
  if (guard.error) throw new Error(guard.error);
  return guard.enabled;
}
