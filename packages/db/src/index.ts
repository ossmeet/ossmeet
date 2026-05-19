import { drizzle } from "drizzle-orm/d1";
import * as schema from "./schema";

export function createDb(d1: Parameters<typeof drizzle>[0]) {
  return drizzle(d1, { schema });
}

export type Database = ReturnType<typeof createDb>;

export * from "./schema";
