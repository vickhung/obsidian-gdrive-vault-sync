import { Plugin, Notice } from 'obsidian';
import { ObsidianGDriveSyncSettings, DEFAULT_SETTINGS } from './src/types';
import { ObsidianGDriveSyncSettingTab } from './src/ui/SettingsTab';
import { GoogleAuth } from './src/auth/GoogleAuth';
import { GoogleDriveStorage } from './src/storage/GoogleDriveStorage';
import { SyncEngine } from './src/sync/SyncEngine';

export default class ObsidianGDriveSyncPlugin extends Plugin {
    settings: ObsidianGDriveSyncSettings;
    statusBarItemEl: HTMLElement;
    syncIntervalId: number | undefined;
    syncEngine: SyncEngine | null = null;
    isSyncing = false;

    async onload() {
        await this.loadSettings();

        this.statusBarItemEl = this.addStatusBarItem();
        this.updateStatusBar();

        // This adds a simple item to the left ribbon.
        const ribbonIconEl = this.addRibbonIcon('refresh-cw', 'Sync with Google Drive', (evt: MouseEvent) => {
            this.triggerSync('manual');
        });
        ribbonIconEl.addClass('obsidian-gdrive-sync-ribbon');

        this.addCommand({
            id: 'sync-google-drive',
            name: 'Sync Now',
            callback: () => {
                this.triggerSync('manual');
            }
        });

        this.addSettingTab(new ObsidianGDriveSyncSettingTab(this.app, this));

        this.configureInterval();

        if (this.settings.syncMode === 'onOpenClose') {
            // Trigger sync on open immediately
            this.app.workspace.onLayoutReady(() => {
                this.triggerSync('onOpen');
            });
        }
    }

    onunload() {
        if (this.settings.syncMode === 'onOpenClose') {
            // Can't reliably do large async tasks on unload, but we could try.
            // Obsidian background tasks are better. For now we just log.
            console.log('Unloading GDrive sync plugin.');
        }
    }

    async loadSettings() {
        this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    }

    async saveSettings() {
        await this.saveData(this.settings);
    }

    public configureInterval() {
        if (this.syncIntervalId !== undefined) {
            window.clearInterval(this.syncIntervalId);
            this.syncIntervalId = undefined;
        }

        if (this.settings.syncMode === 'interval') {
            const ms = Math.min(Math.max(this.settings.syncIntervalMinutes * 60 * 1000, 600000), 3600000); // 10m to 60m bounds
            this.syncIntervalId = window.setInterval(() => this.triggerSync('interval'), ms);
            this.registerInterval(this.syncIntervalId);
            console.log(`[GDrive Sync] Configured interval to \${this.settings.syncIntervalMinutes}m`);
        }
    }

    private updateStatusBar() {
        if (this.isSyncing) {
            this.statusBarItemEl.setText('Syncing Drive...');
            return;
        }

        if (this.settings.lastSyncTime === 0) {
            this.statusBarItemEl.setText('Not synced yet');
        } else {
            const minutesAgo = Math.floor((Date.now() - this.settings.lastSyncTime) / 60000);

            let extra = '';
            if (this.settings.syncMode === 'interval') {
                const nextIn = this.settings.syncIntervalMinutes - minutesAgo;
                extra = ` | Next: \${nextIn > 0 ? nextIn : 0}m`;
            }

            this.statusBarItemEl.setText(`Last sync: \${minutesAgo}m ago\${extra}`);
        }
    }

    public async triggerSync(source: string) {
        if (this.isSyncing) {
            new Notice('Google Drive Sync is already running.');
            return;
        }

        if (!this.settings.driveFolderId) {
            new Notice('Please configure a Google Drive Folder ID in settings first.');
            return;
        }

        // Skip setup if auth isn't provided (for MVP)
        if (this.settings.authMode === 'service-account' && !this.settings.serviceAccountJson) {
            new Notice('Please configure Service Account JSON.');
            return;
        }

        if (this.settings.authMode === 'oauth' && !this.settings.refreshToken) {
            new Notice('Please login with Google Auth in the Settings first.');
            return;
        }

        try {
            this.isSyncing = true;
            this.updateStatusBar();
            // Create lazily
            const auth = new GoogleAuth(
                this.settings,
                () => this.saveSettings()
            );

            const storage = new GoogleDriveStorage(auth, this.settings.driveFolderId);

            this.syncEngine = new SyncEngine(this.app, storage, this.settings, (msg: string) => {
                new Notice(msg, 10000); // the addConflictNotice function
            });

            await this.syncEngine.sync();
            new Notice('Google Drive Sync Complete.');
        } catch (e: any) {
            console.error('GDrive Sync Error:', e);
            new Notice(`Google Drive Sync Error: ${e.message}`);
        } finally {
            this.isSyncing = false;
            this.updateStatusBar();
        }
    }
}
