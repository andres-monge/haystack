# Phase A1 — Build Roadmap

> Source plan: `docs/plans/2026-02-10-feat-gemini-image-editing-pipeline-plan.md`
> Task details: `.claude/tasks/{1..11}.json`
> How to use: Open a Claude Code session and say _"Read .claude/tasks/ and do the next unchecked task"_

## Dependency Graph

```
  #1  Scaffold project
   │
  #2  Type definitions
   │
   ├──────────┬──────────┬──────────┐
   │          │          │          │
  #3 Scenario #5 Gemini  #6 Store  #7 Config
   │          │  Client  │          │
  #4 Prompt   │          │          │
   │          │          │          │
   ├──────────┴──────────┘          │
   │                                │
  #8  Pipeline + exports            │
   │                                │
   ├────────────────────────────────┘
   │          │
  #9  CLI    #10 Example
   │          │
   └──────┬───┘
          │
  #11  Verify build + tests
```

---

## Step 1 — Foundation

Must be done in order. Each unlocks the next.

- [x] **#1 Scaffold project** — `package.json`, `tsconfig.json`, `vitest.config.ts`, `.env.example`, `npm install`
- [x] **#2 Type definitions** — `src/engine/types.ts` (Scenario, SerializedScenario, GeminiConfig, RenderMetadata, etc.)

## Step 2 — Core modules (parallel)

After #2 is done, these four have **no dependencies on each other**. Do in any order or all at once.

- [x] **#3 Scenario builder** — `src/engine/scenario.ts` + `tests/engine/scenario.test.ts`
- [x] **#5 Gemini client** — `src/engine/gemini-client.ts` + `tests/engine/gemini-client.test.ts`
- [x] **#6 Output store** — `src/storage/output-store.ts` + `src/storage/index.ts` + `tests/storage/output-store.test.ts`
- [x] **#7 Config module** — `src/config/config.ts` + `src/config/index.ts`

## Step 3 — Prompt composer

Depends on #3 (uses `describeScenario` from scenario builder).

- [x] **#4 Prompt composer** — `src/engine/prompt.ts` + `tests/engine/prompt.test.ts`

## Step 4 — Pipeline

Depends on #4 + #5 + #6 all being done. Creates the export barrel files too.

- [ ] **#8 Main pipeline** — `src/engine/pipeline.ts` + `src/engine/index.ts` + `src/index.ts` + `tests/engine/pipeline.test.ts`

## Step 5 — CLI + Example (parallel)

After #8 is done, these two are independent.

- [ ] **#9 CLI entry point** — `src/cli/generate.ts` (also needs #7)
- [ ] **#10 Example script** — `examples/basic-edit.ts`

## Step 6 — Final verification

- [ ] **#11 Verify build + tests** — `npm run build`, `npm run test:run`, check `dist/` structure, `.gitignore`

---

## Progress

| Task | Status | Date |
|------|--------|------|
| #1 Scaffold | done | 2026-02-12 |
| #2 Types | done | 2026-02-12 |
| #3 Scenario | done | 2026-02-12 |
| #4 Prompt | done | 2026-02-12 |
| #5 Gemini client | done | 2026-02-12 |
| #6 Output store | done | 2026-02-12 |
| #7 Config | done | 2026-02-12 |
| #8 Pipeline | pending | |
| #9 CLI | pending | |
| #10 Example | pending | |
| #11 Verify | pending | |