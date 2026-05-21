# Third-Party Notices

This project is private/proprietary software. Third-party open-source dependency license details are tracked in `licenses.json`.

This notice file exists to preserve third-party license notice tracking for production dependencies and browser CDN references.

## Production npm License Summary

Production npm dependency license evidence is tracked in `licenses.json`.

| License | Notice Handling |
|---|---|
| MIT | Retain copyright notice and permission notice. |
| Apache-2.0 | Retain copyright, patent, trademark, attribution notices; include Apache License 2.0 text or reference; include upstream NOTICE contents when applicable. |
| ISC | Retain copyright notice, permission notice, and warranty disclaimer. |
| BSD-3-Clause | Retain copyright notice, conditions, and disclaimer; do not imply endorsement. |
| BSD-2-Clause | Retain copyright notice, conditions, and disclaimer. |
| BlueOak-1.0.0 | Provide recipients the license text or a link to the license. |
| 0BSD | Listed for tracking; permissive public-domain-style license. |
| UNLICENSED | Owner application only; private/proprietary app. |

## Full License References

The full license texts for third-party dependencies should be preserved through `licenses.json`, upstream package metadata, package tarballs, and the official license references below.

### MIT License

MIT-licensed dependencies require retaining the copyright notice and permission notice.

License text:
https://opensource.org/license/mit

### Apache License 2.0

Apache-2.0 licensed dependencies require retaining applicable copyright, patent, trademark, attribution notices, including the Apache License 2.0 text or reference, and including upstream NOTICE file contents when applicable.

Apache License 2.0:
https://www.apache.org/licenses/LICENSE-2.0

Apache guidance:
https://www.apache.org/legal/apply-license.html

No direct modification of Apache-licensed third-party package source files is currently recorded in this project.

### ISC License

ISC-licensed dependencies require retaining the copyright notice, permission notice, and disclaimer.

License text:
https://opensource.org/license/isc-license-txt

### BSD-3-Clause License

BSD-3-Clause licensed dependencies require retaining the copyright notice, conditions, and disclaimer. The names of copyright holders or contributors may not be used to endorse or promote products without prior written permission.

License text:
https://opensource.org/license/bsd-3-clause

### BSD-2-Clause License

BSD-2-Clause licensed dependencies require retaining the copyright notice, conditions, and disclaimer.

License text:
https://opensource.org/license/bsd-2-clause

### BlueOak Model License 1.0.0

BlueOak-licensed dependencies require providing recipients the license text or a link to the license.

License text:
https://blueoakcouncil.org/license/1.0.0

### 0BSD License

0BSD dependencies are tracked in `licenses.json`.

License text:
https://opensource.org/license/0bsd

## Browser CDN References

The following third-party browser scripts may be loaded directly by static HTML demo files and may not appear in `package.json`, `package-lock.json`, or `licenses.json`.

| Library | Source | Use | License Tracking Notes |
|---|---|---|---|
| SheetJS / XLSX | jsDelivr CDN: xlsx/dist/xlsx.full.min.js | Browser-based CSV/XLS/XLSX upload and export in demo HTML files | Track separately from npm dependencies because it is referenced directly in HTML. Confirm license before commercial production use. |

## Current Compliance Position

- `licenses.json` is the machine-readable production dependency license report.
- `THIRD_PARTY_NOTICES.md` is the human-readable third-party notice record.
- Browser CDN references are tracked separately because they may not appear in npm dependency reports.
- No GPL, AGPL, or LGPL license match was found in the reviewed license report.
- This document is an operational compliance aid, not legal advice.
