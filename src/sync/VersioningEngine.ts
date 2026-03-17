import { App, TFile } from 'obsidian';
import SparkMD5 from 'spark-md5';

interface HashCacheEntry {
    md5: string;
    mtime: number;
    size: number;
}

interface HashCache {
    files: {
        [path: string]: HashCacheEntry;
    };
}

export class VersioningEngine {
    private cachePath = '.obsidian-gdrive-cache.json';
    private cache: HashCache = { files: {} };

    constructor(private app: App) {}

    async loadCache() {
        try {
            if (await this.app.vault.adapter.exists(this.cachePath)) {
                const content = await this.app.vault.adapter.read(this.cachePath);
                this.cache = JSON.parse(content);
            }
        } catch (e) {
            console.error('Failed to load hash cache', e);
            this.cache = { files: {} };
        }
    }

    async saveCache() {
        try {
            await this.app.vault.adapter.write(this.cachePath, JSON.stringify(this.cache, null, 2));
        } catch (e) {
            console.error('Failed to save hash cache', e);
        }
    }

    async getHash(file: TFile): Promise<string> {
        const entry = this.cache.files[file.path];
        if (entry && entry.mtime === file.stat.mtime && entry.size === file.stat.size) {
            return entry.md5;
        }

        // Cache miss or file changed
        const data = await this.app.vault.readBinary(file);
        const md5 = SparkMD5.ArrayBuffer.hash(data);

        this.cache.files[file.path] = {
            md5,
            mtime: file.stat.mtime,
            size: file.stat.size
        };

        return md5;
    }

    /**
     * Updates the cache for a specific path after a successful sync/download
     */
    updateEntry(path: string, md5: string, mtime: number, size: number) {
        this.cache.files[path] = { md5, mtime, size };
    }

    /**
     * Clears cache for files that no longer exist in the vault
     */
    async cleanCache(existingPaths: Set<string>) {
        let changed = false;
        for (const path in this.cache.files) {
            if (!existingPaths.has(path)) {
                delete this.cache.files[path];
                changed = true;
            }
        }
        if (changed) {
            await this.saveCache();
        }
    }
}
