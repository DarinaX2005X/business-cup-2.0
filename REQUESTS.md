# Requests to MAIN

Packages write here when they need a change in a file outside their Paths: section with the substage ID, the file, the exact change and why. MAIN applies them between packages and deletes the entry.

## 01.1

- `package.json` → `scripts`: add `"data:short-labels": "tsx scripts/data/short-labels.ts"`. Why: stage-01 review item 4b; the script writes `data/build/short-labels.en.json`, which `npm run data:build` merges into `OccTask.short`. Until then it runs as `npx tsx scripts/data/short-labels.ts --max-usd=0.8`.
- 01.2 review round (kit stays backward compatible): `ComboItem` gained `matched?: string` (rendered as «matched: RN» through `KitStrings.matched`); `src/components/start/StepWho.tsx` (02.2) can pass `matched` instead of building that line in `hint`. `EvidenceMeter` is now linear against the busiest task of the release (`AEI_RELEASE_MAX_SHARE` = 0.0495, measured over `public/data/occ`); if 01.1 adds the release maximum to `meta.json`, pass it as `scaleMax`. New `KitStrings` keys (`lockedBand`, `scaleOf`, `matched`, `streakDone`, `streakMissed`, `streakAhead`) have RU/KK drafts in `src/components/kit/locales.ts` for proofreading in 06.2.
