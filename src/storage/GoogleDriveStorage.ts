import { FileMeta, Storage } from '../types';
import { GoogleAuth } from '../auth/GoogleAuth';

export class GoogleDriveStorage implements Storage {
    private readonly driveApiBase = 'https://www.googleapis.com/drive/v3/files';
    private readonly uploadApiBase = 'https://www.googleapis.com/upload/drive/v3/files';

    // A cache from path string to Drive File ID to avoid expensive recursive lookups
    private pathIdCache: Map<string, string> = new Map();

    constructor(
        private auth: GoogleAuth,
        private rootFolderId: string
    ) {
        this.pathIdCache.set('/', this.rootFolderId);
    }

    private async fetchWithAuth(url: string, options: RequestInit = {}): Promise<Response> {
        const token = await this.auth.getAccessToken();
        const headers = new Headers(options.headers || {});
        headers.set('Authorization', `Bearer ${token}`);

        return fetch(url, { ...options, headers });
    }

    /**
     * Resolves a folder path to a Drive File ID, creating intermediate folders if necessary.
     */
    private async resolvePathToId(path: string, createIfMissing: boolean = false): Promise<string | null> {
        if (path === '/' || path === '') return this.rootFolderId;

        // Strip leading/trailing slashes and split
        const parts = path.replace(/^\/+|\/+$/g, '').split('/');
        let currentParentId = this.rootFolderId;
        let currentPath = '';

        for (const part of parts) {
            currentPath += '/' + part;

            if (this.pathIdCache.has(currentPath)) {
                currentParentId = this.pathIdCache.get(currentPath)!;
                continue;
            }

            // Look it up
            const q = `'${currentParentId}' in parents and name='${part}' and trashed=false`;
            const url = `${this.driveApiBase}?q=${encodeURIComponent(q)}&fields=files(id,mimeType)`;
            const response = await this.fetchWithAuth(url);

            if (!response.ok) {
                throw new Error(`Failed to resolve path: ${currentPath}`);
            }

            const data = await response.json();

            if (data.files && data.files.length > 0) {
                currentParentId = data.files[0].id;
                this.pathIdCache.set(currentPath, currentParentId);
            } else if (createIfMissing) {
                // Create folder
                const createUrl = this.driveApiBase;
                const crResponse = await this.fetchWithAuth(createUrl, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        name: part,
                        mimeType: 'application/vnd.google-apps.folder',
                        parents: [currentParentId]
                    })
                });

                if (!crResponse.ok) {
                    throw new Error(`Failed to create folder: ${currentPath}`);
                }

