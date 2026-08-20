import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

const globalForDb = globalThis as unknown as { pool?: Pool };

const pool =
  globalForDb.pool ??
  new Pool({
    connectionString: process.env.DATABASE_URL,
    // Hosted Postgres requires TLS; local docker does not. Certificates are
    // fully verified — never disable that, or the connection is open to a
    // man-in-the-middle who could read every row in transit.
    ssl: /neon\.tech|amazonaws|render\.com|supabase/.test(process.env.DATABASE_URL ?? "")
      ? true
      : undefined,
    max: 10,
  });

if (process.env.NODE_ENV !== "production") globalForDb.pool = pool;

export const db = drizzle(pool, { schema });
export { schema };
export * from "./schema";
