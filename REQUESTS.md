# Requests to MAIN

Packages write here when they need a change in a file outside their Paths: section with the substage ID, the file, the exact change and why. MAIN applies them between packages and deletes the entry.

## 01.1

- `package.json` → `scripts`: add `"data:short-labels": "tsx scripts/data/short-labels.ts"`. Why: stage-01 review item 4b; the script writes `data/build/short-labels.en.json`, which `npm run data:build` merges into `OccTask.short`. Until then it runs as `npx tsx scripts/data/short-labels.ts --max-usd=0.8`.
- 01.2 review round (kit stays backward compatible): `ComboItem` gained `matched?: string` (rendered as «matched: RN» through `KitStrings.matched`); `src/components/start/StepWho.tsx` (02.2) can pass `matched` instead of building that line in `hint`. `EvidenceMeter` is now linear against the busiest task of the release (`AEI_RELEASE_MAX_SHARE` = 0.0495, measured over `public/data/occ`); if 01.1 adds the release maximum to `meta.json`, pass it as `scaleMax`. New `KitStrings` keys (`lockedBand`, `scaleOf`, `matched`, `streakDone`, `streakMissed`, `streakAhead`) have RU/KK drafts in `src/components/kit/locales.ts` for proofreading in 06.2.

## 02.3

- `src/components/kit/WeekBar.tsx` (01.2 kit): add an optional `onTotal?: (category: Category) => void` that renders each category total (`.head`) as a button. Why: the week map opens the hours breakdown from these numbers; until then `src/components/xray/WeekSection.tsx` catches the click by delegation on `li[data-cat] > div:first-child`, and keyboard users reach the same breakdown through the «How these hours add up» button next to the heading. When the prop lands, replace the delegation with it.
- 05.1.4: the real 90-day plan for Pro goes into `src/components/xray/Further.tsx` (`plan` section). Today Pro sees the three months built from `handToAi` / `humanEdge`; Free sees the month headings and a `LockedPanel`, and no plan data is sent.
- `profile.streak.days` (stage 03): the header's compact `StreakWeek` (`src/components/shell/AppShell.tsx`, `weekOf`) reads them as local `YYYY-MM-DD` dates. If stage 03 stores another format, tell 02.3 or adjust `weekOf`.
- Shell sections: MAIN switches Today, Progress and Shop on with `enabled: true` in `src/components/shell/nav.config.ts`; nothing else changes.
