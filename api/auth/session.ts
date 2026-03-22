type AuthUser = {
    username: string;
    password: string;
};

const COOKIE_NAME = 'airstudio_user';

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

function isAuthEnabled(): boolean {
    return parseUsersFromEnv().length > 0;
}

function getUsernameFromCookie(cookieHeader?: string): string | null {
    if (!cookieHeader) return null;
    const match = cookieHeader
        .split(';')
        .map(part => part.trim())
        .find(part => part.startsWith(`${COOKIE_NAME}=`));
    const token = match?.slice(COOKIE_NAME.length + 1) || '';
    return token ? decodeURIComponent(token) : null;
}

export default function handler(req: any, res: any) {
    try {
        const enabled = isAuthEnabled();
        if (!enabled) {
            return res.status(200).json({
                enabled: false,
                authenticated: true,
                username: null,
            });
        }

        const username = getUsernameFromCookie(req.headers?.cookie);
        const authenticated = !!username && parseUsersFromEnv().some(user => user.username === username);

        return res.status(200).json({
            enabled: true,
            authenticated,
            username: authenticated ? username : null,
        });
    } catch (error) {
        return res.status(500).json({
            enabled: true,
            authenticated: false,
            username: null,
            message: error instanceof Error ? error.message : 'session handler failed',
        });
    }
}
