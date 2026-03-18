import type { AIProvider, PromptEnhanceRequest, PromptEnhanceResult, UserApiKey } from '../types';
import { enhancePromptWithGemini, generateImageFromText, validateGeminiApiKey } from './geminiService';

/**
 * 閫氱敤 API Key 楠岃瘉 鈥?鏍规嵁 provider 璋冪敤瀵瑰簲鐨勯獙璇侀€昏緫
 */
export async function validateApiKey(provider: AIProvider, apiKey: string, baseUrl?: string): Promise<{ ok: boolean; message?: string }> {
    if (provider === 'google') {
        return validateGeminiApiKey(apiKey);
    }

    // OpenAI-compatible: 璋冪敤 /models 鎺ュ彛
    if (provider === 'openai' || provider === 'qwen') {
        try {
            const url = (baseUrl || DEFAULT_BASE_URLS[provider]).replace(/\/$/, '');
            const res = await fetch(`${url}/models`, {
                method: 'GET',
                headers: { Authorization: `Bearer ${apiKey}` },
            });
            if (res.ok) return { ok: true };
            const body = await res.json().catch(() => ({}));
            return { ok: false, message: body?.error?.message || `HTTP ${res.status}` };
        } catch (err) {
            return { ok: false, message: err instanceof Error ? err.message : '缃戠粶閿欒' };
        }
    }
    // custom provider may not expose /models.
    // Use lightweight validation to avoid false negatives at save time.
    if (provider === 'custom') {
        if (apiKey.trim().length < 10) return { ok: false, message: 'API Key too short' };
        return { ok: true, message: 'Saved (custom skipped /models online validation)' };
    }
    // Anthropic: 璋冪敤 /messages 浼氳繑鍥?401 濡傛灉 key 鏃犳晥
    if (provider === 'anthropic') {
        try {
            const url = (baseUrl || DEFAULT_BASE_URLS.anthropic).replace(/\/$/, '');
            const res = await fetch(`${url}/messages`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'x-api-key': apiKey,
                    'anthropic-version': '2023-06-01',
                },
                body: JSON.stringify({ model: 'claude-3-haiku-20240307', max_tokens: 1, messages: [{ role: 'user', content: 'hi' }] }),
            });
            if (res.ok || res.status === 200) return { ok: true };
            if (res.status === 401 || res.status === 403) return { ok: false, message: 'Invalid API key or insufficient permission' };
            return { ok: true }; // 鍏朵粬閿欒鍙兘鏄ā鍨嬩笉瀛樺湪锛屼絾 key 鏄鐨?
        } catch (err) {
            return { ok: false, message: err instanceof Error ? err.message : '缃戠粶閿欒' };
        }
    }

    // Stability / Banana: 绠€鍗曟牸寮忔牎楠?
    if (apiKey.length < 10) return { ok: false, message: 'API Key 澶煭' };
    return { ok: true, message: '宸蹭繚瀛橈紙鏍煎紡鏍￠獙閫氳繃锛屾湭鍋氬湪绾块獙璇侊級' };
}

const DEFAULT_BASE_URLS: Record<AIProvider, string> = {
    openai: 'https://api.openai.com/v1',
    anthropic: 'https://api.anthropic.com/v1',
    google: 'https://generativelanguage.googleapis.com/v1beta/models',
    stability: 'https://api.stability.ai/v1',
    qwen: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    banana: 'https://api.banana.dev/v1/vision',
    custom: '',
};

function getBaseUrl(provider: AIProvider, key?: UserApiKey) {
    return (key?.baseUrl || DEFAULT_BASE_URLS[provider]).replace(/\/$/, '');
}

function requireApiKey(provider: AIProvider, key?: UserApiKey) {
    if (!key?.key) {
        throw new Error('Missing ' + provider + ' API key. Please add it in Settings first.');
    }
    return key.key;
}

function isArkCustomEndpoint(key?: UserApiKey): boolean {
    const base = (key?.baseUrl || '').toLowerCase();
    return base.includes('ark.cn-beijing.volces.com');
}

function isApiyiCustomEndpoint(key?: UserApiKey): boolean {
    const base = (key?.baseUrl || '').toLowerCase();
    return base.includes('api.apiyi.com');
}

