import { getLogoutCookie } from './_shared';

export const config = {
    runtime: 'nodejs',
};

export default function handler(_req: any, res: any) {
    try {
        res.setHeader('Set-Cookie', getLogoutCookie());
        return res.status(200).json({ ok: true });
    } catch (error) {
        return res.status(500).json({
            ok: false,
            message: error instanceof Error ? error.message : 'logout handler failed',
        });
    }
}
