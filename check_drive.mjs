import fs from 'fs';

const data = JSON.parse(fs.readFileSync('/home/vkwk/Documents/Obsidian Vault/.obsidian/plugins/obsidian-gdrive-sync/data.json', 'utf8'));

async function fetchToken() {
    const response = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
            client_id: data.clientId,
            client_secret: data.clientSecret,
            refresh_token: data.refreshToken,
            grant_type: 'refresh_token',
        }),
    });
    const res = await response.json();
    return res.access_token;
}

async function listFiles(token, folderId) {
    const q = `'${folderId}' in parents and trashed=false`;
    const url = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id,name,mimeType)`;
    const response = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` }
    });
    const resData = await response.json();
    for (const f of resData.files || []) {
        console.log(`Found: ${f.name} (type: ${f.mimeType})`);
    }
}

async function run() {
    const token = await fetchToken();
    if (!token) {
        console.error("Failed to get token");
        return;
    }
    console.log("Root files:");
    await listFiles(token, data.driveFolderId);
}
run();
