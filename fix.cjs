const fs = require('fs');
const files = ['main.ts', 'src/storage/GoogleDriveStorage.ts', 'src/sync/SyncEngine.ts', 'src/ui/SettingsTab.ts', 'src/auth/GoogleAuth.ts'];
for (const file of files) {
    if (fs.existsSync(file)) {
        let text = fs.readFileSync(file, 'utf8');
        text = text.replace(/\\`/g, '`');
        fs.writeFileSync(file, text);
        console.log('Fixed', file);
    }
}
