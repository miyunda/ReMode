# M2a 实现记录与规格偏差

状态：随 `feat/m2a-web-import-analysis` 引入。新增 `@remode/web` 0.1.0；core 无改动，`analysisVersion`（`remode-mode-2step/0.2.0`）、`remode-strict/1.1.0`、`remode-transpose/1.0.0`、`remode-jianpu/1.0.0` 都不变。
M2a 只做 Web 骨架、导入、分析视图、最小 TARGET（Strict 生成、逐音 diff、回检与下载）以及 Cloudflare 部署就绪（Workers 静态资源，见 §5）。不做 Piano Roll、试听、drone、手动修音、撤销、Expressive 和 PWA。
本文件记录对规格（`docs/ReMode-Development-Plan.md` §3、§5、§6.5、§10、§11.1、§13、§14 M2）的具体化与偏差（CLAUDE.md 规则 10）。

## 1. 结构

| 文件 | 内容 |
|---|---|
| `apps/web/src/state/project.ts` | reducer。`input`（解析结果）、`original`（深冻结的原曲）、`analysis`、`sourceOverride`/`target`（设置）、`generated`（变体）各占一槽 |
| `apps/web/src/lib/loadInput.ts` | 文件或文本 → core（`importMidi` / `parseJianpu`）；先按扩展名判断格式，再按内容判断 |
| `apps/web/src/lib/exportVariant.ts` | `exportMidi` + `exportFileName`，用 Blob URL 下载 |
| `apps/web/src/lib/labels.ts` | 每个结构化代码对应的中文名称，以及按字段生成的校验说明 |
| `apps/web/src/components/*` | 视图组件；业务计算都在 reducer 里，组件不做计算 |
| `apps/web/public/_headers` | 静态资源响应头（CSP 等）。`vite preview` 读取同一文件 |
| `wrangler.jsonc` | Workers 静态资源配置：只有 `assets`，没有 `main` |

## 2. 决定与理由