function getApiyiOrigin(baseUrl: string): string {
    const trimmed = baseUrl.replace(/\/$/, '');
    return trimmed.replace(/\/v1(?:beta)?$/i, '');
}

function mapToApiyiNativeModel(model: string): string {
    const lower = model.trim().toLowerCase();
    if (lower === 'nano-banana') return 'gemini-2.5-flash-image';
    if (lower === 'nano-banana-2') return 'gemini-2.5-flash-image';
    if (lower === 'nano-banana-pro') return 'gemini-3-pro-image-preview';
    return model;
}

function mapResolutionToApiyiImageSize(resolutionOrSize?: string): '1K' | '2K' | '4K' {
    const raw = (resolutionOrSize || '').trim().toUpperCase();
    if (raw === '1K' || raw === '2K' || raw === '4K') return raw;
    const matched = raw.match(/^(\d+)X(\d+)$/);
    if (matched) {
        const maxSide = Math.max(Number(matched[1]), Number(matched[2]));
        if (maxSide <= 1024) return '1K';
        if (maxSide <= 2048) return '2K';
        return '4K';
    }
    return '1K';
}

function normalizeApiyiAspectRatio(aspectRatio?: string): string {
    const allowed = new Set(['21:9', '16:9', '4:3', '3:2', '1:1', '9:16', '3:4', '2:3', '5:4', '4:5']);
    const ratio = (aspectRatio || '1:1').trim();
    return allowed.has(ratio) ? ratio : '1:1';
}

function parseArkAllowedSizesFromEnv(): string[] {
    const raw = (import.meta.env.VITE_ARK_IMAGE_ALLOWED_SIZES || '').trim();
    if (!raw) {
        // Keep defaults constrained to common ARK-supported sizes above min pixel threshold.
        return ['2048x2048', '2560x1440', '1440x2560', '2304x1536', '1536x2304', '2K'];
    }
    return raw
        .split(',')
        .map(item => item.trim())
        .filter(Boolean);
}

function parseSizeToken(size: string): { width: number; height: number } | null {
    const match = size.match(/^(\d+)x(\d+)$/i);
    if (!match) return null;
    const width = Number(match[1]);
    const height = Number(match[2]);
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null;
    return { width, height };
}

function pickClosestArkSize(size: string, allowedSizes: string[]): string {
    const normalized = size.trim();
    const exact = allowedSizes.find(item => item.toLowerCase() === normalized.toLowerCase());
    if (exact) return exact;

    const requested = parseSizeToken(normalized);
    if (!requested) {
        return allowedSizes.includes('2K') ? '2K' : allowedSizes[0];
    }

    const requestedRatio = requested.width / requested.height;
    let best: { token: string; score: number } | null = null;

    for (const candidate of allowedSizes) {
        const parsed = parseSizeToken(candidate);
        if (!parsed) continue;
        const ratio = parsed.width / parsed.height;
        const ratioDiff = Math.abs(ratio - requestedRatio);
        const areaDiff = Math.abs((parsed.width * parsed.height) - (requested.width * requested.height)) / (requested.width * requested.height);
        const score = ratioDiff * 3 + areaDiff;
        if (!best || score < best.score) {
            best = { token: candidate, score };
        }
    }

    if (best) return best.token;
    return allowedSizes.includes('2K') ? '2K' : allowedSizes[0];
}

function normalizeImageSizeForProvider(provider: AIProvider, size: string, key?: UserApiKey): string {
    // ARK image endpoint should follow documented discrete size values.
    if (provider === 'custom' && isArkCustomEndpoint(key)) {
        const allowedSizes = parseArkAllowedSizesFromEnv();
        if (allowedSizes.length === 0) return '2K';
        return pickClosestArkSize(size, allowedSizes);
    }
    return size;
}

function pickFirstNonEmptyString(values: unknown[]): string | null {
    for (const value of values) {
        if (typeof value === 'string' && value.trim().length > 0) {
            return value;
        }
    }
    return null;
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    const chunkSize = 0x8000;
    for (let i = 0; i < bytes.length; i += chunkSize) {
        const chunk = bytes.subarray(i, i + chunkSize);
        binary += String.fromCharCode(...chunk);
    }
    return btoa(binary);
}

