import "server-only";
import { Pool, type QueryResultRow } from "@neondatabase/serverless";

// Only src/shared/** and src/modules/*/data.ts may import this file.
// `npm run check:boundaries` enforces it (decision P3).

const globalForPool = globalThis as unknown as { __hrmsPool?: Pool };

function pool(): Pool {
  if (!globalForPool.__hrmsPool) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL is not set");
    globalForPool.__hrmsPool = new Pool({ connectionString: url });
  }
  return globalForPool.__hrmsPool;
}

export type Queryable = {
  query<T extends QueryResultRow>(text: string, params?: unknown[]): Promise<T[]>;
};

export async function query<T extends QueryResultRow>(text: string, params: unknown[] = []): Promise<T[]> {
  const result = await pool().query<T>(text, params);
  return result.rows;
}

/** Runs `fn` in one transaction: commits if it returns, rolls back if it throws. */
export async function transaction<T>(fn: (tx: Queryable) => Promise<T>): Promise<T> {
  const client = await pool().connect();
  try {
    await client.query("begin");
    const result = await fn({
      query: async <R extends QueryResultRow>(text: string, params: unknown[] = []) =>
        (await client.query<R>(text, params)).rows,
    });
    await client.query("commit");
    return result;
  } catch (err) {
    await client.query("rollback").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}