| 问题 | 决定 | 理由 |
|---|---|---|
| 状态管理 | `useReducer` + Context，不引入 Zustand | 规格 §3.1 两者皆可。reducer 是纯函数，可以不经 React 直接测试；变体的 `createdAt` 放在 action 里传入，保证 reducer 纯 |
| 原曲不可变（Invariant A） | 选轨（或开启修复）时复制音符并 `Object.freeze` 深冻结，存入 `original`。所有变换都从它派生，变体单独存放。解析得到的 `input` 不被改写，所以切换轨道或关闭修复时可以从它重建 | 冻结后，任何原地修改都会在严格模式下抛错，不会悄悄成功；单元测试断言了冻结和“修复不改 input” |
| 何时自动选轨 | 恰有一个候选轨（非空、非打击乐）时自动选中；多于一个时必须由用户选择，选择前不显示分析，“生成”按钮不可用 | 规格 §5.1：多轨要引导选轨 |
| 疑似复音 | 轨道列表对每条轨运行 `validateMelody`，`monophonic === false` 时标记“疑似复音” | 与 CLI 的单声部判定是同一个函数 |
| 连奏修复 | 只要存在 `repairable` 重叠，就始终预先计算 `repairLegatoOverlaps` 并展示表格（“修复将做的修改（未应用）”）。勾选后才把结果作为“清理后来源”使用，并标注 `cleaned`。仍有错误时阻止继续，这一点与 CLI `--repair` 相同 | 规格 §4.2、§5.2：修复必须是显式、可审计的，并且与原文件区分 |
| 来源调式 | 有手动指定时一律使用手动指定。否则当 rank 1 只有一个调式，且没有 `TONIC_UNCLEAR`、`MULTIPLE_COLLECTIONS`、`CHROMATIC_HEAVY`、`TOO_SHORT` 时，使用自动识别结果；条件不满足时不允许换调式，并提示用户手动指定。`MISSING_DEGREES` 不阻止使用自动识别结果 | 与 CLI `remode` 的规则（`BLOCKING_AMBIGUITIES`，退出码 6）一致，两端行为相同。界面明确标注“手动指定（已覆盖自动识别）” |
| 调式选择器 | 教会调式选“主音 + 调式”。中国调式选“宫音（宫系统）+ 主音（宫商角徵羽）+ 音阶类型”，主音由宫音推出，名称由 core 的 `modeName` 生成。目标侧锁定主音（同主音），选中国调式时用主音反推宫音，并在下拉项中显示（如“羽（Eb 宫）”） | 规格 §6.2 的“宫系统 + 主音”命名；目标默认同主音，与规格 §7.1 的默认操作一致 |
| 改变目标主音 | “目标主音”默认为“同主音”。选其他音时走 `strictRemodeWithTonic`（先移调，再换调式），并在结果中注明 | 与 CLI 中带根音的 `--to` 相同 |
| 不显示任何类似置信度的数值 | 不显示百分比；集合覆盖率以“集内时值 x / y 拍”表示；PCD 柱高是累计拍数，不是占比；K-S 基线（相关系数）不展示；证据只显示整数点数和“命中 m / n”。改动数写作“改动 5 / 21 个音”，不写百分比（规格 §10.5 的百分比留给 M3 的统计报告再议） | CLAUDE.md 规则 11 / ADR-004。E2E 与组件测试都断言页面中没有 `%` |
| 分析详情放在哪里 | 左侧 SOURCE 栏放精简结果：rank 1 名称、歧义代码、生效的来源调式与手动指定入口。完整证据、音集与 PCD 放在右侧主区的 ANALYSIS 区块，排在 Change inspector 之后 | 规格 §10.2 把证据和歧义放在左栏，但完整证据表在 22–28rem 宽的侧栏里难以阅读，而 M2a 的右侧主区除占位外是空的。M2b 加入卷帘后可以再调整 |
| 导出调号 | 换调式用 `mode` 策略（写目标音集的调号，并写 Text 元事件），文件名用 `exportFileName(..., variant: 'strict')`。移调遵循 CLI 的规则：来源有调号且不是整八度移调时，调号策略为 `omit`；文件名为 `transpose-up3` / `transpose-down3` | 规格 §11.1；与 CLI 行为一致 |
| 颜色 | 采用 Rosé Pine Dawn / Rosé Pine 的原色。只新增几个文字用的派生色（`muted-text`、`accent-text`、`danger-text`、`warn-text`），因为原色 `muted` / `subtle` / `love` 作小字时达不到 4.5:1。按钮底色在深色主题用 foam，配深色文字 | `test/contrast.test.ts` 解析 `styles.css`，断言两套主题中所有文字令牌在 base/surface/overlay 上 ≥ 4.5:1，按钮 ≥ 4.5:1，焦点环 ≥ 3:1，并断言 `prefers-color-scheme` 块与手动深色块完全一致 |
| 主题切换 | 三档：跟随系统（默认）、Dawn、Rosé Pine。手动选择存入 `localStorage['remode.theme']`，每次读写都包在 try/catch 中。`public/theme-init.js` 在首次绘制前设置 `data-theme` | CSP 只允许同源脚本，所以不用内联脚本；存储不可用时功能不受影响（有测试覆盖） |
| 差异不只用颜色表达 | 严重度写出“错误 / 警告 / 提示”并带符号；diff 表用 ▲/▼ 加带符号的半音数；PCD 中音集外的音级用斜线填充 | 规格 §10.1 色盲友好 |
| 字体 | 只用系统字体栈 | CSP 不允许外部字体，也没有理由自托管 |

## 3. 限额与性能（Web Worker）

本机测量结果（Node 26，core dist，合成的七声随机游走旋律）：

| 音符数 | exportMidi | importMidi | validate | analyze | strict | recheck |
|---|---|---|---|---|---|---|
| 500 | 6 ms | 2 ms | <1 ms | 2 ms | 1 ms | 1 ms |
| 5 000 | 163 ms | 11 ms | 1 ms | 2 ms | 3 ms | 1 ms |
| 20 000 | 2 605 ms | 75 ms | 4 ms | 5 ms | 13 ms | 2 ms |

