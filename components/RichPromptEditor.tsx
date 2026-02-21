/**
 * ============================================
 * 富文本提示词编辑器（带 @ 元素引用）
 * ============================================
 *
 * 基于 Tiptap + 自定义 CanvasMentionNode 实现。
 * 用户在任意位置输入 @ 即弹出画布元素选择菜单；
 * 选中后以带缩略图的徽章形式嵌入编辑器。
 *
 * 对外暴露：
 *  - onTextChange(plainText, editorJSON)  —— 内容变化回调
 *  - onSubmit()                           —— Enter 触发生成
 *  - canvasItems                          —— 来自父组件的画布元素列表
 */

import React, {
    useEffect,
    useImperativeHandle,
    forwardRef,
    useRef,
    useCallback,
} from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { Extension } from '@tiptap/core';
import { Suggestion } from '@tiptap/suggestion';
import tippy, { type Instance as TippyInstance } from 'tippy.js';
import 'tippy.js/dist/tippy.css';
import ReactDOM from 'react-dom/client';
import MentionList, { type MentionItem, type MentionListHandle } from './MentionList';
import { CanvasMentionNode, extractMentions, editorJSONToText } from './CanvasMentionExtension';
import type { MentionData } from './CanvasMentionExtension';

// ---- Suggestion 扩展配置 ----------------------------------------

function buildSuggestionExtension(getItems: (query: string) => MentionItem[]) {
    return Extension.create({
        name: 'canvasMentionSuggestion',
        addProseMirrorPlugins() {
            return [
                Suggestion({
                    editor: this.editor,
                    char: '@',
                    allowSpaces: false,
                    items: ({ query }) => getItems(query),

                    render() {
                        let reactRoot: ReactDOM.Root | null = null;
                        let container: HTMLElement | null = null;
                        let popup: TippyInstance[] | null = null;
                        let componentRef: React.RefObject<MentionListHandle> = React.createRef();

                        return {
                            onStart(props) {
                                container = document.createElement('div');
                                document.body.appendChild(container);

                                componentRef = React.createRef<MentionListHandle>();
                                reactRoot = ReactDOM.createRoot(container);
                                reactRoot.render(
                                    <MentionList
                                        ref={componentRef}
                                        items={props.items as MentionItem[]}
                                        command={props.command}
                                    />
                                );

                                popup = tippy('body', {
                                    getReferenceClientRect: props.clientRect as () => DOMRect,
                                    appendTo: () => document.body,
                                    content: container,
                                    showOnCreate: true,
                                    interactive: true,
                                    trigger: 'manual',
                                    placement: 'bottom-start',
                                    theme: 'light-border',
                                    arrow: false,
                                    offset: [0, 4],
                                    zIndex: 9999,
                                    popperOptions: {
                                        modifiers: [
                                            { name: 'flip', enabled: true },
                                            { name: 'preventOverflow', enabled: true },
                                        ],
                                    },
                                });
                            },

                            onUpdate(props) {
                                reactRoot?.render(
                                    <MentionList
                                        ref={componentRef}
                                        items={props.items as MentionItem[]}
                                        command={props.command}
                                    />
                                );
                                if (popup?.[0] && props.clientRect) {
                                    popup[0].setProps({
                                        getReferenceClientRect: props.clientRect as () => DOMRect,
                                    });
                                }
                            },

                            onKeyDown(props) {
                                if (props.event.key === 'Escape') {
                                    popup?.[0]?.hide();
                                    return true;
                                }
                                return componentRef.current?.onKeyDown(props) ?? false;
                            },

                            onExit() {
                                popup?.[0]?.destroy();
                                popup = null;
                                setTimeout(() => {
                                    reactRoot?.unmount();
                                    container?.remove();
                                }, 0);
                            },
                        };
                    },

                    command({ editor, range, props }) {
                        const item = props as MentionItem;
                        editor
                            .chain()
                            .focus()
                            .deleteRange(range)
                            .insertContent({
                                type: 'canvasMention',
                                attrs: {
                                    id: item.id,
                                    label: item.label,
                                    thumbnail: item.thumbnail,
                                    elementType: item.elementType,
                                },
                            })
                            .insertContent(' ')
                            .run();
                    },
                }),
            ];
        },
    });
}

// ---- 对外暴露的 handle 类型 -------------------------------------

export interface RichPromptEditorHandle {
    /** 清空编辑器内容 */
    clear: () => void;
    /** 聚焦到编辑器末尾 */
    focus: () => void;
    /** 获取编辑器 JSON（用于提取 mentions） */
    getJSON: () => Record<string, unknown>;
    /** 获取纯文本 */
    getText: () => string;
    /** 获取所有 @引用的元素数据 */
    getMentions: () => MentionData[];
}

