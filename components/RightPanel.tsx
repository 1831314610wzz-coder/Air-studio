import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { AssetCategory, AssetItem, AssetLibrary, ChatAttachment, GenerationHistoryItem } from '../types';

type RightPanelTab = 'generate' | 'inspiration';

interface RightPanelProps {
    theme: 'light' | 'dark';
    isMinimized: boolean;
    onToggleMinimize: () => void;
    outerGap: number;
    defaultWidth: number;
    minWidth: number;
    widthCap: number;
    compactMode: boolean;
    library: AssetLibrary;
    generationHistory: GenerationHistoryItem[];
    attachments: ChatAttachment[];
    onRemove: (category: AssetCategory, id: string) => void;
    onRename: (category: AssetCategory, id: string, name: string) => void;
    onGenerate: (prompt: string) => void;
    onAddAttachments: (files: FileList | File[]) => void;
    onRemoveAttachment: (id: string) => void;
    onWidthChange?: (width: number) => void;
}

const CATEGORY_LABELS: Record<AssetCategory, string> = {
    character: '角色',
    scene: '场景',
    prop: '道具',
};

const CategoryTabs: React.FC<{ value: AssetCategory; onChange: (c: AssetCategory) => void }> = ({ value, onChange }) => (
    <div className="inline-flex rounded-2xl bg-neutral-100 p-1">
        {(Object.keys(CATEGORY_LABELS) as AssetCategory[]).map(category => (
            <button
                key={category}
                type="button"
                onClick={() => onChange(category)}
                className={`rounded-2xl px-3 py-1.5 text-xs transition-all ${
                    value === category ? 'bg-white text-neutral-900 shadow-sm' : 'text-neutral-500 hover:text-neutral-800'
                }`}
            >
                {CATEGORY_LABELS[category]}
            </button>
        ))}
    </div>
);

const EmptyHistory: React.FC = () => (
    <div className="flex flex-1 items-center justify-center rounded-[24px] border border-dashed border-neutral-200 bg-neutral-50 px-6 py-10 text-center">
        <div>
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-white text-neutral-300 shadow-sm">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                    <rect x="3" y="3" width="18" height="18" rx="3" />
                    <circle cx="8.5" cy="8.5" r="1.5" />
                    <path d="M21 15l-5-5L5 21" />
                </svg>
            </div>
            <p className="mt-4 text-sm font-medium text-neutral-700">还没有历史生成内容</p>
            <p className="mt-1 text-xs text-neutral-500">新的图片生成后会自动保存到本地，并显示在这里。</p>
        </div>
    </div>
);

