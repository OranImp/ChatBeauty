import type { Conversation, Message } from '@/types/chat';

export const DEMO_CONVERSATION_ID = 'demo-showcase-full-adder';

export function createDemoShowcaseData(now = Date.now()): {
  conversation: Conversation;
  messages: Message[];
} {
  const conversation: Conversation = {
    id: DEMO_CONVERSATION_ID,
    title: '全加器推导与交互可视化示例',
    createdAt: now - 120000,
    updatedAt: now - 60000,
    pinned: true,
    systemPromptPresetId: 'stem-tutor',
    enableRenderPrompt: true,
    isDemo: true,
  };

  const userMsg: Message = {
    id: 'demo-msg-user-1',
    conversationId: DEMO_CONVERSATION_ID,
    role: 'user',
    parts: [
      {
        type: 'text',
        text: '如何用两个半加器和一个或门构造一位全加器？顺便演示一下数学/化学公式、向量图、流程图、函数图像和交互动画的渲染效果。',
      },
    ],
    createdAt: now - 110000,
    updatedAt: now - 110000,
    status: 'done',
  };

  const assistantMarkdown = `我们先用**两个半加器（HA）+ 一个或门（OR）**完成全加器的直观推导，再顺便展示内置的各类学术可视化组件。

### 1. 一位全加器的分步推导

用第一个半加器 HA1 先计算 $A + B$，得到部分和与第一级进位：

$$S_1 = A \\oplus B$$

$$C_1 = AB$$

然后用第二个半加器 HA2 计算 $S_1 + C_{in}$，得到最终本位和与第二级进位：

$$S = S_1 \\oplus C_{in}$$

$$C_2 = S_1 C_{in}$$

最后，把两次计算可能产生的进位进行或运算：

$$C_{out} = C_1 + C_2$$

因此，一位全加器的整体逻辑连接如下（点击图像右上角或直接点击公式可放大查看、导出 PNG/SVG 或复制源码）：

\`\`\`svg caption="全加器的构造思路：2 个半加器加 1 个或门（区分主和路径与进位通路）"
<svg viewBox="0 0 680 356" xmlns="http://www.w3.org/2000/svg">
  <!-- Input lines A, B -->
  <line x1="40" y1="84" x2="150" y2="84" stroke="currentColor" stroke-width="2.4" />
  <text x="64" y="72" fill="currentColor" font-size="18" font-family="ui-serif, Georgia, serif">A</text>

  <line x1="40" y1="156" x2="150" y2="156" stroke="currentColor" stroke-width="2.4" />
  <text x="64" y="144" fill="currentColor" font-size="18" font-family="ui-serif, Georgia, serif">B</text>

  <!-- HA1 Box -->
  <rect x="150" y="54" width="136" height="130" rx="14" fill="rgba(168,162,158,0.06)" stroke="currentColor" stroke-width="2.2" />
  <text x="218" y="108" fill="currentColor" font-size="19" font-weight="600" text-anchor="middle">HA1</text>
  <text x="218" y="138" fill="currentColor" opacity="0.72" font-size="15" text-anchor="middle">半加器</text>

  <!-- S1 wire -->
  <line x1="286" y1="84" x2="386" y2="84" stroke="currentColor" stroke-width="2.4" />
  <text x="336" y="72" fill="currentColor" font-size="18" text-anchor="middle" font-family="ui-serif, Georgia, serif">S₁</text>

  <!-- HA2 Box -->
  <rect x="386" y="54" width="136" height="130" rx="14" fill="rgba(168,162,158,0.06)" stroke="currentColor" stroke-width="2.2" />
  <text x="454" y="108" fill="currentColor" font-size="19" font-weight="600" text-anchor="middle">HA2</text>
  <text x="454" y="138" fill="currentColor" opacity="0.72" font-size="15" text-anchor="middle">半加器</text>

  <!-- Output S -->
  <line x1="522" y1="84" x2="632" y2="84" stroke="currentColor" stroke-width="2.4" />
  <text x="580" y="72" fill="currentColor" font-size="18" font-family="ui-serif, Georgia, serif">S</text>

  <!-- Cin wire -->
  <polyline points="260,218 352,218 352,156 386,156" fill="none" stroke="#d9825b" stroke-width="2.2" stroke-linejoin="round" stroke-dasharray="5,3" />
  <text x="284" y="206" fill="#d9825b" font-size="16" font-family="ui-serif, Georgia, serif">Cᵢₙ</text>

  <!-- C1 wire to OR -->
  <polyline points="286,156 322,156 322,276 404,276" fill="none" stroke="#d9825b" stroke-width="2.4" stroke-linejoin="round" />
  <text x="304" y="246" fill="#d9825b" font-size="15" font-weight="600">C₁</text>

  <!-- C2 wire to OR -->
  <polyline points="522,156 558,156 558,208 364,208 364,252 404,252" fill="none" stroke="#d9825b" stroke-width="2.4" stroke-linejoin="round" />
  <text x="542" y="196" fill="#d9825b" font-size="15" font-weight="600">C₂</text>

  <!-- OR Box -->
  <rect x="404" y="228" width="136" height="72" rx="14" fill="rgba(111,179,156,0.09)" stroke="#6fb39c" stroke-width="2.2" />
  <text x="472" y="270" fill="#6fb39c" font-size="19" font-weight="600" text-anchor="middle">OR</text>

  <!-- Cout output -->
  <line x1="540" y1="264" x2="632" y2="264" stroke="#d9825b" stroke-width="2.6" />
  <text x="578" y="252" fill="#d9825b" font-size="18" font-weight="600" font-family="ui-serif, Georgia, serif">Cₒᵤₜ</text>

  <!-- Compact Legend -->
  <line x1="40" y1="334" x2="66" y2="334" stroke="currentColor" stroke-width="2.4" />
  <text x="74" y="339" fill="currentColor" opacity="0.78" font-size="12.5">主路径 / 本位和 S</text>
  <line x1="204" y1="334" x2="230" y2="334" stroke="#d9825b" stroke-width="2.4" />
  <text x="238" y="339" fill="#d9825b" font-size="12.5">进位通路 C₁, C₂, Cₒᵤₜ</text>
</svg>
\`\`\`

> [!TIP]
> **为什么 $C_1$ 和 $C_2$ 不会同时为 1？**
> 若 $C_1 = AB = 1$，则必然有 $A=1, B=1$，从而 $S_1 = A \\oplus B = 0$，因此 $C_2 = S_1 C_{in} = 0$。两者互斥，所以直接用 **OR 门** 合并即可无进位冲突地得到 $C_{out}$。

---

### 2. 多行方程组、矩阵与化学方程式

$$
\\begin{aligned}
C_{out} &= AB + (A \\oplus B)C_{in} \\\\
        &= AB + AC_{in} + BC_{in}
\\end{aligned}
\\qquad
\\mathbf{R}(\\theta) = \\begin{bmatrix} \\cos\\theta & -\\sin\\theta \\\\ \\sin\\theta & \\cos\\theta \\end{bmatrix}
$$

化学反应支持 \`mhchem\` 宏包：$\\ce{2H2(g) + O2(g) ->[\\Delta] 2H2O(l)}$，电离平衡 $\\ce{CH3COOH <=> CH3COO- + H+}$。

---

### 3. Mermaid 逻辑流与 ECharts 离线函数图像

\`\`\`mermaid
flowchart LR
  In["输入 A, B, Cin"] --> HA1["半加器 HA1"]
  HA1 -->|S1| HA2["半加器 HA2"]
  In -->|Cin| HA2
  HA2 -->|S| OutS["本位和 S"]
  HA1 -->|C1| OR["或门 OR"]
  HA2 -->|C2| OR
  OR -->|Cout| OutC["进位 Cout"]
\`\`\`

\`\`\`echarts
{
  "title": { "text": "方波的傅里叶级数逼近 (基波 vs 谐波叠加)", "left": "center" },
  "tooltip": { "trigger": "axis" },
  "legend": { "bottom": 4 },
  "xAxis": {
    "type": "category",
    "data": ["0", "0.5", "1.0", "1.5", "2.0", "2.5", "3.0", "3.5", "4.0", "4.5", "5.0", "5.5", "6.0"]
  },
  "yAxis": { "type": "value", "min": -1.3, "max": 1.3 },
  "series": [
    {
      "name": "前 5 奇次谐波叠加",
      "type": "line",
      "smooth": true,
      "showSymbol": false,
      "lineStyle": { "width": 2.4 },
      "data": [0, 0.98, 1.04, 0.99, 1.02, 0.99, 0.35, -0.96, -1.03, -0.98, -1.02, -0.97, -0.51]
    },
    {
      "name": "前 3 奇次谐波叠加",
      "type": "line",
      "smooth": true,
      "showSymbol": false,
      "lineStyle": { "width": 2.0 },
      "data": [0, 0.92, 0.98, 0.93, 1.01, 0.91, 0.25, -0.84, -0.99, -0.94, -0.98, -0.85, -0.42]
    },
    {
      "name": "基波 sin(x)",
      "type": "line",
      "smooth": true,
      "showSymbol": false,
      "lineStyle": { "width": 1.6, "type": "dashed" },
      "data": [0, 0.48, 0.84, 1.0, 0.91, 0.6, 0.14, -0.35, -0.76, -0.98, -0.96, -0.71, -0.28]
    }
  ]
}
\`\`\`

---

### 4. 交互式原理实验（HTML 沙盒）

下面这段完全离线运行的 Canvas 实验可以实时拖动滑块，观察两列正弦波干涉与合成波形：

\`\`\`html-preview
<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<style>
  * { box-sizing: border-box; font-family: var(--font-sans, system-ui, sans-serif); }
  body { margin: 0; padding: 14px; background: transparent; color: var(--fg, #f2f0eb); }
  .controls { display: flex; flex-wrap: wrap; gap: 16px; align-items: center; margin-bottom: 10px; font-size: 13px; }
  label { display: flex; align-items: center; gap: 8px; }
  .val { font-family: var(--font-mono, monospace); font-variant-numeric: tabular-nums; min-width: 34px; }
  .legend { display: flex; flex-wrap: wrap; gap: 14px; align-items: center; margin-bottom: 10px; font-size: 12px; color: var(--muted, #9c968c); }
  .leg-item { display: inline-flex; align-items: center; gap: 6px; }
  .swatch { width: 18px; height: 2px; border-radius: 2px; display: inline-block; }
  .swatch.dashed { background: transparent !important; border-top: 2px dashed; height: 0; }
  canvas { width: 100%; height: 156px; display: block; border-radius: 10px; border: 1px solid var(--border, rgba(236,234,228,0.1)); }
</style>
</head>
<body>
  <div class="controls">
    <label>频率比 f₂/f₁ <input id="freq" type="range" min="1" max="5" step="any" value="2" /> <span id="fv" class="val">2.00</span></label>
    <label>相位差 φ <input id="phase" type="range" min="0" max="6.28" step="any" value="0" /> <span id="pv" class="val">0.00</span></label>
  </div>
  <div class="legend">
    <span class="leg-item"><span class="swatch" style="background: var(--chart-1, #d9825b)"></span><span>合成波 y₁ + y₂</span></span>
    <span class="leg-item"><span class="swatch dashed" style="border-color: var(--chart-2, #6fb39c)"></span><span>波 1: sin(ωt)</span></span>
    <span class="leg-item"><span class="swatch dashed" style="border-color: var(--chart-3, #d9b566)"></span><span>波 2: sin(f₂/f₁·ωt + φ)</span></span>
  </div>
  <canvas id="c" width="600" height="164"></canvas>
  <script>
    const canvas = document.getElementById('c');
    const ctx = canvas.getContext('2d');
    const freqEl = document.getElementById('freq');
    const phaseEl = document.getElementById('phase');
    const fv = document.getElementById('fv');
    const pv = document.getElementById('pv');
    const styles = getComputedStyle(document.documentElement);
    const c1 = styles.getPropertyValue('--chart-1').trim() || '#d9825b';
    const c2 = styles.getPropertyValue('--chart-2').trim() || '#6fb39c';
    const c3 = styles.getPropertyValue('--chart-3').trim() || '#d9b566';
    const grid = styles.getPropertyValue('--border').trim() || 'rgba(160,160,160,0.16)';
    let t = 0;
    function draw() {
      const f = parseFloat(freqEl.value);
      const p = parseFloat(phaseEl.value);
      fv.textContent = f.toFixed(2);
      pv.textContent = p.toFixed(2);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const mid = canvas.height / 2;

      ctx.strokeStyle = grid;
      ctx.lineWidth = 1;
      ctx.setLineDash([]);
      ctx.beginPath(); ctx.moveTo(0, mid); ctx.lineTo(canvas.width, mid); ctx.stroke();

      // Wave 1 (sage)
      ctx.strokeStyle = c2;
      ctx.lineWidth = 1.6;
      ctx.setLineDash([5, 4]);
      ctx.beginPath();
      for (let x = 0; x <= canvas.width; x += 2) {
        const y = mid - Math.sin(x * 0.03 + t) * 26;
        x === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      }
      ctx.stroke();

      // Wave 2 (ochre gold)
      ctx.strokeStyle = c3;
      ctx.lineWidth = 1.6;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      for (let x = 0; x <= canvas.width; x += 2) {
        const y = mid - Math.sin(x * 0.03 * f + p + t * 1.2) * 26;
        x === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      }
      ctx.stroke();

      // Superposition (terracotta solid)
      ctx.strokeStyle = c1;
      ctx.lineWidth = 2.5;
      ctx.setLineDash([]);
      ctx.beginPath();
      for (let x = 0; x <= canvas.width; x += 2) {
        const y = mid - (Math.sin(x * 0.03 + t) + Math.sin(x * 0.03 * f + p + t * 1.2)) * 26;
        x === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      }
      ctx.stroke();
      t += 0.035;
      requestAnimationFrame(draw);
    }
    draw();
  </script>
</body>
</html>
\`\`\`

### 5. 代码高亮与对比表

| 器件 | 逻辑表达式 | 核心作用 |
| :--- | :--- | :--- |
| 半加器 HA | $S = A \\oplus B,\\; C = AB$ | 不考虑低位进位 |
| 全加器 FA | $S = A \\oplus B \\oplus C_{in}$ | 支持多比特级联相加 |

\`\`\`python
def full_adder(a: int, b: int, c_in: int) -> tuple[int, int]:
    """用两个半加器逻辑计算 1-bit 全加器结果 (sum, c_out)"""
    s1, c1 = a ^ b, a & b
    s, c2 = s1 ^ c_in, s1 & c_in
    return s, c1 | c2
\`\`\`
`;

  const assistantMsg: Message = {
    id: 'demo-msg-assistant-1',
    conversationId: DEMO_CONVERSATION_ID,
    role: 'assistant',
    parts: [
      {
        type: 'reasoning',
        durationMs: 2800,
        text: '1. 分析用户需求：用两个半加器 HA1/HA2 与一个或门 OR 构造全加器。\n2. 按分步推导列出 $S_1 = A \\oplus B$, $C_1 = AB$, $S = S_1 \\oplus C_{in}$, $C_2 = S_1 C_{in}$, $C_{out} = C_1 + C_2$。\n3. 绘制清晰无遮挡的矢量 SVG 逻辑框图，并附带化学公式、Mermaid、ECharts 及可交互波形沙盒演示渲染引擎能力。',
      },
      {
        type: 'text',
        text: assistantMarkdown,
      },
    ],
    createdAt: now - 105000,
    updatedAt: now - 60000,
    modelId: 'ChatBeauty Showcase',
    status: 'done',
  };

  return { conversation, messages: [userMsg, assistantMsg] };
}