async function imageUrlToBase64(url: string): Promise<{ base64: string; mimeType: string }> {
    const res = await fetch(url);
    if (!res.ok) {
        throw new Error(`Failed to fetch generated image URL (${res.status})`);
    }
    const blob = await res.blob();
    const mimeType = blob.type || 'image/png';
    const buffer = await blob.arrayBuffer();
    return { base64: arrayBufferToBase64(buffer), mimeType };
}

function inferPromptModeHint(request: PromptEnhanceRequest) {
    const modeHintMap: Record<PromptEnhanceRequest['mode'], string> = {
        smart: 'Do intelligent enhancement with richer cinematic details, composition, and lighting.',
        style: `Rewrite with strong style intent. Preferred style preset: ${request.stylePreset || 'cinematic'}.`,
        precise: 'Preserve user intent strictly; only optimize clarity and structure.',
        translate: 'Translate and optimize prompt for model friendliness while preserving semantics.',
    };

    return [
        'You are a professional prompt engineer for image and video generation.',
        'Return ONLY valid JSON with keys: enhancedPrompt, negativePrompt, suggestions, notes.',
        'Keep enhancedPrompt concise but vivid. Do not use markdown.',
        'negativePrompt should be a comma-separated phrase list.',
        'suggestions should be short keyword phrases.',
        modeHintMap[request.mode],
    ].join('\n');
}

