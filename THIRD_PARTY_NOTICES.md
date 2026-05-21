# Third-Party Notices

This project uses third-party open-source packages and browser CDN references. Production npm dependency license details are tracked in `licenses.json`.

## Production npm License Summary

Production npm dependency licenses are tracked in `licenses.json`.

Permissive licenses such as MIT, Apache-2.0, ISC, BSD-2-Clause, BSD-3-Clause, BlueOak-1.0.0, and 0BSD are acceptable with notice tracking.

## Apache-2.0 Licensed Dependencies

Some npm dependencies may be licensed under Apache License 2.0.

Apache-2.0 dependency tracking is maintained in `licenses.json`.

Apache License 2.0:
https://www.apache.org/licenses/LICENSE-2.0

Compliance notes:
- Retain applicable copyright, patent, trademark, and attribution notices.
- Include Apache License 2.0 text or reference in distributed notices.
- Include upstream NOTICE file contents when a distributed dependency includes a NOTICE file and the notice applies.
- If any Apache-licensed source files are modified directly, mark those files with prominent modification notices.

No direct modification of Apache-licensed third-party package source files is currently recorded in this project.

## Browser CDN References

The following third-party browser scripts may be loaded directly by static HTML demo files and may not appear in package.json, package-lock.json, or licenses.json.

| Library | Source | Use | License Tracking Notes |
|---|---|---|---|
| SheetJS / XLSX | jsDelivr CDN: xlsx/dist/xlsx.full.min.js | Browser-based CSV/XLS/XLSX upload and export in demo HTML files | Track separately from npm dependencies because it is referenced directly in HTML. Confirm license before commercial production use. |
