import { App, TFile, TFolder, FileSystemAdapter } from 'obsidian';
import { minimatch } from 'minimatch';
import { Storage, SyncRule, ObsidianGDriveSyncSettings, FileMeta } from '../types';

interface SyncState {
    files: {
        [path: string]: {
            md5Checksum: string;
            modifiedTime: number; // Remote modified time
        };
    };
}

export class SyncEngine {
    private syncStatePath = '.obsidian-gdrive-sync.json';
    private state: SyncState = { files: {} };

    constructor(
        private app: App,
        private storage: Storage,
        private settings: ObsidianGDriveSyncSettings,
        private addConflictNotice: (msg: string) => void
    ) { }

    private async loadState() {
        try {
            const content = await this.app.vault.adapter.read(this.syncStatePath);
            this.state = JSON.parse(content);
        } catch (e) {
            // File might not exist
            this.state = { files: {} };
        }
    }

    private async saveState() {
        await this.app.vault.adapter.write(this.syncStatePath, JSON.stringify(this.state, null, 2));
    }

    private matchesRule(path: string): SyncRule | undefined {
        // Find the first rule that matches
        // For personal full vault sync this might just be a rule with localPattern "**"
        if (this.settings.syncRules.length === 0) {
            return {
                localPattern: '**',
                driveFolderId: this.settings.driveFolderId,
                direction: 'two-way'
            };
        }

        for (const rule of this.settings.syncRules) {
            if (minimatch(path, rule.localPattern, { dot: true })) {
                return rule;
            }
        }
        return undefined;
    }

    private async getLocalFiles(): Promise<TFile[]> {
        return this.app.vault.getFiles().filter(file => {
            if (file.path === this.syncStatePath) return false; // Exclude sync state itself
            if (file.path.startsWith('.obsidian/')) return false; // Exclude vault config including this plugin's data.json containing secrets
            if (file.path.includes('.conflicted.')) return false; // Never sync conflicted files
            return this.matchesRule(file.path) !== undefined;
        });
    }
    private async getRemoteFileContent(rule: SyncRule, localPath: string): Promise<ArrayBuffer | null> {
        // Strip out the pattern base if needed or just use relative paths.
        // If the rule maps "Agents/AgentA/**" to Drive folder "xyz", 
        // the Drive folder "xyz" IS the root for "Agents/AgentA".
        // Example: local path is "Agents/AgentA/Inbox/Note.md"
        // We need to construct the drive path.
        // For simplicity right now, Storage is already initialized with a rootFolderId (e.g. "xyz").
        // This means the remote path expects "Inbox/Note.md" if the Storage instance is root mapped to "xyz".

        // Wait, Storage is passed into here. We assume `storage` maps paths relative to the rule Drive Folder.
        // That means we need multiple Storage instances for multiple rules! Or `storage` takes folder ID per call.
        // Let's modify our approach: SyncEngine takes a factory or storage already has root.
        // For this MVP, let's assume one main Storage instance mapped to the user's root sync folder.
        // Meaning `Storage` operates on paths relative to that root folder.

        try {
            return await this.storage.get(localPath);
        } catch (e) {
            console.error('Failed to get remote file content', localPath, e);
            return null;
        }
    }

