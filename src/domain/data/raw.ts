// Parsed inputs of the data build. scripts/data/load.ts fills this from the files in data/raw/;
// assemble() turns it into the published outputs without any I/O, so a cached copy rebuilds identically.

export interface RawAeiTask {
  taskId: string;
  text: string;
  period: string; // date_start of the month, e.g. 2026-05-01
  pct: number | null; // percent of the source's conversations
  automation: number | null; // collaboration_bucket_automation_pct
  augmentation: number | null; // collaboration_bucket_augmentation_pct
  work: number | null; // use_case_work_pct
}

export interface RawOewsRow {
  occ: string; // OCC_CODE
  title: string;
  group: string; // O_GROUP
  totEmp: string;
  aMedian: string;
  hMedian: string;
  annualOnly: boolean; // ANNUAL = TRUE
  hourlyOnly: boolean; // HOURLY = TRUE
}

export interface RawSourceFile {
  id: string;
  file: string; // path relative to data/raw
  url: string | null;
  bytes: number;
  sha256: string;
}

export interface RawSources {
  onetRelease: string; // from Read Me.txt, e.g. "August 2026"
  occupations: { code: string; title: string; description: string }[];
  tasks: { code: string; id: string; text: string; type: string }[];
  /** Task Ratings rows for IM, RT, FT: [code, taskId, scale, category, value]. */
  ratings: [string, string, string, string, number][];
  jobTitles: { code: string; title: string; short: string | null }[];
  reportedTitles: { code: string; title: string }[];
  /** Essential + Transferable Skills and Knowledge, importance scale: [code, elementId, name, value]. */
  skills: [string, string, string, number][];
  knowledge: [string, string, string, number][];
  taskDwas: [string, string][]; // [taskId, dwaId]
  related: { code: string; related: string; tier: string; index: number }[];
  jobZones: [string, number][];
  /** Education.txt, Required Level of Education (RL): [code, category 1..12, percent of respondents]. */
  education?: [string, number, number][];
  gpts: { taskId: string; text: string; human: 'E0' | 'E1' | 'E2' | null; gpt4: 'E0' | 'E1' | 'E2' | null }[];
  physical: [string, boolean][];
  penetration: [string, number][]; // [task text, penetration]
  aei: { claude_ai: RawAeiTask[]; '1p_api': RawAeiTask[] };
  /** Older text-keyed releases: release label → { normalised-or-raw text: pct }. */
  aeiOld: { release: string; source: 'claude_ai' | '1p_api'; period: string; rows: [string, number][] }[];
  oews: RawOewsRow[] | null;
  files: RawSourceFile[];
}
