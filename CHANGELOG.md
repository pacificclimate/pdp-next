# Changelog

All notable changes to this project are documented here.
Format based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
this project follows [Semantic Versioning](https://semver.org/).

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
