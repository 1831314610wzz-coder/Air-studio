# MakingLovart

`MakingLovart` 是一个本地优先的 AI 创作白板原型，目标是做出接近 Lovart / Figma 式的创作体验：

- 左侧是 `Boards + Layers` 合并工作区
- 中间是无限白板
- 底部是主 Prompt 输入框
- 右侧是轻量生成面板与历史结果区

当前版本已经以白板创作为主，不再把节点工作流作为主入口。

## 当前能力

### 1. 白板与编辑

- 无限平移与缩放
- 图片、视频、文字、形状、箭头、线条、自由绘制
- 选择、移动、缩放、删除、复制、编组、图层重排
- 左侧 `Boards + Layers` 合并侧栏
- 撤销 / 重做

### 2. 底部主输入框

- 自适应高度输入区
- 向上弹出的纵向菜单
- `模式 / 模型 / LLM 润色 / 更多` 四组主操作
- 支持在输入框中用 `@` 引用白板元素
- 支持保存常用提示词

### 3. AI 能力

- `LLM 润色`
  - 可根据所选文本模型走不同 provider
- `图片生成`
  - Google `gemini / imagen`
  - OpenAI `dall-e-3`
  - Stability `sdxl`
- `视频生成`
  - 当前稳定支持 Google `veo`
- `首尾帧`
  - 已有模式入口
  - 还不是完整的专用双帧视频工作流

### 4. 右侧轻量面板

- 导入参考图
- 输入简洁描述后生成
- 自动保存历史生成结果到本地
- 历史结果支持直接拖回白板
- 素材区支持查看和拖拽已有素材

### 5. 主题模式

现已支持三种主题模式，并可在设置面板中切换：

- `浅色模式`
- `黑夜模式`
- `跟随系统`

这次更新后，原来那套“手动选择界面颜色 / 按钮颜色 / 画布颜色”的设置已经移除，改为统一主题系统。

### 6. 设置系统

- 语言切换
- 主题模式切换
- 滚轮行为切换
- API Key 管理
- 为单个 API Key 指定能力：
  - `LLM`
  - `图片`
  - `视频`
  - `Agent`
- 默认模型偏好：
  - 文本模型
  - 图片模型
  - 视频模型
  - Agent 模型

## 当前 UI 结构

### 左侧

- 顶部：`Boards`
- 底部：`Layers`
- 与工具栏联动滑动

### 中间

- 无限画布
- 多元素选择与基础编辑
- 底部主 PromptBar

### 右侧

- 参考图导入
- 轻量生成区
- 自动历史结果区

## 快速启动

### 环境要求

- Node.js 18+
- npm 9+

### 安装依赖

```bash
npm install
```

### 启动开发环境

```bash
npm run dev
```

如果本机端口有占用或权限限制，也可以显式指定：

```bash
npm run dev -- --host 127.0.0.1 --port 4173
```

### 构建

```bash
npm run build
```

### 预览构建结果

```bash
npm run preview
```

## API 配置方式

推荐直接在应用的设置面板中配置：

1. 启动项目
2. 打开设置
3. 新增 API Key
4. 勾选它支持的能力：`LLM / 图片 / 视频 / Agent`
5. 设置默认文本、图片、视频、Agent 模型

### 建议搭配

- `LLM 润色`：Google / OpenAI / Anthropic / Qwen
- `图片生成`：Google / OpenAI / Stability
- `视频生成`：Google
- `Agent`：Banana

## 当前边界

下面这些是当前版本的真实限制：

- 视频生成当前主要稳定支持 Google `veo`
- `首尾帧` 还不是完整专用流程
- 白板元素引用生成、参考图编辑、多元素组合生成，当前仍以 Google 路线最稳
- 项目级持久化还不完整，很多数据仍以本地浏览器存储为主
- 历史代码里仍有部分旧组件和乱码文案，仍在持续清理
- `App.tsx` 仍然偏大，后续还需要继续拆分

## 当前技术栈

- React 19
- TypeScript
- Vite 6
- 本地存储：`localStorage`
- AI 接入：
  - `geminiService.ts`
  - `bananaService.ts`
  - `aiGateway.ts`

## 目录概览

```text
.
|-- App.tsx
|-- index.tsx
|-- styles.css
|-- components/
|   |-- PromptBar.tsx
|   |-- RightPanel.tsx
|   |-- Toolbar.tsx
|   |-- WorkspaceSidebar.tsx
|   |-- CanvasSettings.tsx
|   `-- ...
|-- services/
|   |-- geminiService.ts
|   |-- bananaService.ts
|   `-- aiGateway.ts
|-- utils/
|   |-- assetStorage.ts
|   |-- generationHistory.ts
|   `-- fileUtils.ts
|-- types.ts
|-- translations.ts
`-- README.md
```

## 近期重点优化方向

- 把 `首尾帧` 做成完整的视频工作流
- 继续补齐多 provider 的能力路由与异常处理
- 进一步拆分 `App.tsx`
- 把更多本地数据从 `localStorage` 升级到更稳的持久化方案
- 继续清理旧文案和历史遗留组件

## 参考文档

- [REVIEW.md](./REVIEW.md)
- [CONTRIBUTING.md](./CONTRIBUTING.md)
- [DOCKER_GUIDE.md](./DOCKER_GUIDE.md)

## License

MIT
