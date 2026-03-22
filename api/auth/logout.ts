import { getLogoutCookie } from './_shared';

export default function handler(_req: any, res: any) {
    res.setHeader('Set-Cookie', getLogoutCookie());
    return res.status(200).json({ ok: true });
}
