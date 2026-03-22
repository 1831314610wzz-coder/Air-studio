import { createSessionToken, getSessionCookie, isAuthEnabled, validateCredentials } from './_shared';

export default function handler(req: any, res: any) {
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

    const { username, password } = typeof req.body === 'object' && req.body ? req.body : {};
    const normalizedUsername = typeof username === 'string' ? username.trim() : '';
    const normalizedPassword = typeof password === 'string' ? password : '';

    if (!validateCredentials(normalizedUsername, normalizedPassword)) {
        return res.status(401).json({ message: '账号或密码错误' });
    }

    const token = createSessionToken(normalizedUsername);
    res.setHeader('Set-Cookie', getSessionCookie(token));
    return res.status(200).json({
        enabled: true,
        authenticated: true,
        username: normalizedUsername,
    });
}
