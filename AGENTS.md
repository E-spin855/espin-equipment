# AGENTS.md

Project rules for future Codex edits in this repository.

## Prime Directive

Preserve existing behavior unless the user explicitly asks for a behavior change.

This app has several tightly coupled static HTML pages, Vercel API routes, localStorage synchronization flows, equipment send/delete logic, badge/unread logic, CSV/XLSX import/export behavior, and AXIS rep-manager workflows. Refactors must be incremental and behavior-preserving.

## Do Not Change Without Explicit Approval

- Existing API route paths, request shapes, response shapes, status codes, or method support.
- Equipment send logic, including email recipients, changed-field behavior, unread counters, push notifications, and button/status flows.
- Equipment delete logic, including hiding photos, deleting details/modalities/projects, and KV cleanup side effects.
- Rep-manager synchronization behavior.
- Project status and alert logic.
- Any localStorage or sessionStorage key names.
- CSV/XLSX import parsing, field normalization, date conversion, matching rules, or export column names/order.
- Login/auth localStorage keys and redirect behavior.

## Critical Storage Keys

Do not rename, remove, or repurpose these keys:

- `espinEquipment_auth`
- `espinEquipment_userEmail`
- `espinEquipment_keepSignedIn`
- `espinEquipment_tempEmail`
- `espinEquipment_deviceToken`
- `espinEquipment_activeProjectId`
- `espinEquipment_activeModality`
- `espinEquipment_activeModalityId`
- `espin_lifecycle_demo_records_v1`
- `espin_rep_queue`
- `axis_manager_sync_ping_v1`
- `axis_tradein_sync_records_v1`
- `axis_tradein_last_sync_v1`
- `axis_tradein_share_enabled_v1`
- `axis_trade_desk_demo_v1`
- `axis_trade_desk_queue_v1`
- `axis_trade_desk_inbox_v1`
- `axis_trade_desk_active_package_id_v1`
- `axis_bidder_portal_packages_v1`
- `axis_unmatched_tradeins_v1`
- `axis_processed_tradein_sync_keys_v1`
- `equipmentDetailsChanged:*`
- `equipmentImageBadges:*`
- `axis_*` context keys used by Equipment Details and Images pages.

If a new abstraction wraps storage access, it must continue reading/writing the exact same keys.

## High-Risk Files

Treat these as behavior-critical:

- `Rep.html`
- `Manager.html`
- `Fuji Rep.html`
- `Fuji Manager.html`
- `Equipment-Details.html`
- `EquipmentImages.html`
- `equipmentindex.html`
- `equipmentprojects.html`
- `trade_desk.html`
- `bidder_portal.html`
- `api/send-equipment-emails.js`
- `api/equipment-details.js`
- `api/equipment-details/equipment-save.js`
- `api/equipment-modalities/equipment-delete.js`
- `api/equipment-projects/proj-delete.js`
- `api/equipment-photos/photo-email.js`
- `api/equipment-photos/photo-delete.js`
- `api/equipment-photos/photo-save.js`
- `api/equipment-photos/photo-update.js`
- `api/equipment-photos/photo-queue.js`
- `api/equipment-project-mark-read.js`
- `api/equipment-updates.js`
- `api/badge-refresh-equipment.js`
- `api/reset-equipment-badges.js`
- `api/ios-clear-badge-equipment.js`

## Refactor Rules

- Prefer extracting pure helpers before changing call sites.
- Move duplicated code in small steps and verify each step.
- Keep DOM IDs, CSS classes, inline handler names, and global function names stable unless the user asks otherwise.
- Preserve page URLs and query parameter names.
- Preserve current button text, status messages, alerts, and confirmations unless explicitly asked to improve copy.
- Do not combine routes just because logic overlaps.
- Do not normalize divergent alert/status logic unless behavior differences are documented and approved.
- Do not replace browser `alert()` or `confirm()` where the blocking behavior controls a workflow unless explicitly approved.

## AXIS Lifecycle Rules

The lifecycle and quote pages share similar but not identical logic. Before changing any of these functions, compare all page variants:

- `getAlerts`
- `getProactiveSignal`
- `evaluateStatus`
- `getPressureScore`
- `getActionScore`
- `pushToRepFeed`
- `syncFeedStatus`
- `syncRepRecord`
- `importTradeInSyncRecords`
- `downloadSpreadsheet`
- `handleCSVUpload`
- `excelDateToISO`

Do not assume the Fuji pages and non-Fuji pages should behave identically.

## Equipment Details and Images Rules

Preserve:

- Required serial/additional identifier validation.
- Modality-specific field names and aliases.
- Changed-field tracking and badge behavior.
- The sequence of save, sync-to-AXIS, send email, unread counter, push notification, and navigation.
- Image title requirement before sending.
- Photo visibility/delete behavior.
- Full package download behavior.

## API Rules

- Keep all current route filenames and deployed URLs.
- Preserve CORS behavior unless the user asks for security hardening.
- Preserve `x-user-email`, `x-useremail`, and `x-user_email` compatibility where currently supported.
- Preserve current admin email behavior for `info@espinmedical.com`.
- Use parameterized SQL only.
- Do not weaken existing authorization checks.
- Be careful when strengthening authorization checks: confirm existing access paths first.
- Keep transaction boundaries intact around delete/save operations.
- Do not remove KV side effects, even if they look redundant, unless the user approves.

## Rendering and Safety

- Many pages use `innerHTML` with interpolated data. If editing these areas, use existing escaping helpers where available.
- Do not introduce new unescaped user-controlled HTML.
- If replacing rendering code, keep the rendered structure, IDs, classes, data attributes, and click behavior compatible.
- Avoid large page rewrites. Extract repeated row/card/badge helpers first.

## Verification Expectations

For behavior-preserving edits, verify the narrow path touched. Depending on the change, check:

- API route still accepts the same method and payload.
- localStorage keys are unchanged.
- Rep-manager sync still updates both main records and `espin_rep_queue`.
- `axis_manager_sync_ping_v1` still updates after sync actions.
- Project alert/status output is unchanged for sample records.
- CSV/XLSX import produces the same records from the same input.
- Spreadsheet export keeps the same columns.
- Equipment send/delete flows keep the same side effects.

If no automated tests exist for the touched area, state the manual or static verification performed.

## Editing Discipline

- Do not modify unrelated files.
- Do not reformat whole HTML files during focused changes.
- Avoid broad find-and-replace across high-risk files.
- Keep changes small enough to review.
- If duplicated logic has drifted, document the differences before extracting.
- If a change requires a behavior decision, stop and ask the user.
