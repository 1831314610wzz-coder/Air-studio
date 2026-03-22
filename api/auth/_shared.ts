import { createHmac } from 'node:crypto';

type AuthUser = {
    username: string;
    password: string;
};

export type SessionPayload = {
    username: string;
    issuedAt: number;
};

const COOKIE_NAME = 'airstudio_session';
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 7;

function getSessionSecret(): string {
    return process.env.AIRSTUDIO_AUTH_SESSION_SECRET || 'change-me-in-vercel';
}

function parseUsersFromEnv(): AuthUser[] {
    const rawList = (process.env.AIRSTUDIO_AUTH_USERS || '').trim();
    if (rawList) {
        return rawList
            .split(',')
            .map(chunk => chunk.trim())
            .filter(Boolean)
            .map(chunk => {
                const separatorIndex = chunk.indexOf(':');
                if (separatorIndex === -1) return null;
                const username = chunk.slice(0, separatorIndex).trim();
                const password = chunk.slice(separatorIndex + 1).trim();
                if (!username || !password) return null;
                return { username, password };
            })
            .filter((item): item is AuthUser => !!item);
    }

    const username = (process.env.AIRSTUDIO_AUTH_USERNAME || '').trim();
    const password = (process.env.AIRSTUDIO_AUTH_PASSWORD || '').trim();
    if (!username || !password) return [];
    return [{ username, password }];
}

export function isAuthEnabled(): boolean {
    return parseUsersFromEnv().length > 0;
}

export function validateCredentials(username: string, password: string): boolean {
    const users = parseUsersFromEnv();
    return users.some(user => user.username === username && user.password === password);
}

function sign(value: string): string {
    return createHmac('sha256', getSessionSecret()).update(value).digest('hex');
}

export function createSessionToken(username: string): string {
    const issuedAt = Date.now();
    const base = `${username}.${issuedAt}`;
    return `${base}.${sign(base)}`;
}

export function parseSessionToken(token?: string | null): SessionPayload | null {
    if (!token) return null;
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const [username, issuedAtRaw, signature] = parts;
    if (!username || !issuedAtRaw || !signature) return null;
    const issuedAt = Number(issuedAtRaw);
    if (!Number.isFinite(issuedAt)) return null;
    const base = `${username}.${issuedAtRaw}`;
    const expected = sign(base);
    if (expected !== signature) return null;
    if (Date.now() - issuedAt > SESSION_MAX_AGE_SECONDS * 1000) return null;
    return { username, issuedAt };
}

export function getCookieName(): string {
    return COOKIE_NAME;
}

export function getSessionCookie(token: string): string {
    return `${COOKIE_NAME}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_MAX_AGE_SECONDS}; Secure`;
}

export function getLogoutCookie(): string {
    return `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0; Secure`;
}

export function getSessionFromCookieHeader(cookieHeader?: string): SessionPayload | null {
    if (!cookieHeader) return null;
    const match = cookieHeader
        .split(';')
        .map(part => part.trim())
        .find(part => part.startsWith(`${COOKIE_NAME}=`));
    const token = match?.slice(COOKIE_NAME.length + 1) || null;
    return parseSessionToken(token);
}
