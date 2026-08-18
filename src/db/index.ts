import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

const globalForDb = globalThis as unknown as { pool?: Pool };

const pool =
  globalForDb.pool ??
  new Pool({
    connectionString: process.env.DATABASE_URL,
    // Neon and most hosted Postgres require TLS; local docker does not.
    ssl: /neon\.tech|amazonaws|render\.com|supabase/.test(process.env.DATABASE_URL ?? "")
      ? true
      : undefined,
    max: 10,
  });

if (process.env.NODE_ENV !== "production") globalForDb.pool = pool;

export const db = drizzle(pool, { schema });
export { schema };
export * from "./schema";
