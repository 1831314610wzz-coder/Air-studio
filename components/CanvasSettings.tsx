import React from 'react';
import type { WheelAction, UserApiKey, ModelPreference, AIProvider, AICapability, ThemeMode } from '../types';
import { validateApiKey } from '../services/aiGateway';

interface CanvasSettingsProps {
    isOpen: boolean;
    onClose: () => void;
    language: 'en' | 'zho';
    setLanguage: (lang: 'en' | 'zho') => void;
    themeMode: ThemeMode;
    resolvedTheme: 'light' | 'dark';
    setThemeMode: (mode: ThemeMode) => void;
    wheelAction: WheelAction;
    setWheelAction: (action: WheelAction) => void;
    userApiKeys: UserApiKey[];
    onAddApiKey: (payload: Omit<UserApiKey, 'id' | 'createdAt' | 'updatedAt'>) => void;
    onDeleteApiKey: (id: string) => void;
    onSetDefaultApiKey: (id: string) => void;
    modelPreference: ModelPreference;
    setModelPreference: (prefs: ModelPreference) => void;
    t: (key: string) => string;
}

const providerBaseUrl: Record<AIProvider, string> = {
    openai: 'https://api.openai.com/v1',
    anthropic: 'https://api.anthropic.com/v1',
    google: 'https://generativelanguage.googleapis.com/v1beta/models',
    stability: 'https://api.stability.ai/v1',
    qwen: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    banana: 'https://api.banana.dev/v1/vision',
    custom: '',
};

const capabilityLabels: Record<AICapability, string> = {
    text: 'LLM',
    image: '图片',
    video: '视频',
    agent: 'Agent',
};

const modelOptions = {
    text: ['gemini-2.5-pro', 'gpt-4o-mini', 'claude-3-5-sonnet', 'qwen-max'],
    image: ['gemini-2.5-flash-image-preview', 'imagen-4.0-generate-001', 'dall-e-3', 'sdxl'],
    video: ['veo-2.0-generate-001'],
    agent: ['banana-vision-v1'],
};

