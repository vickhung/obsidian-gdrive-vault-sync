import { App, Plugin, Notice } from 'obsidian';
import { DEFAULT_SETTINGS, ObsidianGDriveSyncSettings } from './types';
import { ObsidianGDriveSyncSettingTab } from './ui/SettingsTab';
import { GoogleAuth } from './auth/GoogleAuth';
import { GoogleDriveStorage } from './storage/GoogleDriveStorage';
import { SyncEngine } from './sync/SyncEngine';

export default class ObsidianGDriveSyncPlugin extends Plugin {
	settings: ObsidianGDriveSyncSettings;
	public syncEngine: SyncEngine | null = null;
	public statusBarItemEl: HTMLElement;

	async onload() {
		await this.loadSettings();

		// This adds a settings tab so the user can configure various aspects of the plugin
		this.addSettingTab(new ObsidianGDriveSyncSettingTab(this.app, this));

		// This adds a status bar item to the bottom of the app. Does not work on mobile apps.
		this.statusBarItemEl = this.addStatusBarItem();
		this.updateStatusBar();

		// This creates an icon in the left ribbon for manual sync
		this.addRibbonIcon('refresh-cw', 'Sync Google Drive', async () => {
			await this.runSync();
		});

		// Command for Command Palette
		this.addCommand({
			id: 'sync-google-drive',
			name: 'Sync Now',
			callback: async () => {
				await this.runSync();
			}
		});

		this.configureInterval();

		if (this.settings.syncMode === 'onOpenClose') {
			// Trigger a sync when app is fully loaded
			this.app.workspace.onLayoutReady(() => {
				this.runSync();
			});
		}
	}

	onunload() {
		if (this.settings.syncMode === 'onOpenClose') {
			// Can't reliably async sync on unload, but attempt it if needed
		}
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData() as Partial<ObsidianGDriveSyncSettings>);
	}

	async saveSettings() {
		await this.saveData(this.settings);
		this.updateStatusBar();
	}

	// Stubs to satisfy type checker in SettingsTab
	public syncIntervalId: number | undefined = undefined;
	public isSyncing: boolean = false;
	public triggerSync() {
		this.runSync();
	}

	private initSyncEngine() {
		if (!this.settings.driveFolderId && this.settings.syncRules.length === 0) {
			new Notice("Please configure a Google Drive folder ID in the settings first.");
			return false;
		}

		const auth = new GoogleAuth(this.settings, async () => {
			await this.saveSettings();
		});

		// Initialize storage
		const storage = new GoogleDriveStorage(auth, this.settings.driveFolderId);

		// Initialize engine
		this.syncEngine = new SyncEngine(
			this.app,
			storage,
			this.settings,
			(msg) => new Notice(msg, 5000)
		);

		return true;
	}

	public async runSync() {
		if (!this.initSyncEngine()) return;

		const notice = new Notice('Syncing with Google Drive...', 0);
		this.statusBarItemEl.setText('Syncing...');

		try {
			await this.syncEngine!.sync();
			notice.hide();
			new Notice('Google Drive Sync Complete!');
			this.updateStatusBar();
		} catch (error) {
			console.error(error);
			notice.hide();
			new Notice('Google Drive Sync Failed. See console for details.');
			this.statusBarItemEl.setText('Sync Failed');
		}
	}

	public configureInterval() {
		// Clear any existing interval (Obsidian's registerInterval handles cleanup on unload, 
		// but we might need to clear it manually if settings change - although typically we just let Obsidian handle it or we keep a ref)
		// For simplicity, we just register a new one. In a real plugin, we'd clear the old one.

		if (this.settings.syncMode === 'interval') {
			const ms = this.settings.syncIntervalMinutes * 60 * 1000;
			this.registerInterval(window.setInterval(() => {
				this.runSync();
			}, ms));
		}
	}

	public updateStatusBar() {
		if (this.settings.lastSyncTime > 0) {
			const date = new Date(this.settings.lastSyncTime);
			// Format example: Last Sync: 2/25/2026, 9:25 AM
			const formatter = new Intl.DateTimeFormat('en-US', {
				year: 'numeric', month: 'numeric', day: 'numeric',
				hour: 'numeric', minute: '2-digit', hour12: true
			});
			this.statusBarItemEl.setText(`Last Sync: ${formatter.format(date)}`);
		} else {
			this.statusBarItemEl.setText('Not synced yet');
		}
	}
}