    public async sync() {
        console.log('Starting sync...');
        await this.loadState();

        const localFiles = await this.getLocalFiles();
        const remoteFiles = await this.storage.list(''); // List all files? We need to list recursively.
        // Wait, `storage.list` gets flat or nested? Our GoogleDriveStorage `list(path)` lists only one folder level.
        // We need a recursive list or we crawl the remote. 
        // To avoid excessive API calls, let's just do a remote list recursively from root using Drive API directly or a recursive `storage.list`.

        // Since `storage.list` isn't recursive, we will implement `crawlRemote` here or inside storage.
        const allRemoteFiles: FileMeta[] = [];
        await this.crawlRemote('', allRemoteFiles);

        const remoteFileMap = new Map<string, FileMeta>();
        for (const rf of allRemoteFiles) {
            remoteFileMap.set(rf.name /* this is just basename, we need full path */, rf);
        }

        // Wait, GoogleDriveStorage `list(path)` returns `FileMeta` but the `name` is just the basename.
        // We need the full path to compare with local `file.path`.

        // Let's redefine `crawlRemote` to keep track of paths
        await this.crawlRemoteWithPath('', '', allRemoteFiles);

        const remotePathMap = new Map<string, FileMeta>();
        for (const rf of allRemoteFiles) {
            remotePathMap.set(rf.id!, rf); // Just storing them, `id` is a hack here. `rf.name` will be full path in crawlRemoteWithPath.
        }

        const lFilesMap = new Map<string, TFile>();
        for (const lf of localFiles) {
            lFilesMap.set(lf.path, lf);
        }

        // --- 1. Download Remote Changes ---
        for (const [rPath, rMeta] of remotePathMap.entries()) {
            if (rMeta.mimeType === 'application/vnd.google-apps.folder') continue;

            const rule = this.matchesRule(rPath);
            if (!rule) continue;

            const lFile = lFilesMap.get(rPath);
            const stateEntry = this.state.files[rPath];

            if (!lFile) {
                // File exists remotely but not locally
                if (!stateEntry) {
                    // It's a brand new remote file
                    await this.downloadFile(rPath, rMeta);
                } else {
                    // It was synced before. Did the user delete it locally?
                    // If we support deletions, we could delete it remotely.
                    // For MVP, we'll download it back.
                    await this.downloadFile(rPath, rMeta);
                }
            } else {
                // File exists both remotely and locally. Compare.
                const localStat = await this.app.vault.adapter.stat(rPath);

                if (stateEntry) {
                    const localChanged = lFile.stat.mtime > this.settings.lastSyncTime;
                    const remoteChanged = rMeta.modifiedTime > stateEntry.modifiedTime;

                    if (localChanged && remoteChanged) {
                        // Conflict! Both changed since last sync.
                        await this.handleConflict(rPath, rMeta, lFile);
                    } else if (remoteChanged) {
                        // Only remote changed
                        await this.downloadFile(rPath, rMeta);
                    }
                } else {
                    // No state meaning local created and remote created independently. Conflict!
                    await this.handleConflict(rPath, rMeta, lFile);
                }
            }
        }

        // --- 2. Upload Local Changes ---
        for (const [lPath, lFile] of lFilesMap.entries()) {
            const rule = this.matchesRule(lPath);
            if (!rule || rule.direction === 'download-only') continue;

            const rMeta = remotePathMap.get(lPath);
            const stateEntry = this.state.files[lPath];
            const localChanged = lFile.stat.mtime > this.settings.lastSyncTime;

            if (!rMeta) {
                // File exists locally but not remotely
                if (!stateEntry || localChanged) {
                    await this.uploadFile(lPath, lFile);
                }
            } else {
                // Exists both. (Handled above, except for the pure local change case)
                if (localChanged && stateEntry && rMeta.modifiedTime <= stateEntry.modifiedTime) {
                    await this.uploadFile(lPath, lFile);
                }
            }
        }

        this.settings.lastSyncTime = Date.now();
        await this.saveState();
        console.log('Sync complete!');
    }

    private async crawlRemoteWithPath(currentPath: string, basePath: string, output: FileMeta[]) {
        const files = await this.storage.list(currentPath);
        for (const file of files) {
            const fullPath = basePath ? `${basePath}/${file.name}` : file.name;
            const metaWithPath = { ...file, name: fullPath }; // Override name with full path for the map
            // Hack: store full path in id for the map above to work
            metaWithPath.id = fullPath;
            output.push(metaWithPath);

            if (file.mimeType === 'application/vnd.google-apps.folder') {
                await this.crawlRemoteWithPath(fullPath, fullPath, output);
            }
        }
    }

    private async crawlRemote(path: string, output: FileMeta[]) {
        // Obsolete, using crawlRemoteWithPath
    }

    private async downloadFile(path: string, remoteMeta: FileMeta) {
        console.log(`Downloading ${path}...`);
        const data = await this.storage.get(path);

        // Ensure parent directories exist
        const parts = path.split('/');
        parts.pop(); // Remove filename
        let currentLocalPath = '';
        for (const part of parts) {
            currentLocalPath += currentLocalPath === '' ? part : '/' + part;
            const exists = await this.app.vault.adapter.exists(currentLocalPath);
            if (!exists) {
                await this.app.vault.createFolder(currentLocalPath);
            }
        }

        const pathExists = await this.app.vault.adapter.exists(path);
        if (pathExists) {
            const tfile = this.app.vault.getAbstractFileByPath(path) as TFile;
            await this.app.vault.modifyBinary(tfile, data);
        } else {
            await this.app.vault.createBinary(path, data);
        }

        this.state.files[path] = {
            md5Checksum: remoteMeta.md5Checksum || '',
            modifiedTime: remoteMeta.modifiedTime
        };
    }

    private async uploadFile(path: string, localFile: TFile) {
        console.log(`Uploading ${path}...`);
        const data = await this.app.vault.readBinary(localFile);

        // Ensure remote parent folders exist: storage.put handles it with resolvePathToId(createIfMissing=true)

        const rMeta = await this.storage.put(path, data, 'text/markdown'); // In reality we'd detect mimetype based on extension

        this.state.files[path] = {
            md5Checksum: rMeta.md5Checksum || '',
            modifiedTime: rMeta.modifiedTime
        };
    }

    private async handleConflict(path: string, remoteMeta: FileMeta, localFile: TFile) {
        console.log(`Conflict detected for ${path}, resolving by picking the newest file.`);

        // Pick the most recently modified file to win
        if (localFile.stat.mtime >= remoteMeta.modifiedTime) {
            console.log(`Local file is newer or same time as remote, uploading ${path}`);
            await this.uploadFile(path, localFile);
            this.addConflictNotice(`Resolved conflict for ${path} (Kept Local Version)`);
        } else {
            console.log(`Remote file is newer, downloading ${path}`);
            await this.downloadFile(path, remoteMeta);
            this.addConflictNotice(`Resolved conflict for ${path} (Kept Remote Version)`);
        }
    }
}
