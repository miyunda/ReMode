## 项目实施约束


1. **先读文档再编码**：明确当前 M 阶段、验收标准和不得修改的核心不变量。
2. **先写测试**：算法 PR 必须新增/更新 fixture 与对应断言；不能只靠“试听似乎不错”。
3. **Core 不依赖浏览器**：不可导入 React、DOM、Tone.js、Cloudflare API。
4. **不要暗改时值**：任何自动清洗行为必须经过明确函数与记录；pitch-only 路径绝不修改 timing。
5. **每次只实现一个封闭的垂直切片**：可运行、可导出、可回归测试。
6. **算法变更要可追踪**：权重、评分/搜索策略和版本编号进入报告，避免无法复现。
7. **v1 无后端、无 AI**：v1 不写任何服务端代码。部署为只含静态资源的 Worker（ADR-017，根目录 `wrangler.jsonc` 只有 `assets`）：不加 Worker 脚本（`main`）、Functions、密钥、AI provider 或任何存储/服务绑定（ADR-007）；加入其中任何一项都须先立新 ADR。
8. **避免一口气实现所有 UI**：优先导入→检测→转换→试听→导出，随后增强。
9. **每个 PR 给出**：设计摘要、受影响的不变量、测试结果、截图或示例 MIDI（如适用）、已知限制。
10. **规范更新**：功能与实际行为不一致时，应更新本文件和 ADR，而不是让文档成为历史遗迹。
11. **调式识别不打不透明总分**：先识别音集、再按具名证据判断主音（ADR-004）；歧义必须带原因代码，永不输出百分比置信度。
12. **Essen 语料不入库**：CCARH 许可限个人/学术用途且禁止再分发；只能由脚本下载到 gitignore 目录，不进 fixtures、不进 CI、不打包（见规格 12.2）。

规格文档：`docs/ReMode-Development-Plan.md`（v1.1）。

### 仓库命令（M0 起）

- `pnpm install && pnpm typecheck && pnpm lint && pnpm test && pnpm build && pnpm smoke`：与 CI 相同的检查。
- `pnpm fixtures`：重新生成 `fixtures/generated/`（修改 `tools/fixtures/src/catalog.ts` 后必须运行并提交，测试会比对字节）。
- `node tools/cli/dist/main.js analyze <file.mid|file.jianpu|file.txt> [--track N] [--repair]`，或 `analyze --jianpu "<简谱>"`：JSON 分析报告。
- `node tools/cli/dist/main.js export <file.jianpu> [-o out.mid]`，或 `export --jianpu "<简谱>"`：简谱 → MIDI（不做任何变换）。两个子命令一致：位置参数是文件（按扩展名判断格式），`--jianpu` 永远是内联文本。
- `node tools/cli/dist/main.js transpose <input> --semitones N [-o out.mid]`：半音移调；`remode <input> --to [<root>:]<scaleId> [--from <root>:<scaleId>] [--accidentals nearest|preserve|reject] [--no-range] [-o out.mid]`：Strict 同主音换调式（带根音的 `--to` 为“移调 + 换调式”两步）。来源调式在 rank 1 有歧义时退出码 6，需 `--from`。
- `pnpm dev` / `pnpm preview`：Web 开发服务器 / 以生产 `_headers`（CSP）预览 `apps/web/dist`。`pnpm e2e`：Playwright E2E（先 `pnpm --filter @remode/web exec playwright install --with-deps chromium`），CI 的 `check` 任务同样执行。`pnpm --filter @remode/web screenshots`：重新生成 `docs/screenshots/m2a/`。
- Web 端只经 `@remode/core` 在浏览器本地处理，运行时不得发起任何网络请求（E2E 断言）；CSP 在 `apps/web/public/_headers`。
- 实现对规格的具体化与偏差记录在 `docs/decisions/`（M0：`m0-implementation-notes.md`；M1a：`m1a-implementation-notes.md`；M1b：`m1b-implementation-notes.md`；M2a：`m2a-implementation-notes.md`）。

### 分支与发布流程

- **不直接提交到 `main`**。`main` 是 Cloudflare Workers 的生产分支，受分支保护（含管理员）：只能通过 GitHub PR 合并更新。
- 每个切片从最新的 `main` 拉出功能分支，命名为 `feat/...`（如 `feat/m1a-jianpu-export`）；没有长期的 `dev` 分支。推送后由 Cloudflare Workers Builds 自动生成预览构建，地址为 `https://<branch>-remode.contra-milord.workers.dev`（另有按版本的 URL）。
- 预览站验收通过后，在 GitHub 上开 PR 合并到 `main`，合并后自动发布生产：`https://remode.miyunda.com`（临时域名，正式域名尚未确定、未注册）。生产域名以 `wrangler.jsonc` 的 `routes`（`custom_domain: true`）为准，`wrangler deploy` 会用它替换 Worker 的全部自定义域名，所以换域名要先改配置，不要只在面板里改。
- CI 的 `check` 任务（typecheck / lint / test / build / smoke / e2e）必须在 PR 上全绿才能合并。
- 本地可用 `pnpm build && pnpm exec wrangler deploy --dry-run` 校验部署配置；不要从开发机直接部署，也不要在仓库或开发机上放 Cloudflare 凭据。

### 建议的首个 Agent 任务

```text
任务：创建 ReMode 的 M0 Core/CLI 骨架。

要求：
- pnpm workspace，包含 packages/core、tools/cli、apps/web（web 可先留空）。
- TypeScript strict、Vitest、ESLint、格式化规则和 CI。
- 定义 MelodyNote、MidiMetadata、ModeAnalysis 等核心类型。
- 使用 @tonejs/midi 实现导入与轨道枚举，但暂不做 AI、UI 或试听。
- 实现 validator：空轨、打击乐、重叠检测和结构化错误。
- 实现 scale definitions：七个教会调式、五声五调、六声/七声（清乐、雅乐、燕乐），含音级身份表与“宫系统 + 主音”命名。
- 实现两步分析：PCD → 音集识别（覆盖率、未使用音级）→ 主音证据（尾音、句末、长音、强拍、音域）→ 候选与结构性歧义。
- K-S / Pearson 仅作为对照基线，不进入默认判定。
- 生成可复现 MIDI fixtures，覆盖七声、五声五调、缺失音级及常见与恶意/边界数据。
- CLI 可输出 JSON 格式的解析、验证、调式候选、主音证据与歧义说明。

验收：
1. pnpm test、pnpm typecheck、pnpm build 成功。
2. 所有核心逻辑可在 Node 运行，不依赖 DOM。
3. 对歧义样本输出候选与歧义原因代码（如只用 C D E G A 的旋律报告 MISSING_DEGREES），不伪造百分比置信度。
4. README 包含 CLI 用法、目前不支持的 MIDI 类型。
5. 保持原曲不可变；不要提前引入 AI Worker 或用户账户。
```
