# ChatBeaty

一款面向 **Windows** 与 **Android** 的极简高颜值 AI 学习聊天客户端，专注 **ChatGPT 网页端级别的公式、矢量图解与交互式学习渲染体验**。

---

## 核心特性

### 1. 多厂商原生协议 & 零 CORS 流式调用
- **OpenAI Chat Completions** (`/chat/completions`)：支持标准流式输出及 DeepSeek R1 等 `reasoning_content` 思考过程。
- **OpenAI Responses API** (`/responses`)：原生解析 `output_text.delta`、`reasoning_summary_text.delta` 与推理强度（`reasoning.effort`）。
- **Google Gemini API** (`streamGenerateContent?alt=sse`)：原生支持 `systemInstruction` 与 Gemini Thinking 思考块。
- **Anthropic Messages API** (`/v1/messages`)：原生支持 Extended Thinking（`thinking_delta`）与精确流式输出。
- **零跨域限制**：桌面端通过 Electron 主进程 IPC 转发，Android 端通过原生 Java `NativeStreamPlugin` 直接发起 `HttpURLConnection` 流式请求，兼容各类自定义 Base URL 与中转站。
- **多模态接口预留**：消息数据模型与适配器接口从底层采用多模态 Block 结构，已预留识图（Vision）、生图（ImageGen）、语音转写/合成（STT/TTS）接口契约。

### 2. ChatGPT 网页级学术渲染引擎
- **公式排版（KaTeX + mhchem）**：自动规范 `$...$`、`$$...$$`、`\( ... \)`、`\[ ... \]` 与裸 `\begin{aligned}`/`\begin{cases}`，支持化学方程式 `\ce{...}`，流式输出不闪烁，点击任意公式可放大查看并一键复制 LaTeX 源码。
- **矢量原理图（内联 SVG 图卡）**：模型输出 `svg` 代码块经 DOMPurify 安全清洗并自动适配 OLED 纯黑/暗色/亮色主题配色，支持点击全屏缩放拖拽、导出 SVG 与 2x 高清 PNG。
- **流程图与函数图表**：内置 **Mermaid**（流程图/时序图/状态图/思维导图）与离线 **ECharts**（数学函数曲线/数据对比图）。
- **交互式原理沙盒**：支持 `html-preview` / `interactive` 自包含 HTML/Canvas/JS 在安全隔离 `<iframe sandbox="allow-scripts">` 中实时交互运行。
- **阅读增强**：思考过程折叠卡片、Shiki 专业代码高亮、GitHub 风格 Callouts（`[!TIP]` / `[!IMPORTANT]` / `[!WARNING]`）与可复制表格。

### 3. 可编辑双层提示词系统
- **全局视觉与学术渲染增强协议**：独立开关与可实时编辑，教导模型规范输出公式与 SVG 原理图。
- **多套学习人设预设**：内置「深度理工学习导师」「可视化直觉大师」「全栈工程与算法导师」等预设，支持自由修改、新建与按会话切换。

### 4. 极简美学与高度自定义
- **界面主题**：OLED 纯黑（默认）、柔和深灰、极简亮色、跟随系统，支持自定义强调色与全局 CSS 注入。
- **排版校准**：正文字号、行高、KaTeX 公式独立缩放比例、正文最大栏宽、字体风格自由调节。
- **本地优先 + WebDAV 预留**：全部数据存储在本地 IndexedDB，支持全量 JSON 导入/导出、单会话 Markdown/HTML 导出，并预留 WebDAV 跨端同步接口。

---

## 本地开发与构建

```bash
# 安装依赖
pnpm install

# Web 开发预览
pnpm dev

# Windows Electron 桌面开发联调
pnpm dev:electron

# 类型检查与单元测试
pnpm typecheck
pnpm test

# 构建 Windows 安装包与便携版 (输出至 release/)
pnpm dist:win

# 同步前端产物到 Capacitor Android 工程
pnpm cap:sync
```

---

## 自动化发布 (GitHub Actions)

推送形如 `v0.1.0` 的标签至 GitHub 时，[`.github/workflows/release.yml`](.github/workflows/release.yml) 会自动完成：
1. 类型检查、Vitest 单元测试与前端生产构建验证
2. 在 `windows-latest` 构建 `ChatBeaty-Setup-<version>.exe` 与 `ChatBeaty-Portable-<version>.exe`
3. 在 `ubuntu-latest`（JDK 21）构建已签名的 `ChatBeaty-Android-<version>.apk`
4. 自动发布到 GitHub Releases