                const crData = await crResponse.json();
                currentParentId = crData.id;
                this.pathIdCache.set(currentPath, currentParentId);
            } else {
                return null; // Not found
            }
        }

        return currentParentId;
    }

    public async listAll(): Promise<FileMeta[]> {
        const q = `trashed=false`;
        let url = `${this.driveApiBase}?q=${encodeURIComponent(q)}&fields=nextPageToken,files(id,name,mimeType,modifiedTime,size,md5Checksum,parents)`;

        let allFiles: FileMeta[] = [];
        let hasNextPage = true;

        let pageCount = 0;
        while (hasNextPage) {
            pageCount++;
            console.log(`Fetching remote file list (page ${pageCount})...`);
            const response = await this.fetchWithAuth(url);
            if (!response.ok) {
                throw new Error(`Failed to list all files`);
            }

            const data = await response.json();

            if (data.files) {
                allFiles = allFiles.concat(data.files.map((f: any) => ({
                    id: f.id,
                    name: f.name,
                    mimeType: f.mimeType,
                    modifiedTime: new Date(f.modifiedTime).getTime(),
                    size: parseInt(f.size || '0', 10),
                    md5Checksum: f.md5Checksum,
                    parents: f.parents
                })));
            }

            if (data.nextPageToken) {
                url = `${this.driveApiBase}?q=${encodeURIComponent(q)}&fields=nextPageToken,files(id,name,mimeType,modifiedTime,size,md5Checksum,parents)&pageToken=${data.nextPageToken}`;
            } else {
                hasNextPage = false;
            }
        }

        return allFiles;
    }

    public async list(path: string): Promise<FileMeta[]> {
        const folderId = await this.resolvePathToId(path);
        if (!folderId) return []; // Folder does not exist

        const q = `'${folderId}' in parents and trashed=false`;
        let url = `${this.driveApiBase}?q=${encodeURIComponent(q)}&fields=nextPageToken,files(id,name,mimeType,modifiedTime,size,md5Checksum)`;

        let allFiles: FileMeta[] = [];
        let hasNextPage = true;

        while (hasNextPage) {
            const response = await this.fetchWithAuth(url);
            if (!response.ok) {
                throw new Error(`Failed to list files in path: ${path}`);
            }

            const data = await response.json();

            if (data.files) {
                allFiles = allFiles.concat(data.files.map((f: any) => ({
                    id: f.id,
                    name: f.name,
                    mimeType: f.mimeType,
                    modifiedTime: new Date(f.modifiedTime).getTime(),
                    size: parseInt(f.size || '0', 10),
                    md5Checksum: f.md5Checksum
                })));
            }

            if (data.nextPageToken) {
                url = `${this.driveApiBase}?q=${encodeURIComponent(q)}&fields=nextPageToken,files(id,name,mimeType,modifiedTime,size,md5Checksum)&pageToken=${data.nextPageToken}`;
            } else {
                hasNextPage = false;
            }
        }

        return allFiles;
    }

    public async get(path: string): Promise<ArrayBuffer> {
        const fileId = await this.resolvePathToId(path);
        if (!fileId) throw new Error(`File not found: ${path}`);

        const url = `${this.driveApiBase}/${fileId}?alt=media`;
        const response = await this.fetchWithAuth(url);

        if (!response.ok) {
            throw new Error(`Failed to download file: ${path}`);
        }

        return response.arrayBuffer();
    }

    public async put(path: string, data: ArrayBuffer, mimeType: string = 'text/markdown'): Promise<FileMeta> {
        // We need to resolve the parent's directory first
        const parts = path.split('/');
        const fileName = parts.pop()!;
        const parentPath = parts.join('/');

        const parentId = await this.resolvePathToId(parentPath, true);
        if (!parentId) throw new Error(`Failed to resolve parent directory for upload: ${parentPath}`);

        // Check if file already exists
        const fileId = await this.resolvePathToId(path);

        // Multi-part upload strategy is best for Drive REST API but a bit tedious without a library
        // For simplicity, we use the simple upload for the body, and patch metadata after.
        // Wait, standard fetch in generic TS supports Blob/ArrayBuffer direct upload:

        let uploadUrl = '';
        let uploadMethod = '';

        if (!fileId) {
            uploadUrl = `${this.uploadApiBase}?uploadType=media`;
            uploadMethod = 'POST';
        } else {
            uploadUrl = `${this.uploadApiBase}/${fileId}?uploadType=media`;
            uploadMethod = 'PATCH';
        }

        const response = await this.fetchWithAuth(uploadUrl, {
            method: uploadMethod,
            headers: {
                'Content-Type': mimeType
            },
            body: data
        });

        if (!response.ok) {
            const errText = await response.text();
            throw new Error(`Failed to upload media ${path}: ${response.status} ${errText}`);
        }

        const resData = await response.json();
        const uploadedFileId = resData.id || fileId;

        // 2) Patch Metadata
        let metaUrl = `${this.driveApiBase}/${uploadedFileId}`;
        const metadata: any = { name: fileName };
        if (!fileId && parentId) {
            // In Google Drive v3, you cannot write 'parents' directly on a PATCH update. 
            // You must use the 'addParents' query parameter.
            metaUrl += `?addParents=${parentId}`;
        }

        const metaResponse = await this.fetchWithAuth(metaUrl, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(metadata)
        });

        if (!metaResponse.ok) {
            const errText = await metaResponse.text();
            throw new Error(`Failed to update metadata ${path}: ${metaResponse.status} ${errText}`);
        }

        // We usually need to fetch it one more time to get full metadata like md5Checksum
        const finalMeta = await this.fetchWithAuth(`${this.driveApiBase}/${uploadedFileId}?fields=id,name,mimeType,modifiedTime,size,md5Checksum`);
        const finalMetaData = await finalMeta.json();

        return {
            id: finalMetaData.id,
            name: finalMetaData.name,
            mimeType: finalMetaData.mimeType,
            modifiedTime: new Date(finalMetaData.modifiedTime).getTime(),
            size: parseInt(finalMetaData.size || '0', 10),
            md5Checksum: finalMetaData.md5Checksum
        };
    }

    public async delete(path: string): Promise<void> {
        const fileId = await this.resolvePathToId(path);
        if (!fileId) return; // File already gone

        const url = `${this.driveApiBase}/${fileId}`;
        const response = await this.fetchWithAuth(url, { method: 'DELETE' });

        if (!response.ok) {
            throw new Error(`Failed to delete file: ${path}`);
        }
    }

    public async mkdir(path: string): Promise<FileMeta> {
        const folderId = await this.resolvePathToId(path, true);
        if (!folderId) throw new Error(`Failed to create folder: ${path}`);

        // Just fetch it to return meta
        const response = await this.fetchWithAuth(`${this.driveApiBase}/${folderId}?fields=id,name,mimeType,modifiedTime,size`);
        const metadata = await response.json();

        return {
            id: metadata.id,
            name: metadata.name,
            mimeType: metadata.mimeType,
            modifiedTime: new Date(metadata.modifiedTime).getTime(),
            size: parseInt(metadata.size || '0', 10)
        };
    }
}
