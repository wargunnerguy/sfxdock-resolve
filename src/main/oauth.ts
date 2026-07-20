// OAuth2 authorization-code flow with a loopback redirect (RFC 8252 style).
// Freesound redirects to the app credential's registered Callback URL
// (http://localhost:<port>/callback), which a short-lived local server catches.
// Tokens are persisted encrypted via token-store.

import http from 'node:http';
import crypto from 'node:crypto';
import { shell } from 'electron';
import { clearTokens, loadTokens, saveTokens, type StoredTokens } from './token-store';

export interface OAuthConfig {
    providerId: string;
    clientId: string;
    clientSecret: string;
    authorizeUrl: string;
    tokenUrl: string;
    redirectPort: number;
    redirectPath: string;
}

interface TokenResponse {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    error?: string;
    error_description?: string;
}

const CONNECT_TIMEOUT_MS = 5 * 60 * 1000;
// Refresh a bit early so a download never races the 24h expiry.
const REFRESH_SKEW_MS = 60 * 1000;

export class OAuthManager {
    isConnected(providerId: string): boolean {
        return loadTokens(providerId) !== null;
    }

    disconnect(providerId: string): void {
        clearTokens(providerId);
    }

    /** Runs the full browser authorization flow and stores the resulting tokens. */
    async connect(config: OAuthConfig): Promise<void> {
        if (!config.clientId || !config.clientSecret) {
            throw new Error('Freesound Client ID and API key must both be set first.');
        }
        const state = crypto.randomBytes(16).toString('hex');
        const code = await this.awaitAuthCode(config, state);
        const tokens = await this.exchange(config, {
            grant_type: 'authorization_code',
            code,
        });
        saveTokens(config.providerId, tokens);
    }

    /** Returns a valid access token, refreshing if it is expired/near expiry. */
    async getAccessToken(config: OAuthConfig): Promise<string | null> {
        const stored = loadTokens(config.providerId);
        if (!stored) return null;
        if (Date.now() < stored.expiresAt - REFRESH_SKEW_MS) return stored.accessToken;
        try {
            const refreshed = await this.exchange(config, {
                grant_type: 'refresh_token',
                refresh_token: stored.refreshToken,
            });
            saveTokens(config.providerId, refreshed);
            return refreshed.accessToken;
        } catch {
            return null; // refresh failed — caller treats as not connected
        }
    }

    private awaitAuthCode(config: OAuthConfig, state: string): Promise<string> {
        return new Promise((resolve, reject) => {
            const server = http.createServer((req, res) => {
                const url = new URL(req.url ?? '/', `http://localhost:${config.redirectPort}`);
                if (url.pathname !== config.redirectPath) {
                    res.writeHead(404).end();
                    return;
                }
                const code = url.searchParams.get('code');
                const returnedState = url.searchParams.get('state');
                res.writeHead(200, { 'Content-Type': 'text/html' });
                if (code && returnedState === state) {
                    res.end(successPage());
                    cleanup();
                    resolve(code);
                } else {
                    res.end(errorPage());
                    cleanup();
                    reject(new Error('Authorization was denied or the state did not match.'));
                }
            });

            const timer = setTimeout(() => {
                cleanup();
                reject(new Error('Timed out waiting for Freesound authorization.'));
            }, CONNECT_TIMEOUT_MS);
            timer.unref?.();

            function cleanup() {
                clearTimeout(timer);
                server.close();
            }

            server.on('error', (e) => {
                clearTimeout(timer);
                reject(new Error(`Could not start the local callback server on port ${config.redirectPort}: ${e.message}`));
            });

            server.listen(config.redirectPort, '127.0.0.1', () => {
                const authUrl = new URL(config.authorizeUrl);
                authUrl.searchParams.set('client_id', config.clientId);
                authUrl.searchParams.set('response_type', 'code');
                authUrl.searchParams.set('state', state);
                void shell.openExternal(authUrl.toString());
            });
        });
    }

    private async exchange(config: OAuthConfig, grant: Record<string, string>): Promise<StoredTokens> {
        const body = new URLSearchParams({
            client_id: config.clientId,
            client_secret: config.clientSecret,
            ...grant,
        });
        const resp = await fetch(config.tokenUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: body.toString(),
        });
        const data = (await resp.json().catch(() => ({}))) as TokenResponse;
        if (!resp.ok || !data.access_token || !data.refresh_token) {
            throw new Error(data.error_description || data.error || `Token request failed (HTTP ${resp.status})`);
        }
        return {
            accessToken: data.access_token,
            refreshToken: data.refresh_token,
            expiresAt: Date.now() + (data.expires_in ?? 86400) * 1000,
        };
    }
}

function successPage(): string {
    return `<!doctype html><meta charset="utf-8"><title>SFXDock</title>
<body style="font-family:system-ui;background:#1e1e1e;color:#ddd;text-align:center;padding-top:80px">
<h2>SFXDock is connected to Freesound ✓</h2><p>You can close this tab and return to Resolve.</p></body>`;
}

function errorPage(): string {
    return `<!doctype html><meta charset="utf-8"><title>SFXDock</title>
<body style="font-family:system-ui;background:#1e1e1e;color:#ddd;text-align:center;padding-top:80px">
<h2>Authorization failed</h2><p>Please return to SFXDock and try connecting again.</p></body>`;
}
