import { getSessionFromCookieHeader, isAuthEnabled } from './_shared';

export const config = {
    runtime: 'nodejs',
};

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

        const session = getSessionFromCookieHeader(req.headers.cookie);
        return res.status(200).json({
            enabled: true,
            authenticated: !!session,
            username: session?.username || null,
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
