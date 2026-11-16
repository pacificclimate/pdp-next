# Changelog

All notable changes to this project are documented here.
Format based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
this project follows [Semantic Versioning](https://semver.org/).

## [1.2.0] - 2026-11-16

### Added

- CF calendar-aware temporal selection and subsetting, including support for
  360-day, no-leap, all-leap, Gregorian, proleptic Gregorian, Julian, and TAI
  calendars (#31)
- Canadian Exclusive Economic Zone (EEZ) boundaries on the map, with
  reprojection when switching the map CRS (#30)
- Centralized, steward-editable display-label configuration for portals,
  datasets, menu headings, and variables, with documentation and label-key
  inspection tooling (#33)
- Dataset metadata summary modal with Markdown, JSON, and NcML downloads (#38)
- Editable date fields and calendar pickers for daily, monthly, and seasonal
  datasets, synchronized with the time slider (#49)
- Linear and logarithmic map rendering controls, dataset-specific rendering
  defaults, and URL persistence of scale settings (#50)
- Gridded daily datasets portal (#50)
- Map pointer coordinates in the active coordinate reference system (CRS)
  and raster cell value readout (#51)
- Interactive spatial selection editing, including editable bounding box and
  point coordinates in a selectable CRS, bounding box resizing and movement,
  point dragging, and optional labels in the map CRS (#52)
- URL persistence and sharing of spatial selections, including selection
  type, CRS, and stored coordinates (#52)
- GitHub Actions CI for JavaScript and Python tests and production builds (#31)

### Changed

- Lazy-loaded the subsetting controller to reduce the initial viewer
  bundle size (#35)
- Replaced browser alerts with inline status-panel feedback, removed the
  native confirmation fallback, and added a cancel option to the large
  time-selection dialog before request submission (#39)
- Time slider, WMS time requests, and NetCDF subsetting now use a common
  CF-aware time-coordinate conversion and indexing implementation (#31)
- Time-coordinate discovery now uses CF reference-time units rather than
  requiring a variable named `time` (#47)
- Map and legend rendering now use consistent WMS parameters and
  numeric precision (#50)
- Spatial selection coordinates use five decimal places for longitude and
  latitude and whole metres for projected coordinates, with a read-only
  EPSG:4326 summary matching the submitted bounds (#52)
- Map navigation is constrained to a broad North American extent covering
  Canada and its EEZ (#52)
- Map background outside rendered coverage now matches the ocean colour (#30)

### Fixed

- Temporal date-range validation and indexing for datasets using
  non-Gregorian calendars and sub-day time coordinates (#31)
- OPeNDAP coordinate parsing dropping the first time coordinate (#31)
- Viewport position and ground resolution when switching map projections,
  and viewport extent restoration from shared URLs (#40)
- Temporal selection and subsetting for datasets with descending time
  coordinates, preserving source ordering while displaying dates
  chronologically (#48)
- Spatial selection geometry and coordinate preservation when switching
  map projections (#52)
- Out-of-range spatial coordinate edits and coordinate drift when repeatedly
  applying an unchanged selection (#52)

## [1.1.2] - 2026-10-27

### Security
- Rebuild images to pick up the Brotli decoder fix for
  [CVE-2026-111497](https://nvd.nist.gov/vuln/detail/CVE-2026-111497). The viewer
  image now runs `apk upgrade` so it gets `brotli-libs` 1.2.1 before
  `nginx:alpine` ships the fix itself.

## [1.1.1] - 2026-09-17

### Fixed
- BBOX subsetting [#27](https://github.com/pacificclimate/pdp-next/pull/27)

## [1.1.0] - 2026-09-10

### Changed

- Migrated the viewer build system to Vite and bundled frontend dependencies locally (#24)

## [1.0.1] - 2026-09-09

### Fixed

- Single-step climatology downloads.

## [1.0.0] - 2026-09-09

### Added

- Runtime config for enabling/disabling portals per deployment, allowing
  prod to publish a subset of portals independently of code changes (#23)

## [0.6.0] - 2026-09-03

### Added

- Portal metadata build pipeline: `portal_meta_builder`, per-portal file
  pattern definitions, and min/max query tooling (#19)

## [0.5.0] - 2026-09-02

### Added

- Async ncpartitioner integration (#13)
- Parameterized current view/selection; preserve viewport across variable and projection changes (#18)
- Status bar history log; link metadata button to dataset metadata (#18)

## [0.4.0] - 2026-08-28

### Changed

- Added npm policy, bumped CI action versions (#21)

## [0.3.0] - 2026-07-08

### Added

- Varnish `default.vcl` for caching (#15)

### Fixed

- Min COLORSCALERANGE handling for precipitation layers (#10)
- RCI review feedback: config, map controller, dataset/menu fixes (#11)

## [0.2.0] - 2026-06-29

### Changed

- Restricted demo to Canada Mosaics and PRISM portals (#14)

## [0.1.0] - 2026-06-29

### Added

- Initial viewer UI, THREDDS config, CI workflows (#1)
