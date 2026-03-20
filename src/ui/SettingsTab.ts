import { App, PluginSettingTab, Setting, Notice, TFolder, TAbstractFile, TFile, setIcon } from 'obsidian';
import ObsidianGDriveSyncPlugin from '../main';
import { FileMeta } from '../types';

interface VirtualNode {
    name: string;
    path: string;
    isLocal: boolean;
    isRemote: boolean;
    isFolder: boolean;
    children: Map<string, VirtualNode>;
}

export class ObsidianGDriveSyncSettingTab extends PluginSettingTab {
    plugin: ObsidianGDriveSyncPlugin;
    private remoteFiles: Map<string, FileMeta> = new Map();
    private isFetchingRemote = false;
    private expandedPaths: Set<string> = new Set();

    constructor(app: App, plugin: ObsidianGDriveSyncPlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display(): void {
        const { containerEl } = this;

        containerEl.empty();

        containerEl.createEl('h2', { text: 'Google Drive Sync Settings' });

        new Setting(containerEl)
            .setName('Drive Root Folder ID')
            .setDesc('The ID of the folder in Google Drive to sync with.')
            .addText(text => text
                .setPlaceholder('e.g., 1A2b3C4d5E6f...')
                .setValue(this.plugin.settings.driveFolderId)
                .onChange(async (value) => {
                    this.plugin.settings.driveFolderId = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('Authentication Mode')
            .setDesc('Choose between Google OAuth (Personal) or Service Account JSON (Agents).')
            .addDropdown(drop => drop
                .addOption('oauth', 'Google OAuth2')
                .addOption('service-account', 'Service Account')
                .setValue(this.plugin.settings.authMode)
                .onChange(async (value: 'oauth' | 'service-account') => {
                    this.plugin.settings.authMode = value;
                    await this.plugin.saveSettings();
                    this.display(); // Refresh to show/hide relevant fields
                }));

        if (this.plugin.settings.authMode === 'oauth') {
            new Setting(containerEl)
                .setName('1. Google Client ID')
                .setDesc('Create an OAuth Client ID (Desktop type) in Google Cloud Console.')
                .addText(text => text
                    .setPlaceholder('xxx.apps.googleusercontent.com')
                    .setValue(this.plugin.settings.clientId)
                    .onChange(async (value) => {
                        this.plugin.settings.clientId = value;
                        await this.plugin.saveSettings();
                        this.display(); // Re-render to update the auth link
                    }));

            new Setting(containerEl)
                .setName('2. Google Client Secret')
                .setDesc('Your Google Console Client Secret.')
                .addText(text => {
                    text
                        .setPlaceholder('GOCSPX-...')
                        .setValue(this.plugin.settings.clientSecret)
                        .onChange(async (value) => {
                            this.plugin.settings.clientSecret = value;
                            await this.plugin.saveSettings();
                            this.display();
                        });
                    text.inputEl.type = 'password';
                    return text;
                });

            // Generate authorization link dynamically if secrets exist
            if (this.plugin.settings.clientId && this.plugin.settings.clientSecret) {
                const params = new URLSearchParams({
                    client_id: this.plugin.settings.clientId,
                    redirect_uri: 'http://localhost',
                    response_type: 'code',
                    scope: 'https://www.googleapis.com/auth/drive.file',
                    access_type: 'offline',
                    prompt: 'consent' // Force refresh token generation
                });

                const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;

                const authLink = containerEl.createEl('a', { text: '3. Click here to login to Google Drive in your browser' }) as HTMLAnchorElement;
                authLink.href = authUrl;
                authLink.target = '_blank';
                containerEl.createEl('br');
                containerEl.createEl('small', { text: 'Your browser will show an "Unable to connect" error at localhost. This is expected!' });

                new Setting(containerEl)
                    .setName('4. Paste Error URL here')
                    .setDesc('Copy the URL from the browser error page (http://localhost/?code=...) and paste it here.')
                    .addText(text => text
                        .setPlaceholder('http://localhost/?code=XXX')
                        .onChange(async (value) => {
                            if (!value) return;
                            try {
                                const url = new URL(value);
                                const code = url.searchParams.get('code');
                                if (code) {
                                    // Exchange code for tokens
                                    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
                                        method: 'POST',
                                        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                                        body: new URLSearchParams({
                                            code,
                                            client_id: this.plugin.settings.clientId,
                                            client_secret: this.plugin.settings.clientSecret,
                                            redirect_uri: 'http://localhost',
                                            grant_type: 'authorization_code'
                                        })
                                    });

                                    if (!tokenResponse.ok) throw new Error('Failed to exchange code');
                                    const tokenData = await tokenResponse.json();

                                    this.plugin.settings.accessToken = tokenData.access_token;
                                    this.plugin.settings.refreshToken = tokenData.refresh_token; // Crucial for long-term sync
                                    this.plugin.settings.accessTokenExpiry = Date.now() + (tokenData.expires_in - 60) * 1000;

                                    await this.plugin.saveSettings();

                                    // Clear input
                                    text.setValue('');
                                    new Notice('Successfully authenticated with Google Drive!');
                                    this.display(); // Refresh to hide error URL pasting if we wanted to
                                } else {
                                    new Notice('No authorization code found in the URL. Did you copy the whole URL?');
                                }
                            } catch (e) {
                                new Notice('Invalid URL format');
                            }
                        }));
            }

            if (this.plugin.settings.refreshToken) {
                containerEl.createEl('p', { text: '✅ Authorized securely with Google OAuth.' }).style.color = 'var(--text-accent)';
            }
            new Setting(containerEl)
        } else if (this.plugin.settings.authMode === 'service-account') {
            new Setting(containerEl)
                .setName('Service Account JSON')
                .setDesc('Paste the raw JSON content of your Google Service Account key.')
                .addTextArea(text => {
                    text
                        .setPlaceholder(this.plugin.settings.serviceAccountJson ? '(Service Account JSON is configured. Paste here to overwrite)' : '{"type": "service_account", ...}')
                        .onChange(async (value) => {
                            if (value.trim().length > 0) {
                                this.plugin.settings.serviceAccountJson = value;
                                await this.plugin.saveSettings();
                            }
                        });
                    return text;
                });
        }

        new Setting(containerEl)
            .setName('Sync Mode')
            .setDesc('When should the plugin trigger a sync?')
            .addDropdown(drop => drop
                .addOption('manual', 'Manual Only')
                .addOption('onOpenClose', 'On Open & Close')
                .addOption('interval', 'Interval')
                .setValue(this.plugin.settings.syncMode)
                .onChange(async (value: any) => {
                    this.plugin.settings.syncMode = value;
                    await this.plugin.saveSettings();
                    this.plugin.configureInterval();
                    this.display();
                }));

        if (this.plugin.settings.syncMode === 'interval') {
            new Setting(containerEl)
                .setName('Sync Interval (Minutes)')
                .setDesc('How often should the vault sync (10-60m)?')
                .addText(text => text
                    .setPlaceholder('30')
                    .setValue(String(this.plugin.settings.syncIntervalMinutes))
                    .onChange(async (value) => {
                        const num = parseInt(value, 10);
                        if (!isNaN(num) && num >= 1 && num <= 1440) {
                            this.plugin.settings.syncIntervalMinutes = num;
                            await this.plugin.saveSettings();
                            this.plugin.configureInterval();
                        }
                    }));
        }

        containerEl.createEl('h3', { text: 'Sync Rules (for Agents & Partial Sync)' });
        containerEl.createEl('p', { text: 'Format: localPattern|driveFolderId|direction (e.g. Agents/AgentA/**|xyz123|download-only)' });

        // A simple text area for rules to keep MVP fast, normally we'd build a list UI
        const rulesString = this.plugin.settings.syncRules.map(r => `${r.localPattern}|${r.driveFolderId}|${r.direction}`).join('\\n');

        new Setting(containerEl)
            .setName('Rules List')
            .setDesc('One strictly per line.')
            .addTextArea(text => text
                .setPlaceholder('Agents/AgentA/**|folderId123|download-only\\n**|rootFolderId|two-way')
                .setValue(rulesString)
                .onChange(async (value) => {
                    const lines = value.split('\\n').filter(l => l.trim().length > 0);
                    this.plugin.settings.syncRules = lines.map(line => {
                        const [localPattern, driveFolderId, direction] = line.split('|') as [string, string, string];
                        return {
                            localPattern: localPattern || '',
                            driveFolderId: driveFolderId || '',
                            direction: (direction as 'two-way' | 'download-only') || 'two-way'
                        };
                    });
                    await this.plugin.saveSettings();
                }));

        containerEl.createEl('h3', { text: 'Selective Sync & Actions' });
        
        const actionRow = containerEl.createDiv();
        actionRow.style.display = 'flex';
        actionRow.style.gap = '10px';
        actionRow.style.marginBottom = '10px';

        const refreshBtn = actionRow.createEl('button', { text: this.isFetchingRemote ? 'Fetching...' : 'Refresh Remote View' });
        refreshBtn.disabled = this.isFetchingRemote;
        refreshBtn.onclick = async () => {
            this.isFetchingRemote = true;
            this.display();
            try {
                this.remoteFiles = await this.plugin.syncEngine!.fetchRemoteState();
                new Notice('Remote state refreshed.');
            } catch (e) {
                new Notice('Failed to fetch remote state.');
            } finally {
                this.isFetchingRemote = false;
                this.display();
            }
        };

        const pushAllBtn = actionRow.createEl('button', { cls: 'mod-cta' });
        setIcon(pushAllBtn, 'upload-cloud');
        pushAllBtn.createSpan({ text: ' Push All' });
        pushAllBtn.onclick = () => this.plugin.runPush();

        const pullAllBtn = actionRow.createEl('button', { cls: 'mod-cta' });
        setIcon(pullAllBtn, 'download-cloud');
        pullAllBtn.createSpan({ text: ' Pull All' });
        pullAllBtn.onclick = () => this.plugin.runPull();

        containerEl.createEl('p', { text: 'Uncheck items to exclude them from automatic sync. Use ↑/↓ icons for immediate manual sync.' });

        const treeContainer = containerEl.createDiv('sync-tree-container');
        treeContainer.style.border = '1px solid var(--background-modifier-border)';
        treeContainer.style.borderRadius = '4px';
        treeContainer.style.padding = '10px';
        treeContainer.style.maxHeight = '500px';
        treeContainer.style.overflowY = 'auto';
        treeContainer.style.backgroundColor = 'var(--background-secondary)';

        this.renderHybridTree(treeContainer);

        // Auto-fetch remote files if authenticated and not already loaded
        if (this.remoteFiles.size === 0 && !this.isFetchingRemote && this.plugin.syncEngine) {
            this.isFetchingRemote = true;
            this.plugin.syncEngine.fetchRemoteState().then((remote) => {
                this.remoteFiles = remote;
                this.isFetchingRemote = false;
                this.display(); // Re-render with remote files visible
            }).catch(() => {
                this.isFetchingRemote = false;
            });
        }
    }

    private renderHybridTree(container: HTMLElement) {
        // Build the virtual tree
        const root: VirtualNode = { name: '/', path: '', isLocal: true, isRemote: true, isFolder: true, children: new Map() };
        
        // Add Local Files
        const localFiles = this.app.vault.getAllLoadedFiles();
        for (const file of localFiles) {
            if (file.path === '/' || file.path.startsWith('.obsidian')) continue;
            this.addToVirtualTree(root, file.path, true, false, file instanceof TFolder);
        }

        // Add Remote Files
        for (const [path, meta] of this.remoteFiles.entries()) {
            this.addToVirtualTree(root, path, false, true, meta.mimeType === 'application/vnd.google-apps.folder');
        }

        // Render recursively starting from children of root
        const sortedChildren = Array.from(root.children.values()).sort((a, b) => {
            if (a.isFolder && !b.isFolder) return -1;
            if (!a.isFolder && b.isFolder) return 1;
            return a.name.localeCompare(b.name);
        });

        for (const child of sortedChildren) {
            this.renderVirtualNode(child, container, 0);
        }
    }

    private addToVirtualTree(root: VirtualNode, path: string, isLocal: boolean, isRemote: boolean, isFolder: boolean) {
        const parts = path.split('/').filter(p => p.length > 0);
        let current = root;
        for (let i = 0; i < parts.length; i++) {
            const part = parts[i]!;
            const currentPath = parts.slice(0, i + 1).join('/');
            const isLast = i === parts.length - 1;
            
            let node = current.children.get(part);
            if (!node) {
                node = {
                    name: part,
                    path: currentPath,
                    isLocal: isLast ? isLocal : false,
                    isRemote: isLast ? isRemote : false,
                    isFolder: isLast ? isFolder : true,
                    children: new Map()
                };
                current.children.set(part, node);
            } else if (isLast) {
                node.isLocal = node.isLocal || isLocal;
                node.isRemote = node.isRemote || isRemote;
                node.isFolder = node.isFolder || isFolder;
            }
            current = node;
        }
    }

    private renderVirtualNode(node: VirtualNode, container: HTMLElement, depth: number) {
        if (!node || !node.path) return;
        if (node.path.startsWith('.obsidian') || node.path === '.obsidian-gdrive-sync.json') return;

        const isIgnored = this.plugin.settings.ignoredPaths.includes(node.path);
        const isParentIgnored = this.plugin.settings.ignoredPaths.some(p => node.path.startsWith(p + '/'));

        const createItemRow = (parentEl: HTMLElement) => {
            const row = parentEl.createDiv('sync-tree-row');
            row.style.display = 'flex';
            row.style.alignItems = 'center';
            row.style.width = '100%';
            row.style.gap = '5px';

            const checkbox = row.createEl('input', { type: 'checkbox' });
            checkbox.checked = !isIgnored;
            if (isParentIgnored) {
                checkbox.checked = false;
                checkbox.disabled = true;
            }

            checkbox.addEventListener('click', (e) => e.stopPropagation());
            checkbox.addEventListener('change', async (e) => {
                const checked = (e.target as HTMLInputElement).checked;
                if (checked) {
                    this.plugin.settings.ignoredPaths = this.plugin.settings.ignoredPaths.filter(p => p !== node.path);
                    if (node.isFolder) {
                        this.plugin.settings.ignoredPaths = this.plugin.settings.ignoredPaths.filter(p => !p.startsWith(node.path + '/'));
                        this.expandedPaths.add(node.path);
                    }
                } else {
                    if (!this.plugin.settings.ignoredPaths.includes(node.path)) {
                        this.plugin.settings.ignoredPaths.push(node.path);
                    }
                    if (node.isFolder) {
                        this.expandedPaths.delete(node.path);
                    }
                }
                await this.plugin.saveSettings();
                this.display(); 
            });

            const icon = row.createSpan({ text: node.isFolder ? '📁 ' : '📄 ' });
            const label = row.createSpan({ text: node.name });
            
            // Visual feedback for local/remote
            if (!node.isLocal) {
                label.style.color = 'var(--text-faint)';
                label.style.fontStyle = 'italic';
            } else if (!node.isRemote) {
                label.style.color = 'var(--text-accent)';
            }

            if (isIgnored || isParentIgnored) {
                label.style.textDecoration = 'line-through';
                label.style.opacity = '0.5';
            }

            // Action Buttons
            const actions = row.createDiv('sync-item-actions');
            actions.style.marginLeft = 'auto';
            actions.style.display = 'flex';
            actions.style.gap = '5px';

            if (node.isLocal) {
                const pushBtn = actions.createEl('button', { cls: 'clickable-icon' });
                setIcon(pushBtn, 'upload-cloud');
                pushBtn.title = 'Push to Drive';
                pushBtn.onclick = (e) => {
                    e.stopPropagation();
                    this.plugin.runPush(node.path);
                };
            }

            if (node.isRemote) {
                const pullBtn = actions.createEl('button', { cls: 'clickable-icon' });
                setIcon(pullBtn, 'download-cloud');
                pullBtn.title = 'Pull from Drive';
                pullBtn.onclick = (e) => {
                    e.stopPropagation();
                    this.plugin.runPull(node.path);
                };
            }

            return row;
        };

        if (node.isFolder) {
            const details = container.createEl('details');
            details.style.marginLeft = depth === 0 ? '0px' : '20px';
            details.style.marginBottom = '2px';

            const summary = details.createEl('summary');
            summary.style.display = 'flex';
            summary.style.alignItems = 'center';
            summary.style.cursor = 'pointer';
            summary.style.userSelect = 'none';

            createItemRow(summary);

            const renderChildren = () => {
                const childrenArr = Array.from(node.children.values()).sort((a, b) => {
                    if (a.isFolder && !b.isFolder) return -1;
                    if (!a.isFolder && b.isFolder) return 1;
                    return a.name.localeCompare(b.name);
                });
                for (const child of childrenArr) {
                    this.renderVirtualNode(child, details, depth + 1);
                }
            };

            details.open = this.expandedPaths.has(node.path);
            let rendered = false;

            if (details.open) {
                renderChildren();
                rendered = true;
            }

            details.addEventListener('toggle', () => {
                if (details.open) {
                    this.expandedPaths.add(node.path);
                    if (!rendered) {
                        rendered = true;
                        renderChildren();
                    }
                } else {
                    this.expandedPaths.delete(node.path);
                }
            });
        } else {
            const itemDiv = container.createDiv('sync-tree-item');
            itemDiv.style.marginLeft = depth === 0 ? '0px' : '20px';
            itemDiv.style.marginBottom = '2px';
            createItemRow(itemDiv);
        }
    }
}
