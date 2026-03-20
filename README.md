# Obsidian Google Drive Sync

A high-performance, granular synchronization plugin for Obsidian that connects your vault to Google Drive. Keep your notes in sync across devices with precision control and minimal overhead.

## ✨ Key Features

- **🚀 100x Performance Boost**: High-speed parallel recursive crawl with minimal API overhead. Sync initiation is now nearly instantaneous.
- **🌲 Hybrid Sync Tree**: A unified view of local and remote files. See exactly what's on your Drive versus what's in your vault.
- **🛡️ Privacy-First (Strict Sync)**: Targeted syncing that only interacts with your vault folder—never your entire Google Drive.
- **↕️ Granular Push & Pull**: Don't want to sync everything? Use individual ↑ (Push) and ↓ (Pull) icons for specific files or folders.
- **✅ Selective Sync**: Easily exclude folders or files from automatic sync via a simple checkbox interface.
- **📛 Filename Sanitization**: Automatic handling of illegal characters like colons (:) to ensure cross-platform compatibility.

## 🚀 Quick Start

1. **Install the Plugin**: 
   - Copy `main.js`, `manifest.json`, and `styles.css` to your vault's `.obsidian/plugins/obsidian-gdrive-sync/` folder.
   - Enable the plugin in **Settings > Community plugins**.
2. **Setup Google Cloud**: This plugin requires you to create your own Google Cloud project (for privacy and API quota reasons).
   - **Follow the [Detailed Setup Guide](SETUP.md)** for step-by-step instructions on creating your Client ID and Secret.
3. **Authenticate**: Use the "Localhost" trick described in the setup guide to finalize your connection.
4. **Sync**: Use the Ribbon icons (Cloud Upload/Download) or the Command Palette to trigger your first sync.

## 🛠 Commands

- `Push Now`: Upload local changes to Google Drive.
- `Pull Now`: Download remote changes from Google Drive.
- `Sync Now (Full)`: Perform a full bidirectional synchronization.

## 📄 Documentation

- [Changelog](CHANGELOG.md)
- [Setup Guide](SETUP.md)

## 🏗 Development

If you want to build the plugin yourself:

```bash
npm install
npm run build
```

---
*Maintained by vkAi.*
