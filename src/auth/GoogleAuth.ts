import { importPKCS8, SignJWT } from 'jose';

import { ObsidianGDriveSyncSettings } from '../types';

export class GoogleAuth {
    constructor(
        private readonly settings: ObsidianGDriveSyncSettings,
        private readonly saveSettings: () => Promise<void>
    ) { }

    public async getAccessToken(): Promise<string> {
        if (this.settings.accessToken && Date.now() < this.settings.accessTokenExpiry) {
            return this.settings.accessToken;
        }

        if (this.settings.authMode === 'oauth') {
            await this.refreshOAuthToken();
        } else if (this.settings.authMode === 'service-account') {
            await this.getServiceAccountToken();
        } else {
            throw new Error('Invalid authentication mode');
        }

        if (!this.settings.accessToken) {
            throw new Error('Failed to obtain access token');
        }

        return this.settings.accessToken;
    }

    private async refreshOAuthToken(): Promise<void> {
        if (!this.settings.refreshToken) {
            throw new Error('No refresh token available. Please log in first.');
        }
        if (!this.settings.clientId || !this.settings.clientSecret) {
            throw new Error('Client ID and Secret are missing.');
        }

        const response = await fetch('https://oauth2.googleapis.com/token', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
            },
            body: new URLSearchParams({
                client_id: this.settings.clientId,
                client_secret: this.settings.clientSecret,
                refresh_token: this.settings.refreshToken,
                grant_type: 'refresh_token',
            }),
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Failed to refresh OAuth token: ${response.status} ${errorText}`);
        }

        const data = await response.json();
        this.settings.accessToken = data.access_token;
        // Subtract 60 seconds from expiry
        this.settings.accessTokenExpiry = Date.now() + (data.expires_in - 60) * 1000;
        await this.saveSettings();
    }

    private async getServiceAccountToken(): Promise<void> {
        if (!this.settings.serviceAccountJson) {
            throw new Error('Service Account JSON is missing');
        }

        let credentials;
        try {
            credentials = JSON.parse(this.settings.serviceAccountJson);
        } catch (e) {
            throw new Error('Invalid Service Account JSON format');
        }

        const { client_email, private_key, token_uri } = credentials;
        if (!client_email || !private_key || !token_uri) {
            throw new Error('Missing required fields in Service Account JSON');
        }

        const scope = 'https://www.googleapis.com/auth/drive';

        // 1. Create JWT
        const privateKeyObj = await importPKCS8(private_key, 'RS256');

        const jwt = await new SignJWT({
            iss: client_email,
            scope: scope,
            aud: token_uri,
        })
            .setProtectedHeader({ alg: 'RS256', typ: 'JWT' })
            .setIssuedAt()
            .setExpirationTime('1h')
            .sign(privateKeyObj);

        // 2. Request token
        const response = await fetch(token_uri, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
            },
            body: new URLSearchParams({
                grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
                assertion: jwt,
            }),
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Failed to get Service Account token: ${response.status} ${errorText}`);
        }

        const data = await response.json();
        this.settings.accessToken = data.access_token;
        this.settings.accessTokenExpiry = Date.now() + (data.expires_in - 60) * 1000;
        await this.saveSettings();
    }
}
