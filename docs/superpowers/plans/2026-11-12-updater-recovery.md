# Updater recovery guidance implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make enrolled-host helper refresh and manual package troubleshooting accessible from the existing node page.

**Architecture:** A focused React component consumes the existing public HostTarget and page's unresolved state. It renders copyable instructions only; API, helper, credentials and package operations stay unchanged.

**Tech Stack:** Existing React, TypeScript, Tailwind, CopyButton and Playwright.

**Spec:** docs/superpowers/specs/2026-11-12-updater-recovery-design.md

## Global constraints

- Manual root helper refresh uses the same dedicated key and existing setupCommand.
- No new API, automatic host operation or output collection.
- Preserve the existing shell and 390px/light/dark layout; no demo changes.

## Review focus

- Copying instructions must not admit work or change target/configuration.
- An absent job must never produce a fabricated journal unit.
- Active or unresolved jobs need explicit wait guidance before helper refresh.
- Package logs are host-wide; journal output is service events, not detailed APT output.
- Long setup commands and copy labels must wrap on phones without hiding controls.

## Task 1: Recovery disclosure and verification

**Files:** Create web/src/components/HostUpdaterRecovery.tsx; modify web/src/pages/HostUpdates.tsx and web/test/host-updates.e2e.cjs; update docs/proxmox-host-updates.md.

**Interface:** HostUpdaterRecovery({target, unresolved}) consumes HostTarget and boolean; renders the existing disclosure and no network operation.

- [ ] Extend browser fixture to assert same-key setup command available after enrollment, exact clipboard content via keyboard, no copy-induced mutation, absent/real job handling, active/failed guidance and phone/theme layout. Observe RED against current UI.
- [ ] Extract recovery component, show refresh instructions for configured targets, existing key, real-job journal events and separate fixed APT/dpkg log commands. Wire into existing page; observe GREEN.
- [ ] Run typecheck/full tests/normal+demo builds and browser suite. Inspect one batched desktop/mobile/light/dark round; fix material issues only.
- [ ] Independent focused review, commit, exact-head CI-gated PR publication under standing authorization. No actual host operations.
