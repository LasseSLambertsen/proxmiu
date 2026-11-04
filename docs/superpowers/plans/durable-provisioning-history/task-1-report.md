# Task 1 implementation report

Status: DONE

Implemented the app-side durable provisioning/update journal, runner checkpoints, additive status API, Activity recovery/history presentation and focused fixtures. No commits, pushes, provider calls, real infrastructure requests or subagents were used. Controller-owned app documentation and the separate site were left alone.

## App source and test files

- `server/src/job-history.ts` — shared server Job/status types; strict version-1 allowlisted encrypted journal; bounded snapshots; safe availability/degradation metadata; atomic flushed unique-temp replacement; admission/retention; interrupted recovery; central ephemeral secret registry and snapshot redaction.
- `server/src/provision.ts` — durable initial registration before execution; intended/resolved guest identity; immediate state/final checkpoints and bounded/coalesced log checkpoints; centralized redaction for both creation and update; safe snapshots for start/list/detail callers.
- `server/src/index.ts` — protected static `/api/jobs/status`; synchronous pending-tail flush on exit/SIGINT/SIGTERM while preserving normal signal termination.
- `server/src/ai.ts` — ordinary Lynx feature knowledge now explains retained setup history and manual interrupted-run recovery; no history/log attachment or tools added.
- `server/test/job-history.test.ts` — 12 journal tests using real isolated temp files and the real codec, with filesystem-boundary fault injection.
- `server/test/job-history-runner.test.ts` — 2 runner tests with synthetic Proxmox request-boundary responses; verifies pre-call durable registration, resolved VMID and failure/default redaction.
- `server/test/job-history-api.test.ts` — authenticated actual-agent restart integration, isolated temporary state and a loopback traffic observer.
- `server/test/fixtures/seed-job-history.ts` — separate helper process using the production journal and codec to seed retained terminal/running records.
- `server/test/ai.test.ts` — existing provider-payload test additionally checks retained-history/recovery guidance while retaining its no-tools/no-attached-context assertions.
- `web/src/lib/api.ts` — additive interrupted/target/truncation metadata and typed persistence status.
- `web/src/pages/Activity.tsx` — retained history; distinct interrupted pause icon/warning badge; recovery guidance, intended guest and original connection ID; historical successful readiness/SSH address copy; bounded-tail marker; persistence/retention health; explicit read errors, retry and verified empty state; terminal deep links and mobile wrapping.
- `web/test/job-history.e2e.cjs` — focused retained-history browser fixture, including desktop/390px states and keyboard navigation.
- `web/test/task-history.e2e.cjs` — additive persistence-status fixture and retained-history wording; supplied the existing Layout AI-settings read fixture so the strict unexpected-request check remains meaningful.

## Final contract

`GET /api/jobs` remains an array without log bodies; `GET /api/jobs/:id` remains detail. New static `GET /api/jobs/status` returns `{ available, writable, warning?, lastSavedAt?, retention: { maxJobs: 50, maxLogLines: 5000, maxJobBytes: 131072 } }` through the existing bearer/origin hooks. Unavailable journals return a safe 503 from list/detail and both start paths rather than a successful empty list. Runtime persistence failures retain live diagnostics and actual outcomes; later admissions still require a successful save.

`jobs.json` contains only the existing AES-256-GCM codec envelope. Decrypted content is strict `{ version: 1, savedAt, jobs }`. The loader rejects unsupported versions, malformed/decryption/wrong-key input, extra nested fields, duplicate job IDs, oversized records and oversized files/plaintext without replacement. File size is checked before reading; reads are bounded against growth; encoded ciphertext size is checked before decryption. It uses a 12 MiB encrypted-file ceiling and 8 MiB plaintext ceiling. Temporary files are unique/exclusive and 0600, writes are fsynced/closed before rename, and the data directory is 0700.

Each retained snapshot has at most 5000 lines and 128 KiB serialized UTF-8. Lines are at most 4096 UTF-16 code units (therefore no more than 4096 characters); text and step arrays are bounded. Tail normalization budgets JSON-escaped UTF-8 line bytes from newest backward once, without repeatedly serializing a shrinking giant log. Retention evicts oldest terminal jobs only and rejects all-active admission. Initial-save failure restores the previous in-memory map.

