# Setup Guide: Obsidian Google Drive Sync

This guide will walk you through setting up your Google Cloud project and authenticating the plugin.

## 📋 GCP Credentials Checklist
Before you start the Obsidian configuration, you must have:
1. **Google Client ID**: From your OAuth Desktop App credentials.
2. **Google Client Secret**: From your OAuth Desktop App credentials.
3. **Drive Folder ID**: Found in the browser URL of your target Drive folder.

---

## Step 1: Create a Google Cloud Project
1. Go to the [Google Cloud Console](https://console.cloud.google.com/).
2. Click **Select a project** (or the current project name) at the top and select **New Project**.
3. Name it (e.g., `Obsidian Sync`) and click **Create**.

## Step 2: Enable the Google Drive API
1. In the sidebar, go to **APIs & Services > Library**.
2. Search for **Google Drive API**.
3. Click it and then click **Enable**.

## Step 3: Configure the OAuth Consent Screen
1. Go to **APIs & Services > OAuth consent screen**.
2. Select **External** (unless you have a Google Workspace/Organization, then select Internal) and click **Create**.
3. Provide the required info:
   - **App name**: `Obsidian GDrive Sync`
   - **User support email**: Your email
   - **Developer contact info**: Your email
4. Click **Save and Continue**.
5. **Scopes**: Click **Add or Remove Scopes**, search for `https://www.googleapis.com/auth/drive.file`, check it (it will say "See, edit, create, and delete only the specific Google Drive files you use with this app"), and click **Update**.
6. Click **Save and Continue**.
7. **Test Users**: Under "Test users", click **+ Add Users** and enter your own Google Email address. **This is required** to allow you to log in while the app is in "Testing" mode.
8. Click **Save and Continue** and then **Back to Dashboard**.
9. **IMPORTANT**: Click **Publish App** under "Publishing status" if you want your login to last longer than 7 days, though "Testing" mode is fine for personal use as long as you added yourself as a test user.

## Step 4: Create OAuth Credentials
1. Go to **APIs & Services > Credentials**.
2. Click **+ Create Credentials > OAuth client ID**.
3. **Application type**: Select **Desktop app**.
4. **Name**: `Obsidian Desktop`.
5. Click **Create**.
6. **Copy your Client ID and Client Secret**. You will need these in the plugin settings.

---

## Step 5: Configure the Plugin in Obsidian
1. Open Obsidian and go to **Settings > Community plugins > Google Drive Sync**.
2. **Drive Root Folder ID**:
   - Go to your Google Drive in the browser.
   - Open (or create) the folder you want to sync.
   - Copy the ID from the URL (everything after `folder/` in `drive.google.com/drive/folders/ID`).
3. **Authentication Mode**: Select **Google OAuth2**.
4. Paste your **Google Client ID** and **Google Client Secret**.
5. Click the link: **3. Click here to login to Google Drive in your browser**.

## Step 6: Finalize Authentication (The "Localhost" Trick)
1. After logging in via your browser, you will see a page that says **"This site can’t be reached"** or **"localhost refused to connect"**.
2. **This is normal and expected.**
3. Look at the Address Bar (URL) of that error page.
4. Copy the **entire URL** (it should look like `http://localhost/?code=4/0Af...`).
5. Go back to Obsidian and paste that URL into the field **4. Paste Error URL here**.
6. You should see a success notice!

---

## Advanced: Service Account Setup (Optional)
If you prefer using a Service Account (recommended for automated agents):
1. Go to **APIs & Services > Credentials**.
2. Click **+ Create Credentials > Service Account**.
3. Follow the steps to create it.
4. Once created, click on the service account email, go to the **Keys** tab, and click **Add Key > Create new key (JSON)**.
5. In Obsidian, set Auth Mode to **Service Account** and paste the JSON content.
6. **IMPORTANT**: You must **Share** your Google Drive folder with the service account's email address (with Editor permissions) for it to work.
