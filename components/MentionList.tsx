/**
 * ============================================
 * @ 元素引用下拉菜单组件
 * ============================================
 *
 * 在用户输入 @ 时弹出，列出画布上所有可引用的元素。
 * 通过 forwardRef + useImperativeHandle 暴露导航/选择方法
 * 供 Tiptap suggestion 插件调用。
 */

import React, { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';

export interface MentionItem {
    id: string;
    label: string;
    thumbnail: string;
    elementType: string;
}

interface MentionListProps {
    items: MentionItem[];
    command: (item: MentionItem) => void;
}

export interface MentionListHandle {
    onKeyDown: (props: { event: KeyboardEvent }) => boolean;
}

const typeIcon: Record<string, string> = {
    image: '🖼',
    video: '🎬',
    shape: '⬜',
    text: '📝',
    path: '✏️',
    group: '📦',
    arrow: '➡️',
    line: '📏',
};

const MentionList = forwardRef<MentionListHandle, MentionListProps>(({ items, command }, ref) => {
    const [selectedIndex, setSelectedIndex] = useState(0);
    const containerRef = useRef<HTMLDivElement>(null);

    // 重置高亮
    useEffect(() => setSelectedIndex(0), [items]);

    // 滚动高亮项进入视图
    useEffect(() => {
        const el = containerRef.current?.querySelector<HTMLButtonElement>(
            `[data-index="${selectedIndex}"]`
        );
        el?.scrollIntoView({ block: 'nearest' });
    }, [selectedIndex]);

    const selectItem = (index: number) => {
        const item = items[index];
        if (item) command(item);
    };

    useImperativeHandle(ref, () => ({
        onKeyDown({ event }: { event: KeyboardEvent }) {
            if (event.key === 'ArrowUp') {
                setSelectedIndex(i => (i + items.length - 1) % items.length);
                return true;
            }
            if (event.key === 'ArrowDown') {
                setSelectedIndex(i => (i + 1) % items.length);
                return true;
            }
            if (event.key === 'Enter') {
                selectItem(selectedIndex);
                return true;
            }
            return false;
        },
    }));

    if (!items.length) {
        return (
            <div style={styles.container}>
                <div style={styles.empty}>画布上暂无元素</div>
            </div>
        );
    }

    return (
        <div style={styles.container} ref={containerRef}>
            <div style={styles.header}>引用画布元素</div>
            {items.map((item, index) => (
                <button
                    key={item.id}
                    data-index={index}
                    onClick={() => selectItem(index)}
                    style={{
                        ...styles.item,
                        ...(index === selectedIndex ? styles.itemActive : {}),
                    }}
                    onMouseEnter={() => setSelectedIndex(index)}
                >
                    {/* 缩略图 */}
                    <span style={styles.thumb}>
                        {item.thumbnail ? (
                            <img
                                src={item.thumbnail}
                                alt={item.label}
                                style={styles.thumbImg}
                            />
                        ) : (
                            <span style={styles.thumbFallback}>
                                {typeIcon[item.elementType] || '🔷'}
                            </span>
                        )}
                    </span>
                    {/* 名称 + 类型 */}
                    <span style={styles.info}>
                        <span style={styles.label}>{item.label}</span>
                        <span style={styles.type}>{item.elementType}</span>
                    </span>
                </button>
            ))}
        </div>
    );
});

MentionList.displayName = 'MentionList';
export default MentionList;

// ---- 样式 -------------------------------------------------------

const styles: Record<string, React.CSSProperties> = {
    container: {
        background: '#ffffff',
        border: '1px solid #e5e7eb',
        borderRadius: '10px',
        boxShadow: '0 8px 24px rgba(0,0,0,0.12)',
        padding: '4px',
        minWidth: '200px',
        maxWidth: '260px',
        maxHeight: '260px',
        overflowY: 'auto',
        zIndex: 9999,
    },
    header: {
        fontSize: '10px',
        fontWeight: 600,
        color: '#9ca3af',
        textTransform: 'uppercase',
        letterSpacing: '0.05em',
        padding: '4px 8px 2px',
    },
    item: {
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        width: '100%',
        padding: '5px 8px',
        border: 'none',
        borderRadius: '6px',
        background: 'transparent',
        cursor: 'pointer',
        textAlign: 'left',
        transition: 'background 0.1s',
    },
    itemActive: {
        background: 'rgba(99, 102, 241, 0.1)',
    },
    thumb: {
        flexShrink: 0,
        width: '28px',
        height: '28px',
        borderRadius: '4px',
        overflow: 'hidden',
        background: '#f3f4f6',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
    },
    thumbImg: {
        width: '100%',
        height: '100%',
        objectFit: 'cover',
    },
    thumbFallback: {
        fontSize: '16px',
        lineHeight: 1,
    },
    info: {
        display: 'flex',
        flexDirection: 'column',
        minWidth: 0,
    },
    label: {
        fontSize: '13px',
        fontWeight: 500,
        color: '#111827',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
    },
    type: {
        fontSize: '11px',
        color: '#9ca3af',
        textTransform: 'capitalize',
    },
    empty: {
        padding: '10px 12px',
        fontSize: '13px',
        color: '#9ca3af',
    },
};