Loaded running jobs become interrupted once, with `interruptedAt`, exact guidance `The guest or remote command may still exist/run; inspect it before starting again.`, running steps interrupted and pending steps skipped. No completion timestamp/result is invented, no external work is replayed, and failed recovery persistence is explicitly warned. Intended/resolved identity remains separate from any claim of creation success.

Known passwords, secret-typed supplied/default values (including short and separately emitted multiline fragments), and the prior long-option heuristic are scrubbed from persisted and API free-text snapshots. The registry and original requests/options/scripts/keys never enter journal snapshots. Update execution uses the same registry, including secret defaults. Unknown arbitrary script output remains sensitive encrypted diagnostics; generic secret detection is not claimed.

## RED → GREEN evidence

1. Added meaningful journal tests before implementation. The initial absent-module run failed as expected; after declaring the minimal intended module API, `node --import tsx server/test/job-history.test.ts` observed 9 failures, including explicit assertions for unavailable history (`true !== false`), oversized UTF-8 snapshots, and missing all-active admission refusal. With the real journal implemented, the same command passed 9/9. Further filesystem-boundary/shutdown cases brought this to 12/12.
2. Added a multiline-default regression before changing the registry. `node --import tsx --test-name-pattern='multiline' server/test/job-history.test.ts` failed with `xy !== ••••••`. Registering the full value and non-empty line fragments made it pass.
3. Added the retained-history browser fixture before the UI change. After building the incumbent UI, `node web/test/job-history.e2e.cjs` failed waiting for `Run interrupted`. After Activity implementation, all retained-state assertions passed. Its first final-contract check exposed a missing unrelated `/api/ai/settings` fixture; adding that fixture made the complete run green.
4. Added the original-connection identity browser assertion before the source label; the browser fixture failed waiting for `Connection: fixture`. The small source-ID context label then made the same regression pass.
5. Added ordinary-chat retained-history prompt expectations before editing the prompt. `node --import tsx --test-name-pattern='Lynx chat preserves' server/test/ai.test.ts` failed (transport assertions are intentionally sanitized as provider failure by the existing implementation); updating the feature knowledge made the same test pass for both provider shapes.

## Exact verification commands and outcomes

- `node --import tsx --test server/test/job-history.test.ts server/test/job-history-api.test.ts server/test/job-history-runner.test.ts server/test/ai.test.ts` — PASS, 25 tests, 0 failures/skips. Run with authorized escalation solely for local test-process/loopback access. Includes terminal round-trip, interrupted recovery and failed recovery save, atomic rename/write/fsync preservation, restrictive POSIX modes, actual wrong-key and corrupt/oversize fail-closed behavior, escaped UTF-8/control-character bounds, active retention/admission, supplied/default/short/multiline secret redaction, 250ms coalescing and graceful pending-tail flush, runner initial registration/resolved target, and ordinary Lynx payload boundaries.
- `node --import tsx server/test/job-history.test.ts` — final PASS, 12/12, after extending the corruption matrix to actual wrong-key ciphertext, duplicate IDs, nested extras and a valid-schema but byte-oversized record.
- `npm run typecheck` — PASS for both server and web.
- `npm run build` — PASS for web and server, including copied server assets.
- `SCREENSHOT_DIR=/tmp/proxmiu-durable-history node web/test/job-history.e2e.cjs` — PASS after final source cleanup. Covers retained success/error/interrupted deep links, intended target/original connection and recovery, plain-text script-like logs, no interrupted detail polling/spinner or false-ready result, historical SSH copy, truncation/retention, persistence degradation/unavailability, read-error/empty distinction, missing deep-link detail with empty list, keyboard tabs and desktop/390px fit.
- `node web/test/task-history.e2e.cjs` — PASS. Native source/filter/paging/dedup/cap, stale/error/warning/empty, plain-text results/logs, terminal outcomes, auth/read recovery, late-response races, migration/offline, Activity deep links and 390px layout retained. Its first run reached the final scoped-fixture assertion and found existing missing `/api/ai/settings` responses; those were supplied and the complete rerun passed.
- `git diff --check` — PASS.

