# PRD: UI 紧凑化重构 & 功能优化

## 版本：v1.1.0
## 日期：2026-03-16

---

## 一、背景与目标

当前 MakingLovart 的 UI 存在以下视觉与交互问题：

1. **整体尺寸偏大** — 按钮、间距、输入框等都偏大，不够紧凑
2. **左侧工具栏过宽** — 贴近两边边缘，视觉压迫感强
3. **@Mention 标签样式粗糙** — inline badge 和下拉菜单风格不够精致
4. **底部输入框（PromptBar）过大** — textarea 区域、按钮、padding 占用过多屏幕空间
5. **左右面板展开时输入框被挤压** — paddingLeft 计算不够灵活，遮挡左边面板
6. **@多图片引用 → API 调用链路不完整** — 需要支持「@图片1 和 @图片2 生成新视频」的完整端到端逻辑
7. **README 文档不专业** — 缺少中英文双语、演示截图、标准开源格式

## 二、改动清单（7 个任务）

### Task 1：Toolbar 紧凑化 (80% 缩放)
**文件**: `components/Toolbar.tsx`

| 属性 | 改前 | 改后 |
|---|---|---|
| 按钮尺寸 | `h-11 w-11` | `h-9 w-9` |
| 图标尺寸 | `width="19"` / `width="18"` | `width="16"` / `width="15"` |
| 外壳 padding | `px-3 py-2` | `px-2 py-1.5` |
| 外壳圆角 | `rounded-[28px]` | `rounded-[22px]` |
| 分隔线 | `h-8` | `h-6` |
| 颜色选择器 | `h-11 w-11` / `h-7 w-7` | `h-9 w-9` / `h-5 w-5` |
| 线宽显示 | `min-w-[54px]` | `min-w-[46px]` |

### Task 2：PromptBar 紧凑化 (80% 缩放)
**文件**: `components/PromptBar.tsx`

| 属性 | 改前 | 改后 |
|---|---|---|
| textarea 最小高度 | `min-h-[128px]` | `min-h-[56px]` |
| textarea 字号 | `text-[20px] leading-8` | `text-[15px] leading-6` |
| 外壳圆角 | `rounded-[30px]` | `rounded-[22px]` |
| 内部 padding | `px-5 pt-5` | `px-4 pt-3` |
| 底栏 padding | `px-4 py-4` | `px-3 py-2.5` |
| trigger 按钮高度 | `h-11` | `h-9` |
| 生成按钮 | `h-12 min-w-[88px]` | `h-10 min-w-[76px]` |
| 附件/引用卡片 | `h-12 w-12` | `h-9 w-9` |
| popoverCard 圆角 | `rounded-[22px]` | `rounded-[18px]` |

### Task 3：PromptBar 左右面板适配
**文件**: `App.tsx`

- 输入框容器 `paddingLeft` 在面板展开时使用更小值（从 288px → 260px）
- 输入框宽度从 `w-[90%]` 调整为 `w-full`，让 padding 自适应

### Task 4：@Mention 标签精致化
**文件**: `components/CanvasMentionExtension.tsx`, `components/MentionList.tsx`

- Mention badge: 缩小尺寸、更精致的配色、更小的缩略图 (18px → 14px)
- MentionList dropdown: 更紧凑的 item 间距、更小的缩略图 (28px → 22px)

### Task 5：RichPromptEditor 紧凑化
**文件**: `components/RichPromptEditor.tsx`

- CSS 变量默认值: min-height 28→24px, font-size 15→14px
- 编辑器整体更紧凑

### Task 6：@多图引用 → API 生成逻辑完善
**文件**: `App.tsx` (handleGenerate)

- 当前 `mentionedImageElements` 已经收集了 @引用的图片
- 需确认在视频生成路径中也传入这些引用图片
- 确保 prompt 文本中的 @标签被正确替换为描述文本

### Task 7：README 中英文双语重写
**文件**: `README.md`

- 专业开源 README 格式
- 中英文双语
- 附演示截图 `displayphoto0.png`
- 功能特性、快速启动、技术栈、贡献指南等完整章节

---

## 三、验收标准

1. 所有 UI 元素视觉缩小约 80%，紧凑但不拥挤
2. 工具栏两侧有足够呼吸空间
3. @Mention 标签小巧精致
4. 底部输入框小巧，不超过屏幕高度 15%
5. 左右面板展开时输入框不被遮挡
6. 在输入框中「@图片1 和 @图片2 生成新视频」可正确将引用图片传递到 API
7. README 包含英文+中文双语，附演示截图
