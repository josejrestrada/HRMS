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

export async function query<T extends QueryResultRow>(text: string, params: unknown[] = []): Promise<T[]> {
  const result = await pool().query<T>(text, params);
  return result.rows;
}