The restart test seeds via the production abstraction in a separate helper process, starts the actual authenticated agent, checks retained list/detail/status and protection against unauthenticated/untrusted-Origin reads, stops/restarts it and confirms stable interrupted semantics. A local socket observer sees zero source connections across both restores. A subsequent malformed-journal startup keeps unrelated `/templates` available, blocks both starts, preserves bytes and still makes zero source connections. Decrypted journal assertions verify credentials/known execution secrets are absent; short values are checked in plaintext snapshots rather than statistically matching random base64 ciphertext.

Screenshots are in `/tmp/proxmiu-durable-history/`: `retained-interrupted-desktop.png`, `retained-interrupted-mobile.png`, `retained-complete-mobile.png`, `retained-degraded-mobile.png`, `retained-unavailable-mobile.png`. Batched visual inspection confirmed warm-glass continuity, readable recovery/identity copy and fit at desktop/390px.

The sandbox initially blocked loopback listeners with EPERM; the authorized escalated local-only runs succeeded. Non-escalated Node test-worker runs also suppressed detailed failures in this sandbox, so direct test-file execution was used to inspect meaningful RED output and authorized escalated `--test` for final combined verification.

## Practical limits and handoff

No known blocking implementation concerns. The existing one-active-agent-per-data-directory deployment assumption remains; no multi-process journal locking was added. Diagnostics are bounded, and a hard kill can lose the last uncheckpointed log tail (scheduled at most 250ms); disk or operating-system failures are exposed through persistence health. Restoring encrypted history requires the matching existing key. Corrupt history deliberately needs manual storage investigation and is never reset automatically. Earlier versions' already-lost process-local jobs cannot be recovered.

No real Proxmox guest, SSH execution, download/install script, paid model provider or external infrastructure was exercised. Runner fixtures stop safely at synthetic read failures. The separate real-agent restart fixture observes actual process/auth/storage behavior without provisioning. Controller owns the consolidated full test suite, whole-branch review, docs/site and publication; I ran the requested focused checks rather than broadening into that controller work.

## Fresh-review P2 fix: lone-CR secret fragments

Status: DONE. The review correctly identified a normalization mismatch: `ssh.ts` converts lone CR to LF before emitting script-output lines, while `jobSecrets` split only CRLF/LF. A known `alpha\rbeta` password or template option therefore left separately emitted `alpha` and `beta` unregistered.

Changed only `server/src/job-history.ts` and `server/test/job-history.test.ts` for this fix, plus this report. The registry now splits fragments on CRLF, lone CR or LF (`/\r\n?|\n/`) while retaining the original full value, dropping empty fragments, deduplicating and keeping longest-first redaction. No SSH behavior, browser/UI/theme files, runtime test hooks or builds changed.

Added three regressions for a supplied password, supplied secret-typed option and template secret default. They call the production `runScript` against an in-memory fake SSH stream so its actual newline normalization emits the fragments into the production journal append path. Each verifies redacted API log lines/errors/result notes and decrypted journal content. No network or command execution is involved.

RED: `node --import tsx --test-name-pattern='lone-CR' server/test/job-history.test.ts` failed all three regressions with actual log `['alpha', 'beta']` versus the expected redacted lines before the registry change.

GREEN:

- `node --import tsx server/test/job-history.test.ts` — PASS, 15/15.
- `node --import tsx server/test/job-history-runner.test.ts` — PASS, 2/2.
- `node --import tsx --test server/test/job-history.test.ts server/test/job-history-runner.test.ts server/test/job-history-api.test.ts` — PASS, 18/18, including actual authenticated agent restart coverage; authorized escalation was used solely for the local loopback fixture.
- `npm run typecheck` — PASS for server and web.
- `git diff --check` — PASS.

No remaining concerns for this fix. Deliberately did not rebuild `dist/web`, preserving the controller's independent light-mode/theme baseline.
