import { describe, expect, it } from "vitest";
import { checkDatabaseTestGuard } from "../integration/enabled";

const url = "postgresql://user:secret@ep-dev-host.c-3.ap-southeast-1.aws.neon.tech/neondb?sslmode=require";
const host = "ep-dev-host.c-3.ap-southeast-1.aws.neon.tech";

describe("database test guard (review finding 11)", () => {
  it("is off, quietly, when database tests are not switched on", () => {
    expect(checkDatabaseTestGuard({ DATABASE_URL: url })).toEqual({ enabled: false });
    expect(checkDatabaseTestGuard({ RUN_DB_TESTS: "no", DATABASE_URL: url, TEST_DATABASE_HOST: host })).toEqual({ enabled: false });
  });

  it("refuses, loudly, when they are switched on without naming the database", () => {
    const g = checkDatabaseTestGuard({ RUN_DB_TESTS: "yes", DATABASE_URL: url });
    expect(g.enabled).toBe(false);
    expect(g.error).toContain("TEST_DATABASE_HOST is not set");
    expect(g.error).toContain(host); // tells you which database it would have used
  });

  it("refuses when the named host is not the host of DATABASE_URL", () => {
    const g = checkDatabaseTestGuard({ RUN_DB_TESTS: "yes", DATABASE_URL: url, TEST_DATABASE_HOST: "ep-other-host.neon.tech" });
    expect(g.enabled).toBe(false);
    expect(g.error).toContain("Refusing to run database tests");
  });

  it("never prints the password", () => {
    const g = checkDatabaseTestGuard({ RUN_DB_TESTS: "yes", DATABASE_URL: url });
    expect(g.error).not.toContain("secret");
    expect(g.error).not.toContain("user:");
  });

  it("runs only when the named host matches exactly", () => {
    expect(checkDatabaseTestGuard({ RUN_DB_TESTS: "yes", DATABASE_URL: url, TEST_DATABASE_HOST: host })).toEqual({ enabled: true });
  });

  it("refuses a missing or invalid DATABASE_URL", () => {
    expect(checkDatabaseTestGuard({ RUN_DB_TESTS: "yes" }).error).toContain("DATABASE_URL is not set");
    expect(checkDatabaseTestGuard({ RUN_DB_TESTS: "yes", DATABASE_URL: "not a url", TEST_DATABASE_HOST: host }).error).toContain("not a valid address");
  });
});
