import { getSessionFromCookieHeader, isAuthEnabled } from './_shared';

export default function handler(req: any, res: any) {
    const enabled = isAuthEnabled();
    if (!enabled) {
        return res.status(200).json({
            enabled: false,
            authenticated: true,
            username: null,
        });
    }

    const session = getSessionFromCookieHeader(req.headers.cookie);
    return res.status(200).json({
        enabled: true,
        authenticated: !!session,
        username: session?.username || null,
    });
}
