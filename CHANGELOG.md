# Changelog

All notable changes to this plugin will be documented in this file.

---

## [1.0.3] - 2026-November-12

### Fixed
- Applied RTL to Persian content in plain-text code fences.
- Corrected sentence periods before English-led sentences and after final English words.
- Separated ordered-list numbers from English phrases, keeping periods to the left of numbers in RTL items.

## [1.0.2] - 2026-November-04

### Fixed
- Preserved LTR word order in English phrases within Persian sentences.
- Corrected per-cell direction in Reading View and Live Preview tables.
- Preserved English letter order at the end of Persian table text.

### Added
- Text direction and Obsidian rendering regression checks.

## [1.0.1] - 2026-November-02

### Fixed
- Corrected bracket pairing in mixed Persian/English text.

### Changed
- Refined direction styles for rendered content and the editor.

## [1.0.0] - 2026-November-02

### Added
- Initial release with automatic Persian/Arabic RTL and English/code LTR support.
- Support for Reading View, Live Preview, Source Mode, code comments, properties, titles, and filenames.
