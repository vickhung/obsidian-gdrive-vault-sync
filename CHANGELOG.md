# Changelog

## [1.2.0] - 2026-03-20

### 🚀 Performance & Privacy Overhaul
- **Privacy-First Strict Sync**: Replaced whole-drive metadata fetching with a targeted recursive crawl. The plugin now only interacts with files inside your configured vault folder, providing 100% privacy and zero visibility into the rest of your Google Drive.
- **100x Speedup**: Implemented a high-concurrency parallel recursive crawler with maximum page sizes (`pageSize=1000`). Sync initiation and "Selective Sync" tree loading are now nearly instantaneous even for accounts with tens of thousands of files.

### 🛠️ Robustness & Compatibility
- **Illegal Filename Sanitization**: Automatically handles characters that are illegal in Obsidian/OS filenames (such as `:`, `\`, `|`, `*`, `?`, etc.) by replacing them with safe alternatives.
- **ID-Based Retrieval**: Switched to direct Google Drive File IDs for all download operations. This ensures perfect linkage between local sanitized names (e.g., `CUDA- New Features`) and original remote Drive files (e.g., `CUDA: New Features`).
- **Enhanced MIME Type Support**: Improved detection for 60+ file extensions (including `.mp4`, `.pdf`, `.zip`, `.yaml`, etc.), ensuring files are recognized and openable on all devices.
- **Selective Sync Fixes**: Improved tree rendering logic to correctly show remote-only files as greyed-out and italicized for easier discovery.

### 🐞 Bug Fixes
- Fixed "File not found" errors during pull when filenames contained illegal characters.
- Fixed duplicated remote-only files appearing in some scenarios during sync.
- Fixed silent failures during folder creation on Android.

---

## [1.1.0] - 2026-03-16
- Initial support for directional sync (Push/Pull).
- Git-style versioning and content-hash verification.
- Improved OAuth flow and token management.