分析与变换在 20 000 个音时也远低于一帧，所以 **M2a 不使用 Web Worker**。只有 `exportMidi` 是超线性的（发生在 `@tonejs/midi` 内部），而且只在点击“下载 MIDI”时运行。据此设定的初始限额：

- 文件 ≤ **1 MiB**：在读取任何字节前按 `File.size` 检查。core 的默认值是 4 MiB；单旋律 MIDI 通常只有几 KB，1 MiB 已能容纳数万个事件；
- 文件内音符（全部轨）≤ **20 000**：沿用 core 默认值，导入 20 000 个音约 75 ms；
- 单条旋律（所选轨或简谱）≤ **5 000** 音：导出约 160 ms，可以接受。超限时选轨报 `MELODY_TOO_LONG`，简谱报解析器的 `TOO_MANY_NOTES`；
- 简谱文本 ≤ **100 000** 字符：沿用 core 默认值。

后续选项：把导出（或整个 core）放进 Worker；或者在 core 中改用更底层的写入路径，使导出变为线性。

## 4. Core 的浏览器兼容性

core 已经符合规则 3：没有 `Buffer`、没有 `node:*`，ESLint 也会阻止它们出现。`@tonejs/midi` 和 `midi-file` 是纯 JS（CommonJS）；Vite 预打包时做 CJS 互操作，core 中 `import tonejsMidi from '@tonejs/midi'` 的写法在 Vite、Rolldown 和 Node 下都能工作。因此**不需要 polyfill，也不需要单独的浏览器入口**。Web 通过 `@remode/source` 条件直接编译 core 的 TS 源码，开发和构建都不依赖先构建 core 的 `dist`。Playwright 测试在 Node 中导入 core 的 `dist` 来复核下载的文件，所以 `pnpm e2e` 要在 `pnpm build` 之后运行。CI 正是这个顺序。

构建产物中唯一出现 `fetch` 的地方有两处：`@tonejs/midi` 的 `Midi.fromUrl`（死代码），以及 Vite 的 modulepreload polyfill（同源）。运行时没有网络请求，由 E2E 断言：页面加载完成后不得再发出任何 HTTP 请求，任何时候都不得访问其他源，不得出现 console error 或 CSP violation。

## 5. CSP 与 Cloudflare 部署（Workers 静态资源，ADR-017）

最初按 Cloudflare Pages 准备。在同一 PR 中改为 **只含静态资源的 Worker**：用户决定为以后的服务端代码（AI 代理、分享链接）预先选定 Workers 形态，届时只需在同一项目中加 `main`，不必从 Pages 迁移。v1 仍然不写服务端代码（CLAUDE.md 规则 7 已同步修改）。

