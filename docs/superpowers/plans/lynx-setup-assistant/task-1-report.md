# Task 1 report

Status: DONE

## Implementation

- Added `server/src/ai-setup.ts`: validates selected-guest identity/location, excludes templates, collects an explicit numeric allocation/history allowlist and binds an opaque preview to its trusted local target/digest and provider/model/key. Cache has a ten-minute TTL, maximum 100 entries, injectable clock and settings-change invalidation. History failures remain explicit and safe.
- Extended `server/src/ai.ts`: strict consent envelope, contextual completion for all three providers, JSON proposal parsing before chat reply truncation, strict resource bounds/keys, unchanged/read-only proposal suppression and trusted target/digest enrichment. Ordinary chat now guides the setup flow; review/chat/contextual prompts use restrained professional Lynx personality.
- Updated `server/src/index.ts`: authenticated preview route, cache resolution before provider calls, settings invalidation and guest-location check before existing resource-setting writes. Existing stopped/digest/pending/topology/permission checks remain authoritative. `guest-resource-settings.ts` narrows the read helper's client type only.
- Added API types and extended `LynxChat.tsx` with explicit guest selection, exact preview, sharing consent/expiry, local source identity, clear sharing indicator, before/after review and explicit Apply. Writes reuse the existing endpoint and refresh relevant queries. Failures preserve proposals; success invalidates evidence and disables repeat application. Scope/settings/consent/clear changes remove invalid actions and ignore late responses. `AiAdvisor.tsx` announces saved/removed settings to reset same-provider replacement-key sessions.

## Files

- server/src/ai-setup.ts (new)
- server/src/ai.ts
- server/src/index.ts
- server/src/guest-resource-settings.ts
- server/test/ai-setup.test.ts (new)
- server/test/advanced-api.test.ts
- server/test/ai-chat-api.test.ts
- web/src/components/LynxChat.tsx
- web/src/components/AiAdvisor.tsx
- web/src/lib/api.ts
- web/test/lynx-setup.e2e.cjs (new)

Controller-owned docs and website files were not edited by this implementer.

## Verification evidence

- TDD red: `node --import tsx server/test/ai-setup.test.ts` initially failed with the expected missing ai-setup module.
- `node --import tsx server/test/ai-setup.test.ts`: 5/5 pass. Covers exact context allowlist, actual bounded history, unavailable history, location/template rejection, expiry/capacity/settings-key binding, consent rejection, all provider wire shapes, trusted target/digest, malformed/unknown/unchanged/read-only proposals and reply truncation after parsing.
- `node --import tsx server/test/ai.test.ts`: 10/10 pass (ordinary chat/review/provider regressions).
- `npm run typecheck`: pass, server and web.
- `npm run build`: pass.
- `node --import tsx server/test/advanced-api.test.ts`: pass with local authenticated agent and HTTPS mock, including setup preview/location/schema/context privacy/settings invalidation. No provider call.
- `node --import tsx server/test/ai-chat-api.test.ts`: pass, including setup-preview auth/origin protections.
- `CHROMIUM_PATH=/usr/bin/chromium node web/test/lynx-chat.e2e.cjs`: pass, preserving ordinary chat/provider/key/mobile behavior.
- `npm run build:web` then `CHROMIUM_PATH=/usr/bin/chromium node web/test/lynx-setup.e2e.cjs`: final pass after source-label change. Covers explicit selection, preview without sharing, exact context, consent, trusted proposal review/apply, failed/stale preservation, successful invalidation, expiry/reconsent, scope changes, same-provider settings event reset, late preview/reply guards, offline selection retention, plain text, connection identity and 390px overflow.
- Desktop/mobile fixture screenshots at `/tmp/lynx-setup-fixtures/desktop.png` and `/tmp/lynx-setup-fixtures/mobile.png`; controller inspected the first batch and found layout good. Final rerun includes connection source label.

No live infrastructure or paid-provider requests were made. No commits or pushes were made. Controller will run consolidated full checks and fresh review before publishing.

## Limits

Setup assistance is selected-guest CPU/memory/start-on-boot planning; other setup tasks are guided conversation. Running guests can be inspected but their allocation remains read-only until stopped. Missing/partial history is disclosed. No automatic shutdown, shell, general tool execution or AI-route infrastructure writes.