function safeParsePromptResult(raw: string, fallbackPrompt: string): PromptEnhanceResult {
    const clean = raw
        .replace(/^```json\s*/i, '')
        .replace(/^```/i, '')
        .replace(/```$/i, '')
        .trim();

    try {
        const parsed = JSON.parse(clean) as Partial<PromptEnhanceResult>;
        return {
            enhancedPrompt: parsed.enhancedPrompt?.trim() || fallbackPrompt,
            negativePrompt: parsed.negativePrompt?.trim() || '',
            suggestions: Array.isArray(parsed.suggestions) ? parsed.suggestions.filter(Boolean).slice(0, 8) : [],
            notes: parsed.notes?.trim() || '',
        };
    } catch {
        return {
            enhancedPrompt: fallbackPrompt,
            negativePrompt: '',
            suggestions: [],
            notes: raw || 'No response content returned by model.',
        };
    }
}

export function inferProviderFromModel(model: string): AIProvider {
    if (/^(gemini|imagen|veo)/i.test(model)) return 'google';
    if (/^(dall-e|gpt-image|gpt-4o)/i.test(model)) return 'openai';
    if (/^claude/i.test(model)) return 'anthropic';
    if (/^qwen/i.test(model)) return 'qwen';
    if (/^(sdxl|stable-diffusion)/i.test(model)) return 'stability';
    if (/^banana/i.test(model)) return 'banana';
    return 'custom';
}

async function enhancePromptWithOpenAICompatible(
    request: PromptEnhanceRequest,
    model: string,
    provider: AIProvider,
    key?: UserApiKey
): Promise<PromptEnhanceResult> {
    const apiKey = requireApiKey(provider, key);
    const baseUrl = getBaseUrl(provider, key);
    const response = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
            model,
            temperature: 0.6,
            messages: [
                { role: 'system', content: inferPromptModeHint(request) },
                { role: 'user', content: request.prompt },
            ],
        }),
    });

    if (!response.ok) {
        const text = await response.text().catch(() => '');
        throw new Error(`${provider} LLM 璇锋眰澶辫触 (${response.status}): ${text || response.statusText}`);
    }

    const json = await response.json();
    const raw = json?.choices?.[0]?.message?.content || '';
    return safeParsePromptResult(raw, request.prompt);
}

async function enhancePromptWithAnthropic(
    request: PromptEnhanceRequest,
    model: string,
    key?: UserApiKey
): Promise<PromptEnhanceResult> {
    const apiKey = requireApiKey('anthropic', key);
    const baseUrl = getBaseUrl('anthropic', key);
    const response = await fetch(`${baseUrl}/messages`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
            model,
            max_tokens: 1024,
            system: inferPromptModeHint(request),
            messages: [{ role: 'user', content: request.prompt }],
        }),
    });

    if (!response.ok) {
        const text = await response.text().catch(() => '');
        throw new Error(`Anthropic 璇锋眰澶辫触 (${response.status}): ${text || response.statusText}`);
    }

    const json = await response.json();
    const raw = Array.isArray(json?.content)
        ? json.content.map((item: { text?: string }) => item.text || '').join('\n')
        : '';
    return safeParsePromptResult(raw, request.prompt);
}

/**
 * 銆愬嚱鏁般€戠粺涓€鐨勬彁绀鸿瘝娑﹁壊鍏ュ彛
 *
 * 鏍规嵁妯″瀷鍚嶇О鑷姩鎺ㄦ柇 provider锛岃矾鐢卞埌瀵瑰簲鐨勬鼎鑹插疄鐜般€?
 * 鎵€鏈?provider 閮介€氳繃 key 鍙傛暟鍗虫椂浼犲叆 API Key锛岄伩鍏嶄緷璧栧叏灞€鐘舵€併€?
 *
 * @param request  - 娑﹁壊璇锋眰锛堝師濮嬫彁绀鸿瘝 + 妯″紡锛?
 * @param model    - 妯″瀷鍚嶇О锛堢敤浜庢帹鏂?provider锛?
 * @param key      - 鐢ㄦ埛閰嶇疆鐨?API Key锛堝彲閫夛紝浠?App.tsx state 浼犲叆锛?
 */
export async function enhancePromptWithProvider(
    request: PromptEnhanceRequest,
    model: string,
    key?: UserApiKey
): Promise<PromptEnhanceResult> {
    const provider = inferProviderFromModel(model);

    if (provider === 'google') {
        // 浼犲叆 key?.key 纭繚浣跨敤鐢ㄦ埛閰嶇疆鐨?API Key锛岃€岄潪浠呬緷璧栧叏灞€ runtimeConfig
        return enhancePromptWithGemini(request, key?.key);
    }

    if (provider === 'anthropic') {
        return enhancePromptWithAnthropic(request, model, key);
    }

    return enhancePromptWithOpenAICompatible(request, model, provider, key);
}

/**
 * 銆愬嚱鏁般€戠粺涓€鐨勫浘鐗囩敓鎴愬叆鍙?
 *
 * 鏍规嵁妯″瀷鍚嶇О璺敱鍒?Google Imagen / OpenAI DALL-E / Stability SDXL 绛夈€?
 * 褰撳墠鏀寔锛歡oogle銆乷penai銆乻tability銆乧ustom銆?
 * Anthropic / Qwen / Banana 鏆備笉鏀寔鍥剧墖鐢熸垚锛屼細鎶涘嚭閿欒銆?
 *
 * @param prompt - 鍥剧墖鎻忚堪鎻愮ず璇?
 * @param model  - 妯″瀷鍚嶇О
 * @param key    - 鐢ㄦ埛 API Key
 */
export async function generateImageWithProvider(
    prompt: string,
    model: string,
    key?: UserApiKey,
    options?: { size?: string; aspectRatio?: string; resolution?: string }
): Promise<{ newImageBase64: string | null; newImageMimeType: string | null; newImageUrl: string | null; textResponse: string | null }> {
    const provider = inferProviderFromModel(model);
    const requestedSize = options?.size || '1024x1024';
    const size = normalizeImageSizeForProvider(provider, requestedSize, key);

    if (provider === 'google') {
        // 浼犲叆 key?.key 纭繚浣跨敤鐢ㄦ埛 UI 涓厤缃殑 API Key
        const result = await generateImageFromText(prompt, key?.key);
        return { ...result, newImageUrl: null };
    }

    if (provider === 'openai' || provider === 'custom') {
        const apiKey = requireApiKey(provider, key);
        const baseUrl = getBaseUrl(provider, key);

        // APIYI Nano Banana: follow docs with Gemini native endpoint to support aspect ratio + image size.
        if (provider === 'custom' && isApiyiCustomEndpoint(key)) {
            const nativeModel = mapToApiyiNativeModel(model);
            const imageSize = mapResolutionToApiyiImageSize(options?.resolution || requestedSize);
            const aspectRatio = normalizeApiyiAspectRatio(options?.aspectRatio);
            const origin = getApiyiOrigin(baseUrl);

            const response = await fetch(`${origin}/v1beta/models/${encodeURIComponent(nativeModel)}:generateContent`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${apiKey}`,
                },
                body: JSON.stringify({
                    contents: [{ parts: [{ text: prompt }] }],
                    generationConfig: {
                        responseModalities: ['IMAGE'],
                        imageConfig: {
                            aspectRatio,
                            imageSize,
                        },
                    },
                }),
            });

            if (!response.ok) {
                const text = await response.text().catch(() => '');
                throw new Error(`custom 图片生成失败 (${response.status}): ${text || response.statusText}`);
            }

            const json = await response.json();
            const inline = json?.candidates?.[0]?.content?.parts?.find((part: any) => part?.inlineData?.data)?.inlineData;
            const b64 = inline?.data;
            const mime = inline?.mimeType || 'image/png';
            if (typeof b64 === 'string' && b64.length > 0) {
                return {
                    newImageBase64: b64,
                    newImageMimeType: mime,
                    newImageUrl: null,
                    textResponse: null,
                };
            }

            return {
                newImageBase64: null,
                newImageMimeType: null,
                newImageUrl: null,
                textResponse: 'Image API returned success but no inline image payload.',
            };
        }

        const response = await fetch(`${baseUrl}/images/generations`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${apiKey}`,
            },
            body: JSON.stringify({
                model,
                prompt,
                size,
                response_format: provider === 'custom' ? 'url' : 'b64_json',
            }),
        });

        if (!response.ok) {
            const text = await response.text().catch(() => '');
            throw new Error(`${provider} 图片生成失败 (${response.status}): ${text || response.statusText}`);
        }

        const json = await response.json();
        const firstData = Array.isArray(json?.data) ? json.data[0] : json?.data;
        const firstImage = Array.isArray(json?.images) ? json.images[0] : json?.images;

        const b64 = pickFirstNonEmptyString([
            firstData?.b64_json,
            firstData?.base64,
            firstData?.image_base64,
            firstImage?.b64_json,
            firstImage?.base64,
            firstImage?.image_base64,
            json?.b64_json,
            json?.base64,
            json?.image_base64,
        ]);
        if (typeof b64 === 'string' && b64.length > 0) {
            return {
                newImageBase64: b64,
                newImageMimeType: 'image/png',
                newImageUrl: null,
                textResponse: null,
            };
        }

        const imageUrl = pickFirstNonEmptyString([
            firstData?.url,
            firstData?.image_url,
            firstImage?.url,
            firstImage?.image_url,
            json?.url,
            json?.image_url,
            json?.result?.url,
            json?.result?.image_url,
            json?.output?.url,
            json?.output?.image_url,
        ]);
        if (typeof imageUrl === 'string' && imageUrl.length > 0) {
            return {
                newImageBase64: null,
                newImageMimeType: null,
                newImageUrl: imageUrl,
                textResponse: null,
            };
        }

        return {
            newImageBase64: null,
            newImageMimeType: null,
            newImageUrl: null,
            textResponse: 'Image API returned success but no usable image payload (b64/url).',
        };
    }

    if (provider === 'stability') {
        const apiKey = requireApiKey('stability', key);
        const baseUrl = getBaseUrl('stability', key);
        const [width, height] = (size.match(/^(\d+)x(\d+)$/i)?.slice(1).map(Number) || [1024, 1024]) as [number, number];
        const response = await fetch(`${baseUrl}/generation/stable-diffusion-xl-1024-v1-0/text-to-image`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Accept: 'application/json',
                Authorization: `Bearer ${apiKey}`,
            },
            body: JSON.stringify({
                text_prompts: [{ text: prompt }],
                cfg_scale: 7,
                clip_guidance_preset: 'FAST_BLUE',
                height,
                width,
                samples: 1,
                steps: 30,
            }),
        });

        if (!response.ok) {
            const text = await response.text().catch(() => '');
            throw new Error(`Stability 图片生成失败 (${response.status}): ${text || response.statusText}`);
        }

        const json = await response.json();
        return {
            newImageBase64: json?.artifacts?.[0]?.base64 || null,
            newImageMimeType: 'image/png',
            newImageUrl: null,
            textResponse: null,
        };
    }

    throw new Error('Image generation is not supported for provider: ' + provider);
}
