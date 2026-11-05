import { sql } from "drizzle-orm";
import type { DB } from "../db";

/**
 * Fixed-window rate limiter stored in Postgres (works across instances).
 * Returns false when the caller is over the limit.
 */
export async function rateLimit(db: DB, key: string, limit: number, windowSec: number): Promise<boolean> {
  const rows = await db.execute<{ count: number }>(sql`
    insert into rate_limits (key, window_start, count) values (${key}, now(), 1)
    on conflict (key) do update set
      count = case when rate_limits.window_start < now() - make_interval(secs => ${windowSec}) then 1 else rate_limits.count + 1 end,
      window_start = case when rate_limits.window_start < now() - make_interval(secs => ${windowSec}) then now() else rate_limits.window_start end
    returning count`);
  const count = Number((rows as unknown as Array<{ count: number }>)[0]?.count ?? 0);
  return count <= limit;
}
