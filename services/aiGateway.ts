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
    if (lower === 'nano-banana-2') return 'gemini-3.1-flash-image-preview';
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
        smart: 'Maximize image quality: enrich subject details, composition, camera language, lighting, texture/material, color script, atmosphere, and render fidelity.',
        style: `Apply strong style direction with high consistency. Preferred style preset: ${request.stylePreset || 'cinematic'}.`,
        precise: 'Keep user intent strict, but still raise visual quality with concrete nouns, camera/lens details, and physically plausible lighting.',
        translate: 'Translate and optimize for image model readability while preserving semantics and quality constraints.',
    };

    const memoryHint = (request.memoryExamples || [])
        .slice(0, 3)
        .map((item, index) => `MemoryExample${index + 1}: ${item}`)
        .join('\n');

    return [
        'You are a senior prompt engineer focused on premium image generation quality.',
        'Return ONLY valid JSON with keys: enhancedPrompt, negativePrompt, suggestions, notes.',
        'Do not use markdown. Do not add extra keys.',
        'enhancedPrompt: one high-density paragraph with clear subject, scene, composition, lens/camera, lighting, material texture, color palette, mood, and quality tags.',
        'negativePrompt: a comma-separated list of 12-24 constraints to suppress artifacts and low quality outcomes.',
        'suggestions: 4-8 short style/control keywords.',
        'Prefer concrete visual language over vague adjectives.',
        modeHintMap[request.mode],
        memoryHint ? `Use these as quality references, not hard constraints:\n${memoryHint}` : '',
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

function stripJsonFence(raw: string): string {
    return raw
        .replace(/^```json\s*/i, '')
        .replace(/^```/i, '')
        .replace(/```$/i, '')
        .trim();
}

function safeJsonParse<T>(raw: string): T | null {
    try {
        return JSON.parse(stripJsonFence(raw)) as T;
    } catch {
        return null;
    }
}

function normalizePromptEnhanceResult(candidate: Partial<PromptEnhanceResult> | null, fallbackPrompt: string): PromptEnhanceResult {
    return {
        enhancedPrompt: candidate?.enhancedPrompt?.trim() || fallbackPrompt,
        negativePrompt: candidate?.negativePrompt?.trim() || '',
        suggestions: Array.isArray(candidate?.suggestions) ? candidate!.suggestions.filter(Boolean).slice(0, 8) : [],
        notes: candidate?.notes?.trim() || '',
    };
}

type PromptPlan = {
    subject: string;
    scene: string;
    composition: string;
    camera: string;
    lighting: string;
    style: string;
    negativeHints: string[];
};

function planPromptIntent(prompt: string): PromptPlan {
    const normalized = prompt.trim();
    const lower = normalized.toLowerCase();
    const byKeywords = (pairs: Array<[RegExp, string]>, fallback: string) =>
        pairs.find(([pattern]) => pattern.test(lower))?.[1] || fallback;

    return {
        subject: normalized.split(/[,.!?\n]/)[0]?.trim() || normalized,
        scene: byKeywords([
            [/\bstage|theater|opera|performance\b/, 'ornate performance venue with layered environmental storytelling'],
            [/\bcity|street|market\b/, 'immersive environment with readable spatial depth'],
            [/\bportrait|character|person\b/, 'subject-focused portrait setup'],
        ], 'cohesive scene with readable foreground, midground, and background'),
        composition: byKeywords([
            [/\bwide\b|\bestablishing\b/, 'wide establishing composition with clear depth separation'],
            [/\bclose[- ]?up\b/, 'close-up framing with strong focal emphasis'],
            [/\b16:9\b/, 'cinematic horizontal composition with balanced negative space'],
        ], 'balanced composition with strong focal hierarchy and clean silhouettes'),
        camera: byKeywords([
            [/\bwide angle\b|\b24mm\b/, 'wide-angle lens feeling, cinematic perspective'],
            [/\b50mm\b|\bportrait\b/, '50mm lens feeling, natural perspective'],
            [/\bmacro\b/, 'macro-detail emphasis with shallow depth of field'],
        ], 'cinematic lens language, controlled perspective'),
        lighting: byKeywords([
            [/\bnight\b|\bdark\b/, 'dramatic motivated lighting, soft volumetric glow, controlled contrast'],
            [/\bsoft\b/, 'soft diffused lighting with gentle shadow transitions'],
            [/\bbright\b|\bsunny\b/, 'bright polished lighting with crisp key/fill separation'],
        ], 'polished cinematic lighting with depth, contrast, and controlled highlights'),
        style: byKeywords([
            [/\b2d\b|\bcartoon\b|\billustration\b/, 'clean stylized illustration, appealing shapes, polished line and color control'],
            [/\brealistic\b|\bphoto\b/, 'high-end realistic rendering, rich material definition'],
            [/\bstorybook\b/, 'storybook illustration with charming visual narrative'],
        ], 'high-quality visual storytelling with strong stylistic consistency'),
        negativeHints: [
            'low quality', 'blurry', 'deformed anatomy', 'cropped subject', 'flat lighting', 'muddy colors', 'text artifacts', 'watermark',
        ],
    };
}

function applyModelPromptTemplate(model: string, plan: PromptPlan, basePrompt: string): string {
    const lower = model.toLowerCase();
    const qualityTail =
        lower.includes('pro')
            ? 'premium detail, nuanced materials, advanced lighting, strong atmosphere, polished finish'
            : lower.includes('banana-2')
                ? 'clean composition, stronger focal hierarchy, richer lighting contrast, more refined detail'
                : 'clear subject readability, appealing composition, vibrant lighting, clean details';

    return [
        basePrompt,
        `Scene intent: ${plan.scene}.`,
        `Composition: ${plan.composition}.`,
        `Camera: ${plan.camera}.`,
        `Lighting: ${plan.lighting}.`,
        `Style: ${plan.style}.`,
        `Quality targets: ${qualityTail}.`,
    ].join(' ');
}

function scorePromptCandidate(candidate: PromptEnhanceResult): number {
    const text = `${candidate.enhancedPrompt} ${candidate.negativePrompt}`.toLowerCase();
    let score = 0;

    score += Math.min(32, Math.floor(candidate.enhancedPrompt.length / 18));

    const controlTerms = ['composition', 'lighting', 'camera', 'lens', 'color', 'texture', 'atmosphere', 'depth', 'cinematic', 'materials'];
    score += controlTerms.reduce((acc, term) => acc + (text.includes(term) ? 4 : 0), 0);

    const negatives = candidate.negativePrompt.split(',').map(s => s.trim()).filter(Boolean);
    score += Math.min(24, negatives.length * 2);

    if (candidate.enhancedPrompt.length < 140) score -= 12;
    if (!text.includes('lighting')) score -= 8;
    if (!text.includes('composition')) score -= 8;
    if (!text.includes('camera') && !text.includes('lens')) score -= 6;

    return Math.max(0, score);
}

async function runOpenAICompatiblePromptStep(
    model: string,
    provider: AIProvider,
    key: UserApiKey | undefined,
    systemPrompt: string,
    userPrompt: string,
    temperature = 0.4
): Promise<string> {
    const apiKey = requireApiKey(provider, key);
    const baseUrl = getBaseUrl(provider, key);
    const supportsJsonObjectResponseFormat = provider === 'openai';
    const requestBody: any = {
        model,
        temperature,
        messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
        ],
    };
    if (supportsJsonObjectResponseFormat) {
        requestBody.response_format = { type: 'json_object' };
    }
    const response = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(requestBody),
    });
    if (!response.ok) {
        const text = await response.text().catch(() => '');
        throw new Error(`${provider} LLM step failed (${response.status}): ${text || response.statusText}`);
    }
    const json = await response.json();
    return json?.choices?.[0]?.message?.content || '';
}

async function runAnthropicPromptStep(
    model: string,
    key: UserApiKey | undefined,
    systemPrompt: string,
    userPrompt: string
): Promise<string> {
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
            max_tokens: 1200,
            system: systemPrompt,
            messages: [{ role: 'user', content: userPrompt }],
        }),
    });
    if (!response.ok) {
        const text = await response.text().catch(() => '');
        throw new Error(`Anthropic LLM step failed (${response.status}): ${text || response.statusText}`);
    }
    const json = await response.json();
    return Array.isArray(json?.content)
        ? json.content.map((item: { text?: string }) => item.text || '').join('\n')
        : '';
}

async function runPromptAgentStep(
    provider: AIProvider,
    model: string,
    key: UserApiKey | undefined,
    systemPrompt: string,
    userPrompt: string,
    temperature = 0.4
): Promise<string> {
    if (provider === 'anthropic') {
        return runAnthropicPromptStep(model, key, systemPrompt, userPrompt);
    }
    if (provider === 'openai' || provider === 'qwen' || provider === 'custom') {
        return runOpenAICompatiblePromptStep(model, provider, key, systemPrompt, userPrompt, temperature);
    }
    throw new Error(`Prompt agent pipeline is not supported for provider: ${provider}`);
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

export async function enhancePromptWithAgentPipeline(
    request: PromptEnhanceRequest,
    model: string,
    key?: UserApiKey
): Promise<PromptEnhanceResult> {
    const provider = inferProviderFromModel(model);

    // For Google, keep current single-step flow to avoid SDK dual-path complexity.
    if (provider === 'google') {
        const base = await enhancePromptWithProvider(request, model, key);
        return {
            ...base,
            notes: [base.notes, 'pipeline: fallback(single-step-google)'].filter(Boolean).join(' | '),
        };
    }

    const isSupported = provider === 'openai' || provider === 'qwen' || provider === 'custom' || provider === 'anthropic';
    if (!isSupported) {
        return enhancePromptWithProvider(request, model, key);
    }

    const plan = planPromptIntent(request.prompt);

    const buildSystem = [
        'You are a Prompt Composer for premium image generation.',
        'Return JSON only with keys: enhancedPrompt, negativePrompt, suggestions, notes.',
        'enhancedPrompt must be one dense paragraph covering subject, scene, composition, camera/lens, lighting, material texture, color palette, mood, and quality descriptors.',
        'negativePrompt must be a comma-separated list with at least 12 concrete artifact suppressions.',
        'suggestions must contain 4-8 short control keywords.',
        `mode=${request.mode}; stylePreset=${request.stylePreset || 'none'}`,
    ].join('\n');

    const memorySection = (request.memoryExamples || [])
        .slice(0, 3)
        .map((item, index) => `- Example ${index + 1}: ${item}`)
        .join('\n');

    const primaryUser = [
        'Optimize this image prompt for high quality while preserving intent.',
        `Planned subject: ${plan.subject}`,
        `Planned scene: ${plan.scene}`,
        `Planned composition: ${plan.composition}`,
        `Planned camera: ${plan.camera}`,
        `Planned lighting: ${plan.lighting}`,
        `Planned style: ${plan.style}`,
        `Base prompt: ${applyModelPromptTemplate(model, plan, request.prompt)}`,
        memorySection ? `Reference memory prompts:\n${memorySection}` : '',
    ].join('\n\n');

    const variantSystem = [
        'You are a fast alternate prompt optimizer.',
        'Return JSON only with keys: enhancedPrompt, negativePrompt, suggestions, notes.',
        'Bias toward stronger composition and lighting control while preserving intent.',
        'Keep wording compact and model-friendly.',
    ].join('\n');

    const variantUser = [
        'Generate an alternative high-quality version for the same prompt.',
        'Prefer explicit shot framing, focal length feel, and lighting hierarchy.',
        `Base prompt: ${applyModelPromptTemplate(model, plan, request.prompt)}`,
        memorySection ? `Reference memory prompts:\n${memorySection}` : '',
    ].join('\n\n');

    const primaryPromise = runPromptAgentStep(
        provider,
        model,
        key,
        buildSystem,
        primaryUser,
        0.35
    );

    const variantPromise = runPromptAgentStep(
        provider,
        model,
        key,
        variantSystem,
        variantUser,
        0.45
    );

    const withTimeout = async <T>(promise: Promise<T>, timeoutMs: number): Promise<T | null> => {
        return await new Promise<T | null>((resolve) => {
            const timer = setTimeout(() => resolve(null), timeoutMs);
            promise
                .then(value => resolve(value))
                .catch(() => resolve(null))
                .finally(() => clearTimeout(timer));
        });
    };

    const primaryRaw = await primaryPromise;
    const primary = normalizePromptEnhanceResult(
        safeJsonParse<Partial<PromptEnhanceResult>>(primaryRaw),
        request.prompt
    );

    const primaryScore = scorePromptCandidate(primary);
    const needsRefiner = primaryScore < 58;
    const variantRaw = needsRefiner ? await withTimeout(variantPromise, 900) : null;
    const variant = variantRaw
        ? normalizePromptEnhanceResult(safeJsonParse<Partial<PromptEnhanceResult>>(variantRaw), request.prompt)
        : null;
    const variantScore = variant ? scorePromptCandidate(variant) : -1;
    const best = variant && variantScore > primaryScore ? variant : primary;
    const finalScore = variant && variantScore > primaryScore ? variantScore : primaryScore;

    return {
        enhancedPrompt: best.enhancedPrompt,
        negativePrompt: best.negativePrompt,
        suggestions: best.suggestions,
        notes: [
            best.notes,
            `pipeline: planner->composer->critic${needsRefiner ? '->refiner' : ''}->memory`,
            `modelAdapter=${model}`,
            `scores(primary=${primaryScore}${needsRefiner ? (variant ? `, refiner=${variantScore}` : ', refiner=timeout') : ', refiner=skipped'}, final=${finalScore})`,
        ].filter(Boolean).join(' | '),
    };
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
function extractInlineImageData(image: { href: string; mimeType: string }): { data: string; mimeType: string } | null {
    const href = image.href || '';
    const dataUrlMatch = href.match(/^data:([^;]+);base64,(.+)$/i);
    if (dataUrlMatch) {
        return {
            data: dataUrlMatch[2],
            mimeType: image.mimeType || dataUrlMatch[1] || 'image/png',
        };
    }
    return null;
}

export async function generateImageWithProvider(
    prompt: string,
    model: string,
    key?: UserApiKey,
    options?: { size?: string; aspectRatio?: string; resolution?: string; referenceImages?: { href: string; mimeType: string }[] }
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
            const referenceImages = (options?.referenceImages || [])
                .map(extractInlineImageData)
                .filter((item): item is { data: string; mimeType: string } => !!item);
            const parts = referenceImages.length > 0
                ? [...referenceImages.map(image => ({ inlineData: image })), { text: prompt }]
                : [{ text: prompt }];

            const response = await fetch(`${origin}/v1beta/models/${encodeURIComponent(nativeModel)}:generateContent`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${apiKey}`,
                },
                body: JSON.stringify({
                    contents: [{ parts }],
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
