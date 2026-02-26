# Google Drive Sync v1.1.0 - Official Release

Welcome to the v1.1.0 release of the Google Drive Sync plugin for Obsidian! This update introduces granular control over data flow with independent push and pull settings, and ensures that selective sync settings are strictly respected on each device.

## How to Install the Plugin

1. Open your Obsidian Vault directory on your computer.
2. Navigate to `.obsidian/plugins/` (if the `plugins` folder doesn't exist, create it).
3. Create a new folder named `obsidian-gdrive-sync`.
4. Copy the `main.js`, `manifest.json`, and `styles.css` files from this `official_release` folder into your new `obsidian-gdrive-sync` folder.
5. Restart Obsidian, go to **Settings > Community Plugins**, disable "Safe Mode" if necessary, and enable "Google Drive Sync".

## How to Set Up the Google Drive Link

To allow the plugin to read and write your files, you must connect it to Google Drive using Google OAuth.

### 1. Create a Google Cloud Project
1. Go to the [Google Cloud Console](https://console.cloud.google.com/).
2. Create a new project (e.g., "Obsidian Sync").
3. Navigate to **APIs & Services > Library**, search for "Google Drive API", and click **Enable**.

### 2. Configure the OAuth Consent Screen
1. Go to **APIs & Services > OAuth consent screen**.
2. Choose **External** (or Internal if you have a Google Workspace) and click Create.
3. Fill in the required app details (App name, support email, developer contact information) and click **Save and Continue**.
4. Skip Scopes for now (save and continue). 
5. Add yourself as a Test User.

### 3. Create OAuth Credentials
1. Go to **APIs & Services > Credentials**.
2. Click **Create Credentials > OAuth client ID**.
3. Choose **Desktop app** as the Application type and click **Create**.
4. Note down your **Client ID** and **Client Secret**.

### 4. Configure the Plugin in Obsidian
1. In Obsidian, go to **Settings > Google Drive Sync**.
2. Select **Google OAuth2** as the Authentication Mode.
3. Paste the **Client ID** and **Client Secret** you created earlier.
4. Click the newly generated authorization link labeled "3. Click here to login to Google Drive in your browser".
5. Sign in with your Google account. Your browser will eventually fail to load a `localhost` URL.
6. Copy the *entire URL* from the address bar of the error page (it should look like `http://localhost/?code=4/0A...`).
7. Paste this URL into step 4 in the Obsidian plugin settings. 
8. The plugin will securely extract your token and begin syncing!

## Features in this Release
- **Independent Push/Pull Control [NEW]**: Toggle uploading and downloading separately for each device in the settings.
- **Improved Selective Sync [NEW]**: Unchecked files/folders are now explicitly ignored during the pull phase, preventing unwanted downloads.
- **Two-Way Sync**: Native sync of local files and Google Drive modifications.
- **Selective Sync**: Choose exactly which folders or files to ignore via a visual tree.
- **Conflict Resolution**: "Pick-Newest" architecture prevents sync loops.
- **Dynamic Status Bar**: Displays the last successful sync time.
- **Supports All Files**: Syncs non-markdown extensions (e.g., `.base`, `.pdf`).
