import { getLogoutCookie } from './_shared';

export const runtime = 'nodejs';

export async function POST() {
    try {
        const response = Response.json({ ok: true });
        response.headers.set('Set-Cookie', getLogoutCookie());
        return response;
    } catch (error) {
        return Response.json(
            {
                ok: false,
                message: error instanceof Error ? error.message : 'logout handler failed',
            },
            { status: 500 },
        );
    }
}

export async function GET() {
    return Response.json({ message: 'Method not allowed' }, { status: 405 });
}
