import { App, PluginSettingTab, Setting, Notice, TFolder, TAbstractFile, TFile } from 'obsidian';
import ObsidianGDriveSyncPlugin from '../main';

export class ObsidianGDriveSyncSettingTab extends PluginSettingTab {
    plugin: ObsidianGDriveSyncPlugin;

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
                    scope: 'https://www.googleapis.com/auth/drive',
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

        new Setting(containerEl)
            .setName('Push to Google Drive')
            .setDesc('Upload local changes to Google Drive.')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.pushEnabled)
                .onChange(async (value) => {
                    this.plugin.settings.pushEnabled = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('Pull from Google Drive')
            .setDesc('Download remote changes from Google Drive.')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.pullEnabled)
                .onChange(async (value) => {
                    this.plugin.settings.pullEnabled = value;
                    await this.plugin.saveSettings();
                }));

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

        containerEl.createEl('h3', { text: 'Selective Sync' });
        containerEl.createEl('p', { text: 'Uncheck items to exclude them from syncing. New files and folders are synced by default.' });

        const treeContainer = containerEl.createDiv('sync-tree-container');
        treeContainer.style.border = '1px solid var(--background-modifier-border)';
        treeContainer.style.borderRadius = '4px';
        treeContainer.style.padding = '10px';
        treeContainer.style.maxHeight = '400px';
        treeContainer.style.overflowY = 'auto';
        treeContainer.style.backgroundColor = 'var(--background-secondary)';

        this.renderTree(this.app.vault.getRoot(), treeContainer, 0);
    }

    private renderTree(folder: TFolder, container: HTMLElement, depth: number) {
        // Sort: folders first, then files
        const children = folder.children.slice().sort((a, b) => {
            if (a instanceof TFolder && b instanceof TFile) return -1;
            if (a instanceof TFile && b instanceof TFolder) return 1;
            return a.name.localeCompare(b.name);
        });

        for (const child of children) {
            // Skip hidden obsidian folder
            if (child.path.startsWith('.obsidian') || child.path === '.obsidian-gdrive-sync.json') continue;

            const itemDiv = container.createDiv('sync-tree-item');
            itemDiv.style.marginLeft = `${depth * 20}px`;
            itemDiv.style.display = 'flex';
            itemDiv.style.alignItems = 'center';
            itemDiv.style.marginBottom = '4px';

            const checkbox = itemDiv.createEl('input', { type: 'checkbox' });

            // It is checked if it is NOT in the ignored list
            const isIgnored = this.plugin.settings.ignoredPaths.includes(child.path);
            checkbox.checked = !isIgnored;

            // If a parent is ignored, we might want to visually disable this checkbox or auto-uncheck it
            const isParentIgnored = this.plugin.settings.ignoredPaths.some(p => child.path.startsWith(p + '/'));
            if (isParentIgnored) {
                checkbox.checked = false;
                checkbox.disabled = true;
            }

            checkbox.addEventListener('change', async (e) => {
                const checked = (e.target as HTMLInputElement).checked;

                if (checked) {
                    // Remove from ignoredPaths
                    this.plugin.settings.ignoredPaths = this.plugin.settings.ignoredPaths.filter(p => p !== child.path);

                    // Also remove any children that were explicitly ignored
                    if (child instanceof TFolder) {
                        this.plugin.settings.ignoredPaths = this.plugin.settings.ignoredPaths.filter(p => !p.startsWith(child.path + '/'));
                    }
                } else {
                    // Add to ignoredPaths
                    if (!this.plugin.settings.ignoredPaths.includes(child.path)) {
                        this.plugin.settings.ignoredPaths.push(child.path);
                    }
                }

                await this.plugin.saveSettings();

                // Re-render tree to update disabled states for children
                const treeContainer = container.closest('.sync-tree-container');
                if (treeContainer) {
                    treeContainer.empty();
                    this.renderTree(this.app.vault.getRoot(), treeContainer as HTMLElement, 0);
                }
            });

            const icon = itemDiv.createSpan();
            icon.textContent = child instanceof TFolder ? '📁 ' : '📄 ';
            icon.style.marginRight = '5px';
            icon.style.opacity = isParentIgnored ? '0.5' : '1';

            const label = itemDiv.createSpan({ text: child.name });
            label.style.opacity = (isIgnored || isParentIgnored) ? '0.5' : '1';
            if (isIgnored || isParentIgnored) {
                label.style.textDecoration = 'line-through';
            }

            if (child instanceof TFolder) {
                this.renderTree(child, container, depth + 1);
            }
        }
    }
}
