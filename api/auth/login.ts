import { createSessionToken, getSessionCookie, isAuthEnabled, validateCredentials } from './_shared';

export const runtime = 'nodejs';

export async function POST(request: Request) {
    try {
        if (!isAuthEnabled()) {
            return Response.json({
                enabled: false,
                authenticated: true,
                username: null,
            });
        }

        let body: any = null;
        try {
            body = await request.json();
        } catch {
            body = null;
        }

        const username = typeof body?.username === 'string' ? body.username.trim() : '';
        const password = typeof body?.password === 'string' ? body.password : '';

        if (!validateCredentials(username, password)) {
            return Response.json({ message: '账号或密码错误。' }, { status: 401 });
        }

        const token = createSessionToken(username);
        const response = Response.json({
            enabled: true,
            authenticated: true,
            username,
        });
        response.headers.set('Set-Cookie', getSessionCookie(token));
        return response;
    } catch (error) {
        return Response.json(
            {
                message: error instanceof Error ? error.message : 'login handler failed',
            },
            { status: 500 },
        );
    }
}

export async function GET() {
    return Response.json({ message: 'Method not allowed' }, { status: 405 });
}