export const CanvasSettings: React.FC<CanvasSettingsProps> = ({
    isOpen,
    onClose,
    language,
    setLanguage,
    themeMode,
    resolvedTheme,
    setThemeMode,
    wheelAction,
    setWheelAction,
    userApiKeys,
    onAddApiKey,
    onDeleteApiKey,
    onSetDefaultApiKey,
    modelPreference,
    setModelPreference,
}) => {
    const [provider, setProvider] = React.useState<AIProvider>('google');
    const [apiKey, setApiKey] = React.useState('');
    const [baseUrl, setBaseUrl] = React.useState(providerBaseUrl.google);
    const [displayName, setDisplayName] = React.useState('');
    const [showKey, setShowKey] = React.useState(false);
    const [capabilities, setCapabilities] = React.useState<AICapability[]>(['text', 'image', 'video']);
    const [isValidating, setIsValidating] = React.useState(false);
    const [validationResult, setValidationResult] = React.useState<{ ok: boolean; message?: string } | null>(null);

    if (!isOpen) return null;

    const isDark = resolvedTheme === 'dark';
    const inputClass = `w-full rounded-2xl border px-3 py-2.5 text-sm outline-none transition ${
        isDark
            ? 'border-[#2A3140] bg-[#161A22] text-[#F3F4F6] placeholder:text-[#667085] focus:border-[#4B5B78]'
            : 'border-[#E4E7EC] bg-white text-[#344054] placeholder:text-[#98A2B3] focus:border-[#98A2B3]'
    }`;
    const chipClass = `rounded-full border px-3 py-2 text-sm transition ${
        isDark
            ? 'border-[#2A3140] bg-[#1B2029] text-[#D0D5DD] hover:bg-[#252C39]'
            : 'border-[#E4E7EC] bg-[#F8FAFC] text-[#475467] hover:bg-[#F2F4F7]'
    }`;

    const toggleCapability = (capability: AICapability) => {
        setCapabilities(prev =>
            prev.includes(capability)
                ? prev.filter(item => item !== capability)
                : [...prev, capability]
        );
    };

    const maskKey = (key: string) => {
        if (key.length < 10) return '****';
        return `${key.slice(0, 4)}****${key.slice(-4)}`;
    };

    const handleProviderChange = (next: AIProvider) => {
        setProvider(next);
        setBaseUrl(providerBaseUrl[next]);
        if (next === 'banana') setCapabilities(['agent']);
        if (next === 'anthropic' || next === 'qwen') setCapabilities(['text']);
        if (next === 'stability') setCapabilities(['image']);
        if (next === 'google') setCapabilities(['text', 'image', 'video']);
        if (next === 'openai') setCapabilities(['text', 'image']);
        if (next === 'custom') setCapabilities(['text', 'image', 'video']);
    };

    const handleSaveKey = async () => {
        if (!apiKey.trim() || capabilities.length === 0) return;

        // 先验证 key 是否有效
        setIsValidating(true);
        setValidationResult(null);
        const result = await validateApiKey(provider, apiKey.trim(), baseUrl.trim() || undefined);
        setIsValidating(false);
        setValidationResult(result);

        if (!result.ok) return; // 验证失败不保存

        onAddApiKey({
            provider,
            capabilities,
            key: apiKey.trim(),
            baseUrl: baseUrl.trim() || undefined,
            name: displayName.trim() || undefined,
            status: 'ok',
            isDefault: false,
        });
        setApiKey('');
        setDisplayName('');
        setValidationResult(null);
    };

    return (
        <div className="theme-aware fixed inset-0 z-[100] flex items-center justify-center bg-black/35 backdrop-blur-sm" onClick={onClose}>
            <div
                className={`relative max-h-[88vh] w-[92%] max-w-[680px] overflow-y-auto rounded-[28px] border p-6 shadow-[0_40px_120px_rgba(15,23,42,0.18)] ${
                    isDark ? 'border-[#2A3140] bg-[#12151B]' : 'border-[#E4E7EC] bg-white'
                }`}
                onClick={(event) => event.stopPropagation()}
            >
                <div className="mb-6 flex items-center justify-between">
                    <div>
                        <h3 className={`text-xl font-semibold ${isDark ? 'text-[#F3F4F6]' : 'text-[#101828]'}`}>设置</h3>
                        <p className={`mt-1 text-sm ${isDark ? 'text-[#98A2B3]' : 'text-[#667085]'}`}>
                            管理主题模式、交互方式、API 能力和默认模型。
                        </p>
                    </div>
                    <button
                        type="button"
                        onClick={onClose}
                        className={`flex h-10 w-10 items-center justify-center rounded-2xl border transition ${
                            isDark ? 'border-[#2A3140] text-[#98A2B3] hover:bg-[#1B2029]' : 'border-[#E4E7EC] text-[#667085] hover:bg-[#F9FAFB]'
                        }`}
                    >
                        ×
                    </button>
                </div>

                <div className="space-y-6">
                    <section className="space-y-3">
                        <div className={`text-xs font-semibold uppercase tracking-[0.18em] ${isDark ? 'text-[#667085]' : 'text-[#98A2B3]'}`}>
                            界面主题
                        </div>
                        <div className="grid gap-3 md:grid-cols-3">
                            {([
                                ['light', '浅色模式', '明亮白板与柔和面板'],
                                ['dark', '黑夜模式', '深色工作台与高对比内容'],
                                ['system', '跟随系统', '自动跟随设备主题'],
                            ] as Array<[ThemeMode, string, string]>).map(([mode, title, description]) => (
                                <button
                                    key={mode}
                                    type="button"
                                    onClick={() => setThemeMode(mode)}
                                    className={`rounded-[24px] border p-4 text-left transition ${
                                        themeMode === mode
                                            ? isDark
                                                ? 'border-[#4B5B78] bg-[#1B2330] shadow-[0_10px_30px_rgba(0,0,0,0.18)]'
                                                : 'border-[#B2CCFF] bg-[#EEF4FF] shadow-[0_10px_30px_rgba(23,92,211,0.08)]'
                                            : isDark
                                                ? 'border-[#2A3140] bg-[#161A22] hover:bg-[#1B2029]'
                                                : 'border-[#E4E7EC] bg-[#F8FAFC] hover:bg-white'
                                    }`}
                                >
                                    <div className="mb-3 flex items-center justify-between">
                                        <div className={`text-sm font-semibold ${isDark ? 'text-[#F3F4F6]' : 'text-[#101828]'}`}>{title}</div>
                                        {themeMode === mode && (
                                            <span className={`rounded-full px-2 py-1 text-[11px] font-medium ${
                                                isDark ? 'bg-[#7CB4FF]/20 text-[#7CB4FF]' : 'bg-[#DCEBFF] text-[#175CD3]'
                                            }`}>
                                                当前
                                            </span>
                                        )}
                                    </div>
                                    <div className={`mb-4 text-xs ${isDark ? 'text-[#98A2B3]' : 'text-[#667085]'}`}>{description}</div>
                                    <div className={`grid h-16 grid-cols-[1fr_56px] gap-2 rounded-2xl p-2 ${
                                        mode === 'dark' || (mode === 'system' && resolvedTheme === 'dark')
                                            ? 'bg-[#0F141C]'
                                            : 'bg-white'
                                    }`}>
                                        <div className={`rounded-xl border ${
                                            mode === 'dark' || (mode === 'system' && resolvedTheme === 'dark')
                                                ? 'border-[#2A3140] bg-[#161A22]'
                                                : 'border-[#E4E7EC] bg-[#F8FAFC]'
                                        }`} />
                                        <div className={`rounded-xl border ${
                                            mode === 'dark' || (mode === 'system' && resolvedTheme === 'dark')
                                                ? 'border-[#2A3140] bg-[#12151B]'
                                                : 'border-[#E4E7EC] bg-white'
                                        }`} />
                                    </div>
                                </button>
                            ))}
                        </div>
                    </section>

                    <section className="space-y-3">
                        <div className={`text-xs font-semibold uppercase tracking-[0.18em] ${isDark ? 'text-[#667085]' : 'text-[#98A2B3]'}`}>
                            语言与交互
                        </div>
                        <div className="grid gap-3 md:grid-cols-2">
                            <div className={`rounded-2xl p-3 ${isDark ? 'bg-[#161A22]' : 'bg-[#F8FAFC]'}`}>
                                <div className={`mb-2 text-sm font-medium ${isDark ? 'text-[#D0D5DD]' : 'text-[#344054]'}`}>语言</div>
                                <div className={`inline-flex w-full rounded-full border p-1 ${isDark ? 'border-[#2A3140] bg-[#12151B]' : 'border-[#E4E7EC] bg-white'}`}>
                                    {([
                                        ['en', 'English'],
                                        ['zho', '中文'],
                                    ] as Array<['en' | 'zho', string]>).map(([value, label]) => (
                                        <button
                                            key={value}
                                            type="button"
                                            onClick={() => setLanguage(value)}
                                            className={`flex-1 rounded-full px-3 py-2 text-sm transition ${
                                                language === value
                                                    ? isDark
                                                        ? 'bg-[#F3F4F6] text-[#111827]'
                                                        : 'bg-[#111827] text-white'
                                                    : isDark
                                                        ? 'text-[#98A2B3]'
                                                        : 'text-[#667085]'
                                            }`}
                                        >
                                            {label}
                                        </button>
                                    ))}
                                </div>
                            </div>

                            <div className={`rounded-2xl p-3 ${isDark ? 'bg-[#161A22]' : 'bg-[#F8FAFC]'}`}>
                                <div className={`mb-2 text-sm font-medium ${isDark ? 'text-[#D0D5DD]' : 'text-[#344054]'}`}>滚轮行为</div>
                                <div className={`inline-flex w-full rounded-full border p-1 ${isDark ? 'border-[#2A3140] bg-[#12151B]' : 'border-[#E4E7EC] bg-white'}`}>
                                    {([
                                        ['zoom', '缩放'],
                                        ['pan', '平移'],
                                    ] as Array<[WheelAction, string]>).map(([value, label]) => (
                                        <button
                                            key={value}
                                            type="button"
                                            onClick={() => setWheelAction(value)}
                                            className={`flex-1 rounded-full px-3 py-2 text-sm transition ${
                                                wheelAction === value
                                                    ? isDark
                                                        ? 'bg-[#F3F4F6] text-[#111827]'
                                                        : 'bg-[#111827] text-white'
                                                    : isDark
                                                        ? 'text-[#98A2B3]'
                                                        : 'text-[#667085]'
                                            }`}
                                        >
                                            {label}
                                        </button>
                                    ))}
                                </div>
                            </div>
                        </div>
                    </section>

                    <section className="space-y-3">
                        <div className={`text-xs font-semibold uppercase tracking-[0.18em] ${isDark ? 'text-[#667085]' : 'text-[#98A2B3]'}`}>
                            API 配置
                        </div>
                        <div className={`rounded-[24px] border p-4 ${isDark ? 'border-[#2A3140] bg-[#161A22]' : 'border-[#E4E7EC] bg-[#F8FAFC]'}`}>
                            <div className="grid gap-3 md:grid-cols-2">
                                <select value={provider} onChange={(event) => handleProviderChange(event.target.value as AIProvider)} className={inputClass}>
                                    <option value="google">Google</option>
                                    <option value="openai">OpenAI</option>
                                    <option value="anthropic">Anthropic</option>
                                    <option value="qwen">Qwen</option>
                                    <option value="stability">Stability</option>
                                    <option value="banana">Banana</option>
                                    <option value="custom">Custom</option>
                                </select>
                                <input value={displayName} onChange={(event) => setDisplayName(event.target.value)} placeholder="备注名称（可选）" className={inputClass} />
                            </div>

                            <div className="mt-3 space-y-3">
                                <div className="flex gap-2">
                                    <input
                                        value={apiKey}
                                        onChange={(event) => setApiKey(event.target.value)}
                                        type={showKey ? 'text' : 'password'}
                                        placeholder="粘贴 API Key"
                                        className={inputClass}
                                    />
                                    <button type="button" onClick={() => setShowKey(prev => !prev)} className={chipClass}>
                                        {showKey ? '隐藏' : '显示'}
                                    </button>
                                </div>

                                <input value={baseUrl} onChange={(event) => setBaseUrl(event.target.value)} placeholder="Base URL（可选）" className={inputClass} />

                                <div>
                                    <div className={`mb-2 text-sm font-medium ${isDark ? 'text-[#D0D5DD]' : 'text-[#344054]'}`}>这个 API 用于</div>
                                    <div className="flex flex-wrap gap-2">
                                        {(['text', 'image', 'video', 'agent'] as AICapability[]).map(capability => (
                                            <button
                                                key={capability}
                                                type="button"
                                                onClick={() => toggleCapability(capability)}
                                                className={`${chipClass} ${
                                                    capabilities.includes(capability)
                                                        ? isDark
                                                            ? 'border-[#4B5B78] bg-[#1B2330] text-[#7CB4FF]'
                                                            : 'border-[#1D4ED8] bg-[#EFF6FF] text-[#1D4ED8]'
                                                        : ''
                                                }`}
                                            >
                                                {capabilityLabels[capability]}
                                            </button>
                                        ))}
                                    </div>
                                </div>

                                <button
                                    type="button"
                                    onClick={handleSaveKey}
                                    disabled={!apiKey.trim() || capabilities.length === 0 || isValidating}
                                    className={`rounded-full px-4 py-2.5 text-sm font-medium transition disabled:cursor-not-allowed ${
                                        isDark
                                            ? 'bg-[#F3F4F6] text-[#111827] hover:bg-white disabled:bg-[#3A4458] disabled:text-[#98A2B3]'
                                            : 'bg-[#111827] text-white hover:bg-[#0F172A] disabled:bg-[#D0D5DD]'
                                    }`}
                                >
                                    {isValidating ? '验证中...' : '验证并保存'}
                                </button>

                                {validationResult && (
                                    <div className={`mt-2 rounded-xl px-3 py-2 text-sm ${
                                        validationResult.ok
                                            ? isDark ? 'bg-[#123524] text-[#75E0A7]' : 'bg-[#ECFDF3] text-[#027A48]'
                                            : isDark ? 'bg-[#3A1616] text-[#FDA29B]' : 'bg-[#FEF3F2] text-[#B42318]'
                                    }`}>
                                        {validationResult.ok
                                            ? '✓ Key 验证通过，已保存'
                                            : `✗ 验证失败：${validationResult.message || 'API Key 无效'}`
                                        }
                                    </div>
                                )}
                            </div>
                        </div>

                        <div className="space-y-2">
                            {userApiKeys.length === 0 ? (
                                <div className={`rounded-2xl border border-dashed px-4 py-6 text-center text-sm ${
                                    isDark ? 'border-[#3A4458] text-[#98A2B3]' : 'border-[#D0D5DD] text-[#667085]'
                                }`}>
                                    <div className="mb-2 text-lg">🔑</div>
                                    <div className="font-medium">还没有配置 API Key</div>
                                    <div className="mt-1 text-xs">在上方选择供应商、粘贴 Key，点击「验证并保存」即可开始使用 AI 能力</div>
                                </div>
                            ) : (
                                userApiKeys.map(item => (
                                    <div key={item.id} className={`flex items-center justify-between rounded-2xl border px-4 py-3 ${
                                        isDark ? 'border-[#2A3140] bg-[#161A22]' : 'border-[#E4E7EC] bg-white'
                                    }`}>
                                        <div className="min-w-0">
                                            <div className="flex items-center gap-2">
                                                <span className={`inline-block h-2 w-2 rounded-full ${
                                                    item.status === 'ok' ? 'bg-green-500' : item.status === 'error' ? 'bg-red-400' : 'bg-yellow-400'
                                                }`} title={item.status === 'ok' ? '已验证' : item.status === 'error' ? '验证失败' : '未验证'} />
                                                <span className={`truncate text-sm font-medium ${isDark ? 'text-[#F3F4F6]' : 'text-[#101828]'}`}>{item.name || item.provider}</span>
                                            </div>
                                            <div className={`mt-1 text-xs ${isDark ? 'text-[#98A2B3]' : 'text-[#667085]'}`}>{maskKey(item.key)}</div>
                                            <div className="mt-2 flex flex-wrap gap-1.5">
                                                {(item.capabilities || []).map(capability => (
                                                    <span key={capability} className={`rounded-full px-2 py-1 text-[11px] ${
                                                        isDark ? 'bg-[#1B2029] text-[#98A2B3]' : 'bg-[#F2F4F7] text-[#667085]'
                                                    }`}>
                                                        {capabilityLabels[capability]}
                                                    </span>
                                                ))}
                                            </div>
                                        </div>
                                        <div className="ml-3 flex items-center gap-2">
                                            {!item.isDefault ? (
                                                <button type="button" onClick={() => onSetDefaultApiKey(item.id)} className={chipClass}>
                                                    设为默认
                                                </button>
                                            ) : (
                                                <span className={`rounded-full px-3 py-2 text-xs font-medium ${
                                                    isDark ? 'bg-[#123524] text-[#75E0A7]' : 'bg-[#ECFDF3] text-[#027A48]'
                                                }`}>
                                                    默认
                                                </span>
                                            )}
                                            <button
                                                type="button"
                                                onClick={() => onDeleteApiKey(item.id)}
                                                className={`rounded-full border px-3 py-2 text-xs font-medium ${
                                                    isDark ? 'border-[#7A271A] text-[#FDA29B]' : 'border-[#FECACA] text-[#DC2626]'
                                                }`}
                                            >
                                                删除
                                            </button>
                                        </div>
                                    </div>
                                ))
                            )}
                        </div>
                    </section>

                    <section className="space-y-3">
                        <div className={`text-xs font-semibold uppercase tracking-[0.18em] ${isDark ? 'text-[#667085]' : 'text-[#98A2B3]'}`}>
                            模型偏好
                        </div>
                        <div className="grid gap-3 md:grid-cols-2">
                            <label className={`rounded-2xl p-3 ${isDark ? 'bg-[#161A22]' : 'bg-[#F8FAFC]'}`}>
                                <div className={`mb-2 text-sm font-medium ${isDark ? 'text-[#D0D5DD]' : 'text-[#344054]'}`}>LLM 润色模型</div>
                                <select value={modelPreference.textModel} onChange={(event) => setModelPreference({ ...modelPreference, textModel: event.target.value })} className={inputClass}>
                                    {modelOptions.text.map(model => <option key={model} value={model}>{model}</option>)}
                                </select>
                            </label>
                            <label className={`rounded-2xl p-3 ${isDark ? 'bg-[#161A22]' : 'bg-[#F8FAFC]'}`}>
                                <div className={`mb-2 text-sm font-medium ${isDark ? 'text-[#D0D5DD]' : 'text-[#344054]'}`}>图片模型</div>
                                <select value={modelPreference.imageModel} onChange={(event) => setModelPreference({ ...modelPreference, imageModel: event.target.value })} className={inputClass}>
                                    {modelOptions.image.map(model => <option key={model} value={model}>{model}</option>)}
                                </select>
                            </label>
                            <label className={`rounded-2xl p-3 ${isDark ? 'bg-[#161A22]' : 'bg-[#F8FAFC]'}`}>
                                <div className={`mb-2 text-sm font-medium ${isDark ? 'text-[#D0D5DD]' : 'text-[#344054]'}`}>视频模型</div>
                                <select value={modelPreference.videoModel} onChange={(event) => setModelPreference({ ...modelPreference, videoModel: event.target.value })} className={inputClass}>
                                    {modelOptions.video.map(model => <option key={model} value={model}>{model}</option>)}
                                </select>
                            </label>
                            <label className={`rounded-2xl p-3 ${isDark ? 'bg-[#161A22]' : 'bg-[#F8FAFC]'}`}>
                                <div className={`mb-2 text-sm font-medium ${isDark ? 'text-[#D0D5DD]' : 'text-[#344054]'}`}>Agent 模型</div>
                                <select value={modelPreference.agentModel} onChange={(event) => setModelPreference({ ...modelPreference, agentModel: event.target.value })} className={inputClass}>
                                    {modelOptions.agent.map(model => <option key={model} value={model}>{model}</option>)}
                                </select>
                            </label>
                        </div>
                    </section>
                </div>
            </div>
        </div>
    );
};