export const RightPanel: React.FC<RightPanelProps> = ({
    theme,
    isMinimized,
    onToggleMinimize,
    outerGap,
    defaultWidth,
    minWidth,
    widthCap,
    compactMode,
    library,
    generationHistory,
    attachments,
    onRemove,
    onRename,
    onGenerate,
    onAddAttachments,
    onRemoveAttachment,
    onWidthChange,
}) => {
    const isDark = theme === 'dark';
    const [viewportWidth, setViewportWidth] = useState(() => window.innerWidth);
    const [activeTab, setActiveTab] = useState<RightPanelTab>('generate');
    const [category, setCategory] = useState<AssetCategory>('character');
    const [editingId, setEditingId] = useState<string | null>(null);
    const [editingName, setEditingName] = useState('');
    const [prompt, setPrompt] = useState('');
    const [panelWidth, setPanelWidth] = useState(() => {
        const saved = localStorage.getItem('rightPanelWidth');
        return saved ? parseInt(saved, 10) : defaultWidth;
    });
    const [isResizing, setIsResizing] = useState(false);
    const [resizeStartX, setResizeStartX] = useState(0);
    const [resizeStartWidth, setResizeStartWidth] = useState(380);

    const editInputRef = useRef<HTMLInputElement>(null);
    const promptInputRef = useRef<HTMLTextAreaElement>(null);

    const items = useMemo(() => library[category], [category, library]);

    useEffect(() => {
        const handleResize = () => setViewportWidth(window.innerWidth);
        window.addEventListener('resize', handleResize);
        return () => window.removeEventListener('resize', handleResize);
    }, []);

    useEffect(() => {
        const maxWidth = Math.min(widthCap, viewportWidth - outerGap * 2);
        const safeMinWidth = Math.min(minWidth, maxWidth);
        setPanelWidth(prev => {
            const candidate = Number.isNaN(prev) ? defaultWidth : prev;
            return Math.min(maxWidth, Math.max(safeMinWidth, candidate));
        });
    }, [defaultWidth, minWidth, outerGap, viewportWidth, widthCap]);

    useEffect(() => {
        localStorage.setItem('rightPanelWidth', panelWidth.toString());
    }, [panelWidth]);

    useEffect(() => {
        onWidthChange?.(isMinimized ? 2 : panelWidth);
    }, [isMinimized, onWidthChange, panelWidth]);

    useEffect(() => {
        if (!isResizing) return;

        const handlePointerMove = (event: PointerEvent) => {
            const dx = resizeStartX - event.clientX;
            const nextMinWidth = Math.min(minWidth, widthCap, window.innerWidth - outerGap * 2);
            const maxWidth = Math.min(widthCap, window.innerWidth - outerGap * 2);
            setPanelWidth(Math.min(maxWidth, Math.max(nextMinWidth, resizeStartWidth + dx)));
        };

        const handlePointerUp = () => setIsResizing(false);

        window.addEventListener('pointermove', handlePointerMove);
        window.addEventListener('pointerup', handlePointerUp);
        return () => {
            window.removeEventListener('pointermove', handlePointerMove);
            window.removeEventListener('pointerup', handlePointerUp);
        };
    }, [isResizing, minWidth, outerGap, resizeStartWidth, resizeStartX, widthCap]);

    useEffect(() => {
        if (editingId && editInputRef.current) {
            editInputRef.current.focus();
            editInputRef.current.select();
        }
    }, [editingId]);

    useEffect(() => {
        const textarea = promptInputRef.current;
        if (!textarea) return;
        textarea.style.height = '0px';
        textarea.style.height = `${Math.min(168, Math.max(88, textarea.scrollHeight))}px`;
    }, [prompt]);

    const handleResizePointerDown = (event: React.PointerEvent) => {
        if (event.pointerType === 'mouse' && event.button !== 0) return;
        setIsResizing(true);
        setResizeStartX(event.clientX);
        setResizeStartWidth(panelWidth);
        event.stopPropagation();
        event.preventDefault();
    };

    const handleGenerate = () => {
        const nextPrompt = prompt.trim();
        if (!nextPrompt) return;
        onGenerate(nextPrompt);
        setPrompt('');
    };

    const handleLibraryDragStart = (event: React.DragEvent, item: AssetItem) => {
        const payload = JSON.stringify({ __makingAsset: true, item });
        event.dataTransfer.setData('application/x-making-asset', payload);
        event.dataTransfer.setData('text/plain', payload);
        event.dataTransfer.effectAllowed = 'copy';
    };

    const handleHistoryDragStart = (event: React.DragEvent, item: GenerationHistoryItem) => {
        const payload = JSON.stringify({
            __makingAsset: true,
            item: {
                id: item.id,
                name: item.name || 'Generated',
                category: 'scene',
                dataUrl: item.originalDataUrl || item.dataUrl,
                mimeType: item.mimeType,
                width: item.width,
                height: item.height,
                createdAt: item.createdAt,
            },
        });
        event.dataTransfer.setData('application/x-making-asset', payload);
        event.dataTransfer.setData('text/plain', payload);
        event.dataTransfer.effectAllowed = 'copy';
    };

    const handleDoubleClick = (item: AssetItem) => {
        setEditingId(item.id);
        setEditingName(item.name || '');
    };

    const handleSaveEdit = (itemId: string) => {
        if (editingId === itemId && editingName.trim()) {
            onRename(category, itemId, editingName.trim());
        }
        setEditingId(null);
        setEditingName('');
    };

    const formatTime = (timestamp: number) =>
        new Date(timestamp).toLocaleString('zh-CN', {
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
        });

    return (
        <>
            <button
                type="button"
                onClick={onToggleMinimize}
                style={{
                    top: `${outerGap}px`,
                    right: `${outerGap}px`,
                    opacity: isMinimized ? 1 : 0,
                    pointerEvents: isMinimized ? 'auto' : 'none',
                    transition: 'opacity 0.2s ease-out, transform 0.28s ease-out',
                    transform: isMinimized ? 'translateY(0)' : 'translateY(-6px)',
                }}
                className={`theme-aware fixed z-20 flex h-10 w-10 items-center justify-center rounded-xl border shadow-lg ${
                    isDark ? 'border-[#2A3140] bg-[#12151B] text-[#98A2B3] hover:text-white' : 'border-neutral-200 bg-white text-neutral-600 hover:text-neutral-900'
                }`}
                title="打开侧边栏"
            >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <rect x="3" y="3" width="18" height="18" rx="2" />
                    <path d="M15 3v18" />
                </svg>
            </button>

            <div
                style={{
                    top: `${outerGap}px`,
                    bottom: `${outerGap}px`,
                    right: `${outerGap}px`,
                    width: `${panelWidth}px`,
                    transform: isMinimized ? 'translateX(18px) scale(0.96)' : 'translateX(0) scale(1)',
                    transformOrigin: 'right center',
                    opacity: isMinimized ? 0 : 1,
                    transition: 'transform 0.35s cubic-bezier(0.4, 0, 0.2, 1), opacity 0.25s ease-out, width 0.25s ease-out',
                    pointerEvents: isMinimized ? 'none' : 'auto',
                }}
                className={`compact-right-panel theme-aware fixed z-[30] flex flex-col overflow-hidden border shadow-2xl backdrop-blur-xl ${
                    compactMode ? 'rounded-[24px]' : 'rounded-[28px]'
                } ${isDark ? 'border-[#2A3140] bg-[#12151B]/96' : 'border-neutral-200/60 bg-white/96'}`}
            >
                <div
                    className={`absolute left-0 top-0 z-10 h-full cursor-ew-resize transition-colors hover:bg-blue-400/70 ${compactMode ? 'w-1' : 'w-1.5'}`}
                    onPointerDown={handleResizePointerDown}
                />

                <div className={`flex items-center justify-between border-b border-neutral-200 ${compactMode ? 'px-3 py-2.5' : 'px-4 py-3'}`}>
                    <div className={`flex items-center ${compactMode ? 'gap-1.5' : 'gap-2'}`}>
                        <button
                            type="button"
                            onClick={() => setActiveTab('generate')}
                            className={`rounded-xl ${compactMode ? 'px-2.5 py-1.5 text-[13px]' : 'px-3 py-1.5 text-sm'} transition-all ${
                                activeTab === 'generate' ? 'bg-neutral-900 text-white' : 'text-neutral-600 hover:bg-neutral-100'
                            }`}
                        >
                            生成
                        </button>
                        <button
                            type="button"
                            onClick={() => setActiveTab('inspiration')}
                            className={`rounded-xl ${compactMode ? 'px-2.5 py-1.5 text-[13px]' : 'px-3 py-1.5 text-sm'} transition-all ${
                                activeTab === 'inspiration' ? 'bg-neutral-900 text-white' : 'text-neutral-600 hover:bg-neutral-100'
                            }`}
                        >
                            素材库
                        </button>
                    </div>
                    <button
                        type="button"
                        onClick={onToggleMinimize}
                        className={`rounded-xl border border-neutral-200 ${compactMode ? 'p-2' : 'p-2.5'} text-neutral-500 transition-colors hover:bg-neutral-100 hover:text-neutral-900`}
                        title="收起"
                    >
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <rect x="3" y="3" width="18" height="18" rx="3" />
                            <path d="M19 12H5" />
                        </svg>
                    </button>
                </div>

                <div className="min-h-0 flex-1 overflow-hidden">
                    {activeTab === 'generate' && (
                        <div className={`flex h-full min-h-0 flex-col ${compactMode ? 'gap-3 p-3' : 'gap-4 p-4'}`}>
                            <div className={`relative rounded-[26px] border border-neutral-200 bg-neutral-50 ${compactMode ? 'p-3.5' : 'p-4'} shadow-[inset_0_1px_0_rgba(255,255,255,0.8)]`}>
                                <textarea
                                    ref={promptInputRef}
                                    value={prompt}
                                    onChange={event => setPrompt(event.target.value)}
                                    placeholder="Type prompt here. Add reference images from the bottom prompt bar."
                                    className={`w-full resize-none border-none bg-transparent px-1 py-1 text-neutral-800 outline-none placeholder:text-neutral-400 ${compactMode ? 'min-h-[88px] text-[14px] leading-6' : 'min-h-[96px] text-[15px] leading-7'}`}
                                />

                                <div className={`mt-4 flex items-center justify-between gap-3 ${compactMode ? 'flex-col items-stretch' : ''}`}>
                                    <div className="text-xs text-neutral-500">
                                        Right panel is text-only. Add references in the bottom prompt bar.
                                    </div>

                                    <button
                                        type="button"
                                        onClick={handleGenerate}
                                        disabled={!prompt.trim()}
                                        className={`flex items-center justify-center rounded-full bg-neutral-900 text-white transition-colors hover:bg-neutral-700 disabled:cursor-not-allowed disabled:bg-neutral-300 ${compactMode ? 'w-full px-4 py-2.5 text-sm' : 'px-4 py-2 text-sm'}`}
                                    >
                                        Generate
                                    </button>
                                </div>
                            </div>

                            <div className="flex min-h-0 flex-1 flex-col">
                                <div className="mb-3 flex items-center justify-between">
                                    <div>
                                        <h3 className="text-sm font-semibold text-neutral-900">历史生成</h3>
                                        <p className="mt-1 text-xs text-neutral-500">自动保存到本地，可直接拖到白板。</p>
                                    </div>
                                    <span className="rounded-full bg-neutral-100 px-2.5 py-1 text-[11px] text-neutral-500">
                                        {generationHistory.length} 条
                                    </span>
                                </div>

                                <div className="min-h-0 flex-1 overflow-y-auto pr-1">
                                    {generationHistory.length === 0 ? (
                                        <EmptyHistory />
                                    ) : (
                                        <div className={`grid ${compactMode ? 'grid-cols-1 gap-2.5' : 'grid-cols-2 gap-3'}`}>
                                            {generationHistory.map(item => (
                                                <div
                                                    key={item.id}
                                                    className="group cursor-grab rounded-[22px] border border-neutral-200 bg-white p-2 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md active:cursor-grabbing"
                                                    draggable
                                                    onDragStart={event => handleHistoryDragStart(event, item)}
                                                >
                                                    <div className="overflow-hidden rounded-[16px] bg-neutral-100">
                                                        <img
                                                            src={item.dataUrl}
                                                            alt={item.name || item.prompt}
                                                            className={`w-full object-cover ${compactMode ? 'aspect-[4/3]' : 'aspect-square'}`}
                                                        />
                                                    </div>
                                                    <div className="px-1 pb-1 pt-2">
                                                        <p className="line-clamp-2 text-xs font-medium leading-5 text-neutral-800">
                                                            {item.name || item.prompt}
                                                        </p>
                                                        <div className="mt-2 flex items-center justify-between text-[11px] text-neutral-400">
                                                            <span>{item.width}×{item.height}</span>
                                                            <span>{formatTime(item.createdAt)}</span>
                                                        </div>
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>
                    )}

                    {activeTab === 'inspiration' && (
                        <div className="flex h-full min-h-0 flex-col">
                            <div className={`flex items-center justify-between border-b border-neutral-200 ${compactMode ? 'px-3 py-2.5' : 'px-4 py-3'}`}>
                                <CategoryTabs value={category} onChange={setCategory} />
                                <span className="text-xs text-neutral-500">{items.length} 项</span>
                            </div>

                            <div className={`min-h-0 flex-1 overflow-y-auto ${compactMode ? 'p-2.5' : 'p-3'}`}>
                                {items.length === 0 ? (
                                    <div className="flex h-full items-center justify-center text-neutral-400">
                                        <div className="text-center">
                                            <svg className="mx-auto mb-3 h-16 w-16 opacity-20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                                                <rect x="3" y="7" width="7" height="10" rx="1" />
                                                <rect x="14" y="4" width="7" height="16" rx="1" />
                                            </svg>
                                            <p className="text-sm">暂无{CATEGORY_LABELS[category]}</p>
                                            <p className="mt-1 text-xs">可把历史生成内容拖到白板，或稍后继续扩展素材库。</p>
                                        </div>
                                    </div>
                                ) : (
                                    <div className={compactMode ? 'space-y-2.5' : 'columns-2 gap-3'}>
                                        {items.map(item => (
                                            <div
                                                key={item.id}
                                                className={`group relative break-inside-avoid overflow-hidden border border-neutral-200 bg-neutral-50 transition-all hover:shadow-md ${compactMode ? 'rounded-[18px]' : 'mb-3 inline-block w-full rounded-lg'}`}
                                                draggable
                                                onDragStart={event => handleLibraryDragStart(event, item)}
                                            >
                                                <img src={item.dataUrl} alt={item.name || ''} className="w-full bg-neutral-50 object-contain" />

                                                {editingId === item.id ? (
                                                    <div className="absolute inset-x-2 bottom-2 flex items-center gap-2">
                                                        <input
                                                            ref={editInputRef}
                                                            type="text"
                                                            value={editingName}
                                                            onChange={event => setEditingName(event.target.value)}
                                                            onBlur={() => handleSaveEdit(item.id)}
                                                            onKeyDown={event => {
                                                                if (event.key === 'Enter') {
                                                                    event.preventDefault();
                                                                    handleSaveEdit(item.id);
                                                                } else if (event.key === 'Escape') {
                                                                    setEditingId(null);
                                                                    setEditingName('');
                                                                }
                                                            }}
                                                            className="min-w-0 flex-1 rounded-lg border border-blue-400 bg-white/95 px-2 py-1 text-xs outline-none shadow-lg"
                                                            placeholder="输入名称"
                                                            aria-label="素材名称"
                                                            title="素材名称"
                                                        />
                                                    </div>
                                                ) : (
                                                    <div className="pointer-events-none absolute inset-0 opacity-0 transition-opacity group-hover:opacity-100">
                                                        <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/30 to-transparent" />
                                                        <div className="absolute bottom-2 left-2 right-2 flex items-end justify-between gap-2 text-white">
                                                            <div className="pointer-events-auto min-w-0 cursor-text" onDoubleClick={() => handleDoubleClick(item)}>
                                                                <div className="truncate text-xs font-medium">{item.name || '未命名'}</div>
                                                                <div className="text-[10px] opacity-80">{item.width}×{item.height}</div>
                                                            </div>
                                                            <button
                                                                type="button"
                                                                className="pointer-events-auto rounded-lg bg-white/10 p-1 backdrop-blur transition-colors hover:bg-white/20"
                                                                title="删除"
                                                                onClick={event => {
                                                                    event.stopPropagation();
                                                                    onRemove(category, item.id);
                                                                }}
                                                            >
                                                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="text-white">
                                                                    <polyline points="3 6 5 6 21 6" />
                                                                    <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                                                                    <path d="M10 11v6" />
                                                                    <path d="M14 11v6" />
                                                                </svg>
                                                            </button>
                                                        </div>
                                                    </div>
                                                )}
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </>
    );
};
