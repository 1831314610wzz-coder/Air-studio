type AuthUser = {
    username: string;
    password: string;
};

const COOKIE_NAME = 'airstudio_user';
const COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 7;

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

function validateCredentials(username: string, password: string): boolean {
    return parseUsersFromEnv().some(user => user.username === username && user.password === password);
}

function readBody(req: any): Promise<any> {
    return new Promise((resolve, reject) => {
        if (typeof req.body === 'object' && req.body) {
            resolve(req.body);
            return;
        }

        let raw = '';
        req.on('data', (chunk: Buffer | string) => {
            raw += chunk.toString();
        });
        req.on('end', () => {
            if (!raw) {
                resolve({});
                return;
            }
            try {
                resolve(JSON.parse(raw));
            } catch (error) {
                reject(error);
            }
        });
        req.on('error', reject);
    });
}

export default async function handler(req: any, res: any) {
    try {
        if (req.method !== 'POST') {
            return res.status(405).json({ message: 'Method not allowed' });
        }

        if (!isAuthEnabled()) {
            return res.status(200).json({
                enabled: false,
                authenticated: true,
                username: null,
            });
        }

        const body = await readBody(req);
        const username = typeof body?.username === 'string' ? body.username.trim() : '';
        const password = typeof body?.password === 'string' ? body.password : '';

        if (!validateCredentials(username, password)) {
            return res.status(401).json({ message: '账号或密码错误。' });
        }

        res.setHeader(
            'Set-Cookie',
            `${COOKIE_NAME}=${encodeURIComponent(username)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${COOKIE_MAX_AGE_SECONDS}; Secure`,
        );

        return res.status(200).json({
            enabled: true,
            authenticated: true,
            username,
        });
    } catch (error) {
        return res.status(500).json({
            message: error instanceof Error ? error.message : 'login handler failed',
        });
    }
}