- `wrangler.jsonc`：`name: "remode"`、`compatibility_date: "2026-10-19"`、`assets.directory: "./apps/web/dist"`、`assets.not_found_handling: "single-page-application"`。没有 `main`、绑定或 vars。日期不晚于所锁定 wrangler（4.151.2）内置的 workerd 版本。Cloudflare 文档中仅含资源的 SPA 示例正是这几个字段。没有脚本时，所有请求都直接交给资源服务，`run_worker_first` 和 `Sec-Fetch-Mode` 的问题不会出现。
- `wrangler` 4.151.2 锁定为根 devDependency，部署命令用 `pnpm exec wrangler …`，不用 `npx` 临时下载。pnpm 12 会把被忽略的构建脚本当作安装错误（`ERR_PNPM_IGNORED_BUILDS`），所以在 `pnpm-workspace.yaml` 的 `allowBuilds` 中加了 `workerd: false`。workerd 与 esbuild 一样以可选依赖提供各平台的预编译二进制，不需要 postinstall。本机 `wrangler dev` 正常运行即为证明。
- CSP：`default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; manifest-src 'self'; worker-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; object-src 'none'`，另加 `nosniff`、`no-referrer`、`Permissions-Policy`、`COOP`、`X-Frame-Options: DENY`；`/assets/*` 长缓存（文件名带哈希）。Workers 静态资源支持 `_headers`，语法与 Pages 相同（最多 100 条规则、每行 2 000 字符），文件本身不会被当作资源提供，所以无需修改。注意：`_headers` 只作用于静态资源响应；以后若加入 Worker 脚本，脚本生成的响应须自行设置这些头。
- React 的 `style` 属性通过 CSSOM 设置，不受 `style-src` 限制；构建中没有内联 `<style>` 或 `<script>`（开发服务器不发送 CSP，所以不受影响）。
- `vite preview` 读取同一份 `_headers` 中 `/*` 段的头，E2E 因而在生产 CSP 下运行。
- 本地校验：`pnpm build && pnpm exec wrangler deploy --dry-run` 读取了 8 个资源文件，报告“No bindings found”。`wrangler dev`（workerd）返回了 `_headers` 中的全部头，深层路径返回 `index.html` 和 200，请求 `/_headers` 也是如此（文件未被提供）。设置 `E2E_BASE_URL=http://127.0.0.1:8787` 后，8 个桌面 E2E 用例对着 `wrangler dev` 全部通过。开发机上没有 Cloudflare 凭据，也从未在开发机上部署。
- Workers Builds 的版本选择（Cloudflare 文档 “Workers Builds → Build image”）：Node 读取 `.node-version`（`24`，与镜像默认值相同）；pnpm 经 Corepack 按 `packageManager`（`pnpm@12.16.1`）选择，该字段优先于 `PNPM_VERSION`，所以不需要任何构建变量。这一点与 Pages v3 镜像不同：Pages 不读 `packageManager`，必须设置 `PNPM_VERSION`。非生产分支的默认 Preview 命令是 `wrangler preview`，它生成 Preview URL（锁定版本中为 open beta）；`wrangler versions upload` 生成的是 Version URL。

## 6. 测试

- `apps/web/test/project.test.ts`：reducer 的加载、自动或显式选轨、冻结、修复的预览与应用、阻止继续、手动来源、歧义时拒绝、Strict C Ionian → C Dorian（只改音高）、`NO_CHARACTERISTIC_DEGREE`、设置变化时丢弃旧变体、移调导出后重新导入 tick 相同、`mode` 调号与 §11.1 文件名，以及 `MELODY_TOO_LONG`。
- `apps/web/test/app.test.tsx`（Testing Library）：占位区块、候选、证据、歧义代码与“无 %”、手动来源覆盖自动识别并参与生成、行列号错误、多轨选择、修复开关、主题持久化与存储异常。
- `apps/web/test/contrast.test.ts`：AA 对比度。
- `apps/web/e2e/workbench.spec.ts`（Playwright，Chromium，桌面和 Pixel 7）：完整工作流（示例 → 候选/歧义 → 手动 C Ionian → C Dorian → 下载，重新导入后 tick 完全相同，且只有 E→Eb 发生变化）、上传 fixture `.mid`、损坏文件（`NOT_MIDI`、`TRUNCATED`）、多轨选择、简谱行列号、主题刷新后保持、键盘焦点，以及手机宽度下无横向滚动。所有用例都附带上述的网络与 CSP 守卫。
- E2E 在 CI 的 `check` 任务中运行（Playwright 安装 Chromium 及系统依赖），失败时上传 HTML 报告。分支保护无需改动。

## 7. 已知限制

- 没有卷帘、试听、drone、手动修音或撤销（M2b/M2c）。
- 没有“新建旋律”模式；输入只能是文件或简谱。
- Pitch bend 与 CC64 只做提示，导出时不保留（与 CLI 相同）。
- 只能导出生成的变体，不提供“仅导出原曲”（CLI `export` 已有此功能）。
- 只在 Chromium 上跑 E2E；Firefox 和 WebKit 尚未覆盖。
