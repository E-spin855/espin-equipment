# ESPIN LINK Standing Project Rules

Apply these rules to every future ESPIN LINK update.

## Compliance checks

1. Run a third-party license audit after every code or dependency update.
2. The acceptable release result is zero restricted/copyleft licenses and zero unresolved or unknown licenses.
3. Keep `THIRD_PARTY_NOTICES.md`, `THIRD_PARTY_LICENSES.md`, browser-library versions, public-data attributions, license inventories, and SBOM records synchronized with the implementation.
4. Pin browser-loaded third-party libraries to exact versions.
5. Preserve visible OpenStreetMap/OpenFreeMap attribution whenever the map is displayed.
6. Perform a patent-risk regression screen after every update:
   - For visual, copy, or minor corrective changes, confirm that no new technical mechanism or third-party patented implementation was introduced.
   - For new synchronization, notification, workflow, asset-tracking, mapping, communications, or data-routing mechanisms, compare the implementation with relevant active patent claims and flag any element requiring attorney review or a design-around.
7. Do not describe these checks as a formal legal opinion or guaranteed freedom to operate. Report concrete findings and clearly identify any uncertainty.
8. Do not call an update green if a known license issue, missing attribution, unresolved license, or specific active-patent concern remains.

## Handoff

After every completed update, provide:

- A concise result and verification status.
- A short GitHub commit/update message.
- A one-line compliance status covering licenses and patent-risk regression.

Keep the user-facing handoff short unless a compliance concern requires explanation.
