import { App, PluginSettingTab, Setting, Notice } from 'obsidian';
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
    }
}