// ---- 组件 Props 定义 -------------------------------------------

export interface RichPromptEditorProps {
    canvasItems: MentionItem[];
    placeholder?: string;
    disabled?: boolean;
    onTextChange?: (plainText: string, json: Record<string, unknown>) => void;
    onSubmit?: () => void;
    initialText?: string;
}

// ---- 主组件 ----------------------------------------------------

const RichPromptEditor = forwardRef<RichPromptEditorHandle, RichPromptEditorProps>(
    ({ canvasItems, placeholder = '输入提示词，@ 引用画布元素...', disabled, onTextChange, onSubmit, initialText }, ref) => {
        // 用 ref 保存 canvasItems，避免 suggestion 闭包拿到旧值
        const canvasItemsRef = useRef(canvasItems);
        useEffect(() => {
            canvasItemsRef.current = canvasItems;
        }, [canvasItems]);

        const getFilteredItems = useCallback((query: string): MentionItem[] => {
            const q = query.toLowerCase();
            return canvasItemsRef.current.filter(
                item =>
                    item.label.toLowerCase().includes(q) ||
                    item.elementType.toLowerCase().includes(q)
            );
        }, []);

        const editor = useEditor({
            extensions: [
                StarterKit.configure({
                    // 禁用不需要的 marks
                    bold: false,
                    italic: false,
                    strike: false,
                    code: false,
                    blockquote: false,
                    heading: false,
                    codeBlock: false,
                    bulletList: false,
                    orderedList: false,
                    listItem: false,
                    horizontalRule: false,
                }),
                CanvasMentionNode,
                buildSuggestionExtension(getFilteredItems),
            ],
            content: initialText ? `<p>${initialText}</p>` : '<p></p>',
            editable: !disabled,
            editorProps: {
                attributes: {
                    class: 'rich-prompt-editor',
                    spellcheck: 'false',
                },
                handleKeyDown(_, event) {
                    if (event.key === 'Enter' && !event.shiftKey) {
                        event.preventDefault();
                        onSubmit?.();
                        return true;
                    }
                    return false;
                },
            },
            onUpdate({ editor }) {
                const json = editor.getJSON() as Record<string, unknown>;
                const text = editorJSONToText(json);
                onTextChange?.(text, json);
            },
        });

        // 对外暴露方法
        useImperativeHandle(ref, () => ({
            clear() {
                editor?.commands.clearContent(true);
            },
            focus() {
                editor?.commands.focus('end');
            },
            getJSON() {
                return (editor?.getJSON() ?? {}) as Record<string, unknown>;
            },
            getText() {
                const json = editor?.getJSON() as Record<string, unknown> | undefined;
                return json ? editorJSONToText(json) : '';
            },
            getMentions() {
                const json = editor?.getJSON() as Record<string, unknown> | undefined;
                return json ? extractMentions(json) : [];
            },
        }));

        // disabled 变化时同步
        useEffect(() => {
            editor?.setEditable(!disabled);
        }, [disabled, editor]);

        return (
            <>
                <style>{editorStyles(placeholder)}</style>
                <EditorContent editor={editor} />
            </>
        );
    }
);

RichPromptEditor.displayName = 'RichPromptEditor';
export default RichPromptEditor;

// ---- 编辑器 CSS ------------------------------------------------

function editorStyles(placeholder: string): string {
    return `
.rich-prompt-editor {
    flex: 1;
    min-height: 22px;
    max-height: 96px;
    overflow-y: auto;
    outline: none;
    font-size: 14px;
    line-height: 1.5;
    color: #111827;
    caret-color: #4F46E5;
    padding: 0 6px;
    word-break: break-word;
    background: transparent;
}

.rich-prompt-editor p {
    margin: 0;
    padding: 0;
}

.rich-prompt-editor:empty:before,
.rich-prompt-editor p:first-child:empty:before {
    content: attr(data-placeholder);
    color: #9ca3af;
    pointer-events: none;
}

/* tippy 轻边框主题 */
.tippy-box[data-theme~='light-border'] {
    background-color: transparent;
    box-shadow: none;
    border: none;
    padding: 0;
}
.tippy-box[data-theme~='light-border'] .tippy-content {
    padding: 0;
}

/* 滚动条美化 */
.rich-prompt-editor::-webkit-scrollbar {
    width: 3px;
}
.rich-prompt-editor::-webkit-scrollbar-thumb {
    background: #e5e7eb;
    border-radius: 2px;
}
`;
}
