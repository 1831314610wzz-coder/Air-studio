import { getSessionFromCookieHeader, isAuthEnabled } from './_shared';

export const runtime = 'nodejs';

export async function GET(request: Request) {
    try {
        const enabled = isAuthEnabled();
        if (!enabled) {
            return Response.json({
                enabled: false,
                authenticated: true,
                username: null,
            });
        }

        const session = getSessionFromCookieHeader(request.headers.get('cookie') || undefined);
        return Response.json({
            enabled: true,
            authenticated: !!session,
            username: session?.username || null,
        });
    } catch (error) {
        return Response.json(
            {
                enabled: true,
                authenticated: false,
                username: null,
                message: error instanceof Error ? error.message : 'session handler failed',
            },
            { status: 500 },
        );
    }
}
