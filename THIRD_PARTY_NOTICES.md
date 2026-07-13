# Third-Party Notices

This project is private/proprietary software. Third-party open-source dependency license details for the distributed production application are tracked in `licenses-production.sanitized.json`.

Development-only tooling is tracked separately in `licenses-development.sanitized.json`.

This notice file preserves third-party license notices for production dependencies and browser-loaded libraries.

## Production npm License Summary

| License | Notice Handling |
|---|---|
| MIT | Retain the applicable copyright notice and permission notice. |
| Apache-2.0 | Include a copy of the Apache License 2.0 and preserve applicable copyright, attribution, trademark, patent, and upstream NOTICE content. |
| ISC | Retain the applicable copyright notice, permission notice, and warranty disclaimer. |
| BSD-3-Clause | Retain the copyright notice, conditions, and disclaimer; do not imply endorsement. |
| BSD-2-Clause | Retain the copyright notice, conditions, and disclaimer. |
| BlueOak-1.0.0 | Provide recipients the license text or a link to the license. |
| 0BSD | Preserve the applicable license text when distributed with the component. |
| UNLICENSED | Applies only to the owner application, which remains private/proprietary. |

## Browser-Loaded Libraries

The following browser libraries are referenced directly by static HTML files and therefore may not appear in `package.json`, `package-lock.json`, or npm-generated reports.

| Library | Version | Source Pattern | Use | License |
|---|---:|---|---|---|
| SheetJS / XLSX | 0.18.5 | jsDelivr or approved local copy | CSV/XLS/XLSX import and export | Apache-2.0 |
| jsPDF | 2.5.1 | jsDelivr or approved local copy | PDF generation | MIT |
| JSZip | 3.10.1 | jsDelivr or approved local copy | Reading ZIP archives, including Census Gazetteer downloads | MIT |

For release consistency, browser-library URLs should use exact pinned versions or approved local copies.

## Public Data Sources

Public datasets are documented separately in `ESPIN_LINK_Attributions_and_Data_Sources_v1.0.pdf`.

## Preserved Upstream NOTICE Content

The following upstream NOTICE content was found for the production dependency `bare-path` and is preserved below.

```text
Third-Party NOTICE Files Found

Repository: espin-equipment

The following third-party dependency NOTICE file was found in node_modules and is preserved below:

node_modules/bare-path/NOTICE

----- node_modules/bare-path/NOTICE -----
Copyright 2023 Holepunch Inc

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.

---

Copyright Joyent, Inc. and other Node contributors.

Permission is hereby granted, free of charge, to any person obtaining a
copy of this software and associated documentation files (the
"Software"), to deal in the Software without restriction, including
without limitation the rights to use, copy, modify, merge, publish,
distribute, sublicense, and/or sell copies of the Software, and to permit
persons to whom the Software is furnished to do so, subject to the
following conditions:

The above copyright notice and this permission notice shall be included
in all copies or substantial portions of the Software.
```

## Current Compliance Position

- `licenses-production.sanitized.json` is the machine-readable production dependency license inventory.
- `licenses-development.sanitized.json` tracks development-only tooling separately.
- `THIRD_PARTY_LICENSES_CORRECTED.md` preserves the standard license texts used by production dependencies.
- This file preserves upstream NOTICE content and directly referenced browser libraries.
- No GPL, AGPL, or LGPL license was identified in the reviewed production dependency inventory.
- This document is an operational compliance aid and not a formal legal opinion.
