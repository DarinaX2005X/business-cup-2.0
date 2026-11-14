import { existsSync } from 'node:fs';
import path from 'node:path';

/** tsx scripts do not get Next's env loading: read .env.local (then .env) from the project root. */
export function loadEnv(): void {
  for (const name of ['.env.local', '.env']) {
    const file = path.join(process.cwd(), name);
    if (existsSync(file)) process.loadEnvFile(file);
  }
}
