// Applies db/migrations/*.sql in order, once each, each inside a transaction.
// Takes an advisory lock so two runs cannot race, records a checksum for every applied file, and
// refuses to continue if an already-applied file was edited. Never drops or resets anything.
// Usage: npm run db:migrate
import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { Pool } from "@neondatabase/serverless";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set (run through `npm run db:migrate`).");
  process.exit(1);
}

const LOCK_KEY = 727274; // arbitrary, fixed
const dir = path.join(process.cwd(), "db", "migrations");
const files = (await readdir(dir)).filter((f) => f.endsWith(".sql")).sort();

const pool = new Pool({ connectionString: url });
const lock = await pool.connect();
try {
  await lock.query("select pg_advisory_lock($1)", [LOCK_KEY]);
  await pool.query(
    "create table if not exists schema_migration (name text primary key, applied_at timestamptz not null default now())",
  );
  await pool.query("alter table schema_migration add column if not exists checksum text");
  const { rows } = await pool.query("select name, checksum from schema_migration");
  const done = new Map(rows.map((r) => [r.name, r.checksum]));
  let applied = 0;

  for (const file of files) {
    const sql = await readFile(path.join(dir, file), "utf8");
    const checksum = createHash("sha256").update(sql).digest("hex");

    if (done.has(file)) {
      const recorded = done.get(file);
      if (recorded === null) {
        await pool.query("update schema_migration set checksum = $1 where name = $2", [checksum, file]);
      } else if (recorded !== checksum) {
        console.error(`FAILED ${file} was edited after it was applied. Add a new numbered migration instead.`);
        process.exitCode = 1;
        break;
      }
      continue;
    }

    const client = await pool.connect();
    try {
      await client.query("begin");
      await client.query(sql);
      await client.query("insert into schema_migration (name, checksum) values ($1, $2)", [file, checksum]);
      await client.query("commit");
      console.log("applied", file);
      applied += 1;
    } catch (err) {
      await client.query("rollback");
      console.error("FAILED", file, "-", err.message);
      process.exitCode = 1;
      break;
    } finally {
      client.release();
    }
  }
  if (!process.exitCode) console.log(applied ? `done, ${applied} applied` : "nothing to apply");
} finally {
  await lock.query("select pg_advisory_unlock($1)", [LOCK_KEY]).catch(() => {});
  lock.release();
  await pool.end();
}
