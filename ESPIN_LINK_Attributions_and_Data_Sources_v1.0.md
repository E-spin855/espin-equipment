# ESPIN LINK Attributions and Data Sources

Version 1.0 — updated July 24, 2026

This document records map technology, map data, and public datasets used by ESPIN LINK. It supplements `THIRD_PARTY_NOTICES.md` and `THIRD_PARTY_LICENSES.md`.

## MapLibre GL JS

- Component: MapLibre GL JS 5.24.0
- Purpose: Browser rendering of the interactive proximity map
- License: BSD 3-Clause
- Project: https://maplibre.org/
- Source: https://github.com/maplibre/maplibre-gl-js

Copyright and license notices supplied by the MapLibre project must be retained with distributed copies.

## OpenFreeMap

- Purpose: Vector-map style and hosted map tiles
- Style endpoint: https://tiles.openfreemap.org/styles/liberty
- Project: https://openfreemap.org/
- Terms: https://openfreemap.org/tos/

ESPIN LINK retains the map attribution control and identifies OpenFreeMap in the proximity view.

## OpenStreetMap

- Purpose: Geographic map data used by the OpenFreeMap vector map
- Attribution: © OpenStreetMap contributors
- Copyright and license information: https://www.openstreetmap.org/copyright
- Data license: Open Data Commons Open Database License 1.0

Attribution must remain reasonably visible whenever the interactive map is displayed.

## U.S. Census Bureau Gazetteer Data

- Dataset: 2025 ZIP Code Tabulation Areas Gazetteer representative coordinates
- Purpose: Approximate ZIP-based account markers and proximity calculations
- Source: https://www.census.gov/geographies/reference-files/time-series/geo/gazetteer-files.html
- Local source file: `public/data/2025_Gaz_zcta_national.txt`

U.S. Census Bureau data is a work of the United States Government and is generally not subject to domestic copyright protection. ESPIN LINK identifies the Census Bureau as the coordinate source.

## Google Maps Links

ESPIN LINK may open a user-selected location in Google Maps through a standard public search URL. Google map content, tiles, or APIs are not embedded by this feature. Use remains subject to Google's applicable terms.

## Operational Requirement

Do not remove or obscure the visible map attribution. When changing a map library, tile provider, style endpoint, or public dataset, update this document and `THIRD_PARTY_NOTICES.md` before release.
