// Applies db/migrations/*.sql in order, once each, each inside a transaction.
// Never drops or resets anything. Usage: npm run db:migrate
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { Pool } from "@neondatabase/serverless";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set (run through `npm run db:migrate`).");
  process.exit(1);
}

const dir = path.join(process.cwd(), "db", "migrations");
const files = (await readdir(dir)).filter((f) => f.endsWith(".sql")).sort();

const pool = new Pool({ connectionString: url });
try {
  await pool.query(
    "create table if not exists schema_migration (name text primary key, applied_at timestamptz not null default now())",
  );
  const { rows } = await pool.query("select name from schema_migration");
  const done = new Set(rows.map((r) => r.name));
  let applied = 0;

  for (const file of files) {
    if (done.has(file)) continue;
    const sql = await readFile(path.join(dir, file), "utf8");
    const client = await pool.connect();
    try {
      await client.query("begin");
      await client.query(sql);
      await client.query("insert into schema_migration (name) values ($1)", [file]);
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
  if (process.exitCode !== 1) console.log(applied ? `done, ${applied} applied` : "nothing to apply");
} finally {
  await pool.end();
}
