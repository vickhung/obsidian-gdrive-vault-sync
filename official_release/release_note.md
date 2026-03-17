# Release Notes - v1.1.0

This release introduces significant performance optimizations and major UI enhancements to provide a smoother and more reliable synchronization experience with Google Drive.

## ✨ New Features

### 🌲 Hybrid Sync Tree UI
A completely redesigned **Selective Sync** interface that merges your local vault with files stored on Google Drive.
- **Visual Distinction**: Easily see which files are local-only (accent color), remote-only (faint italics), or synced.
- **Granular Push/Pull**: Added individual **↑ (Push)** and **↓ (Pull)** icons next to every file and folder for immediate, targeted synchronization.
- **Auto-Expansion**: Checking a folder now automatically expands it to reveal its contents, making management more intuitive.

### ⚡ Performance Optimization
Obsidian remains responsive even with massive vaults (thousands of files).
- **Lazy Rendering**: Folders in the settings tree only render their children when expanded, preventing UI freezes.
- **Intelligent Hashing Cache**: Implemented a local MD5 hashing cache that tracks file modification times (`mtime`). The plugin now skips redundant hashing, ensuring that full vault scans are lightning-fast.

### ☁️ Dedicated Sync Actions
- Replaced the single "Sync" ribbon icon with two dedicated **Push** and **Pull** icons (`upload-cloud` and `download-cloud`) for clear directional control.
- Added corresponding commands to the Command Palette.

## 🛠 Fixes & Improvements
- Optimized file traversal to skip ignored directories at the source, reducing CPU overhead.
- Removed funding sections to keep the plugin focused on core functionality.
- Improved user feedback with clear notices and status bar progress during push/pull operations.

---
*For a detailed guide on how these features work, see the [walkthrough.md](file:///home/vkwk/.gemini/antigravity/brain/e99795f8-3c6f-4f6a-84c0-b18969b0482e/walkthrough.md) in your brain folder.*
