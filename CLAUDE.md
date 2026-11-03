## 项目实施约束


1. **先读文档再编码**：明确当前 M 阶段、验收标准和不得修改的核心不变量。
2. **先写测试**：算法 PR 必须新增/更新 fixture 与对应断言；不能只靠“试听似乎不错”。
3. **Core 不依赖浏览器**：不可导入 React、DOM、Tone.js、Cloudflare API。
4. **不要暗改时值**：任何自动清洗行为必须经过明确函数与记录；pitch-only 路径绝不修改 timing。
5. **每次只实现一个封闭的垂直切片**：可运行、可导出、可回归测试。
6. **算法变更要可追踪**：权重、评分/搜索策略和版本编号进入报告，避免无法复现。
7. **v1 无后端、无 AI**：不引入 Worker、Pages Function、AI provider 或任何密钥（ADR-007）；如需重新引入须先立新 ADR。
8. **避免一口气实现所有 UI**：优先导入→检测→转换→试听→导出，随后增强。
9. **每个 PR 给出**：设计摘要、受影响的不变量、测试结果、截图或示例 MIDI（如适用）、已知限制。
10. **规范更新**：功能与实际行为不一致时，应更新本文件和 ADR，而不是让文档成为历史遗迹。
11. **调式识别不打不透明总分**：先识别音集、再按具名证据判断主音（ADR-004）；歧义必须带原因代码，永不输出百分比置信度。
12. **Essen 语料不入库**：CCARH 许可限个人/学术用途且禁止再分发；只能由脚本下载到 gitignore 目录，不进 fixtures、不进 CI、不打包（见规格 12.2）。

规格文档：`docs/ReMode-Development-Plan.md`（v1.1）。

### 分支与发布流程

- **不直接提交到 `main`**。`main` 是 Cloudflare 生产分支，只通过 GitHub PR 合并更新。
- 开发在非 `main` 分支进行（`dev` 或按切片命名的 `feat/...`），推送后由 Cloudflare 自动生成预览部署。
- 预览站验收通过后，在 GitHub 上开 PR 合并到 `main`，合并后自动发布生产。
- CI（typecheck / lint / test / build）必须在 PR 上全绿才能合并。

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
