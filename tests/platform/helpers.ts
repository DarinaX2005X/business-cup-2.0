import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createFsStore } from '@/server/store/fs';
import { setStoreForTests, type Store } from '@/server/store';

/** Fresh fs store in a temp dir, installed as the app store. Returns a cleanup function. */
export function useTempStore(): { store: Store; dir: string; cleanup: () => void } {
  const dir = mkdtempSync(path.join(tmpdir(), 'irr-test-'));
  const store = createFsStore(dir);
  setStoreForTests(store);
  return {
    store,
    dir,
    cleanup: () => {
      setStoreForTests(null);
      rmSync(dir, { recursive: true, force: true });
    },
  };
}
