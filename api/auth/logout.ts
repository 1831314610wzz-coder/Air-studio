const COOKIE_NAME = 'airstudio_user';

export default function handler(_req: any, res: any) {
    try {
        res.setHeader('Set-Cookie', `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0; Secure`);
        return res.status(200).json({ ok: true });
    } catch (error) {
        return res.status(500).json({
            ok: false,
            message: error instanceof Error ? error.message : 'logout handler failed',
        });
    }
}
