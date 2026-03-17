import { App, TFile, TFolder, FileSystemAdapter } from 'obsidian';
import { minimatch } from 'minimatch';
import { Storage, SyncRule, ObsidianGDriveSyncSettings, FileMeta } from '../types';
import { VersioningEngine } from './VersioningEngine';

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
    private versioning: VersioningEngine;

    constructor(
        private app: App,
        private storage: Storage,
        private settings: ObsidianGDriveSyncSettings,
        private addConflictNotice: (msg: string) => void
    ) {
        this.versioning = new VersioningEngine(app);
    }

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
        const files: TFile[] = [];
        const ignoredSet = new Set(this.settings.ignoredPaths);

        const traverse = (fileOrFolder: TFile | TFolder) => {
            if (fileOrFolder.path === '.obsidian' || fileOrFolder.path.startsWith('.obsidian/')) return;
            if (ignoredSet.has(fileOrFolder.path)) return;

            if (fileOrFolder instanceof TFolder) {
                for (const child of fileOrFolder.children) {
                    if (child instanceof TFile || child instanceof TFolder) {
                        traverse(child);
                    }
                }
            } else if (fileOrFolder instanceof TFile) {
                if (fileOrFolder.path === this.syncStatePath) return;
                if (fileOrFolder.path.includes('.conflicted.')) return;
                
                if (this.matchesRule(fileOrFolder.path)) {
                    files.push(fileOrFolder);
                }
            }
        };

        for (const child of this.app.vault.getRoot().children) {
            if (child instanceof TFile || child instanceof TFolder) {
                traverse(child);
            }
        }
        
        return files;
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
        console.log('Starting full sync...');
        await this.loadState();
        await this.versioning.loadCache();
        await this.pull();
        await this.push();
        await this.versioning.saveCache();
        console.log('Full sync complete!');
    }

    public async pull(targetPath?: string) {
        console.log(`Starting pull ${targetPath ? 'for ' + targetPath : ''}...`);
        await this.loadState();
        await this.versioning.loadCache();
        
        const allRemoteFiles: FileMeta[] = [];
        await this.crawlRemoteWithPath('', '', allRemoteFiles);
        
        const remotePathMap = new Map<string, FileMeta>();
        for (const rf of allRemoteFiles) {
            remotePathMap.set(rf.id!, rf);
        }

        for (const [rPath, rMeta] of remotePathMap.entries()) {
            if (rMeta.mimeType === 'application/vnd.google-apps.folder') continue;
            if (targetPath && rPath !== targetPath && !rPath.startsWith(targetPath + '/')) continue;

            const rule = this.matchesRule(rPath);
            if (!rule) continue;

            const lFile = this.app.vault.getAbstractFileByPath(rPath);
            const stateEntry = this.state.files[rPath];

            if (!lFile) {
                await this.downloadFile(rPath, rMeta);
            } else if (lFile instanceof TFile) {
                const localHash = await this.versioning.getHash(lFile);
                const remoteHash = rMeta.md5Checksum;
                
                if (localHash !== remoteHash) {
                    const remoteChanged = rMeta.modifiedTime > (stateEntry?.modifiedTime || 0);
                    const localChanged = lFile.stat.mtime > this.settings.lastSyncTime;

                    if (remoteChanged && localChanged) {
                        await this.handleConflict(rPath, rMeta, lFile);
                    } else if (remoteChanged) {
                        await this.downloadFile(rPath, rMeta);
                    }
                }
            }
        }
        
        this.settings.lastSyncTime = Date.now();
        await this.saveState();
        await this.versioning.saveCache();
    }

    public async push(targetPath?: string) {
        console.log(`Starting push ${targetPath ? 'for ' + targetPath : ''}...`);
        await this.loadState();
        await this.versioning.loadCache();
        
        const localFiles = await this.getLocalFiles();
        
        for (const lFile of localFiles) {
            const lPath = lFile.path;
            if (targetPath && lPath !== targetPath && !lPath.startsWith(targetPath + '/')) continue;

            const rule = this.matchesRule(lPath);
            if (!rule || rule.direction === 'download-only') continue;

            const stateEntry = this.state.files[lPath];
            const localHash = await this.versioning.getHash(lFile);

            if (!stateEntry || stateEntry.md5Checksum !== localHash) {
                await this.uploadFile(lPath, lFile);
            }
        }

        this.settings.lastSyncTime = Date.now();
        await this.saveState();
        await this.versioning.saveCache();
    }

    public async fetchRemoteState(): Promise<Map<string, FileMeta>> {
        const allRemoteFiles: FileMeta[] = [];
        await this.crawlRemoteWithPath('', '', allRemoteFiles);

        const remotePathMap = new Map<string, FileMeta>();
        for (const rf of allRemoteFiles) {
            remotePathMap.set(rf.id!, rf);
        }
        return remotePathMap;
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

        const tfile = this.app.vault.getAbstractFileByPath(path) as TFile;
        this.state.files[path] = {
            md5Checksum: remoteMeta.md5Checksum || '',
            modifiedTime: remoteMeta.modifiedTime
        };

        // Important: Update hash cache so we don't re-upload what we just downloaded
        if (tfile) {
            this.versioning.updateEntry(path, remoteMeta.md5Checksum || '', tfile.stat.mtime, tfile.stat.size);
        }
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

        // Update local hash cache
        this.versioning.updateEntry(path, rMeta.md5Checksum || '', localFile.stat.mtime, localFile.stat.size);
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
