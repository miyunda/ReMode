# M2b 实现记录与规格偏差

状态：随 `feat/m2b-piano-roll` 引入。core 新增 `remode-manual/1.0.1`（手动修音；1.0.0 → 1.0.1 只把说明文字改为中文）与 `writeJianpu`（简谱写出，语法仍为 `remode-jianpu/1.0.0`）；`TransformSettings.operation` 增加 `'manual-edit'`。`analysisVersion`（`remode-mode-2step/0.2.0`）、`remode-strict/1.1.0`、`remode-transpose/1.0.0` 都不变。
M2b 只做卷帘、差异高亮、音符检查器、手动修音（`custom` 变体）、撤销/重做、新建旋律模式和相关的 UX 修正。不做试听、Transport、drone、Tone.js、Expressive 优化器。
本文件记录对规格（`docs/ReMode-Development-Plan.md` §4.2、§10.3、§10.6、§10.8、§11.1、§14 M2）的具体化与偏差（CLAUDE.md 规则 10）。

## 1. 结构

| 文件 | 内容 |
|---|---|
| `packages/core/src/transform/manual.ts` | `applyManualEdit`（只换一个音的 `pitch`，返回 `MANUAL_EDIT` 的 `PitchChange`）、`stepPitch`（按音阶级进或半音）、`snapPitch`（最近的音阶音，等距取低）、`degreeOf`、`inMode` |
| `packages/core/src/text/jianpuWriter.ts` | `writeJianpu`：旋律 → 简谱文本，`parseJianpu` 的逆运算 |
| `apps/web/src/state/project.ts` | reducer 新增 `custom`、`view`、`selectedNoteId`、`snap`、`draft`、`history`，以及 `targetMode`、`activeVariant` |
| `apps/web/src/lib/rollGeometry.ts` | 卷帘纯计算：小节/拍网格、坐标换算、音域、自适应缩放、命中测试 |
| `apps/web/src/lib/draft.ts` | 新建旋律草稿的增删改（保持单声部）与转成旋律 |
| `apps/web/src/components/RollCanvas.tsx` | 通用 Canvas 卷帘（编辑 / 作曲两种模式） |
| `apps/web/src/components/PianoRollPanel.tsx` | 工作台卷帘：方案切换、吸附与音阶开关、撤销/重做/恢复原样、图例 |
| `apps/web/src/components/NoteInspector.tsx` | 所选音符的详情与操作 |
| `apps/web/src/components/NoteTable.tsx` | 同步音符表（读屏替代），取代 M2a 的 diff 表 |
| `apps/web/src/components/DraftPanel.tsx` | 新建旋律模式 |

## 2. 决定与理由

| 问题 | 决定 | 理由 |
|---|---|---|
| Canvas 还是 SVG | **Canvas 2D**。滚动框内放一个与全卷帘同尺寸的占位层，上面是 `position: sticky` 的画布，大小与滚动框相同；滚动、缩放、数据变化时只重绘可见窗口。原生滚动条和触摸滚动照常工作 | 5 000 音（上限）时 SVG 要有原曲虚影 + 当前音 + 连线/标记，共 10 000 个以上的节点，每次拖动和选中都要由 React 重新协调。实测（本机 Chromium，5 000 音，Strict 后放大）：Canvas 连续滚动平均每帧 16.6 ms（被 vsync 限住，即 60 fps）；键盘修音从按键到检查器更新约 60 ms（含 Playwright 往返，以及对 custom 变体做 recheck 和重新计算净改动）。Canvas 对读屏不可见，所以同步音符表是正式的替代方案（规格 §10.3） |
| 当前方案 | `view` 为 `original` / `generated` / `custom`。生成成功后自动切到 `generated`；设置变化使生成结果失效时退回 `original`。Expressive 按钮显示但不可用（M3） | `generated` 涵盖 Strict 与移调（core 的移调变体 id 本来就是 `custom`，所以界面不按 id 区分，只叫“移调结果”） |
| custom 从哪里来 | 在原曲或生成结果上做第一次修改时，自动从**正在显示的方案**派生 custom（`FORK_CUSTOM` 也可显式调用）。已有 custom 时在其他视图中修改，会从该视图重新派生，旧 custom 可撤销恢复 | 用户改的是眼前看到的音高；如果改到另一个看不见的 custom 上，界面与结果就会对不上 |
| custom 的改动记录 | `edits`：每次手动修改各一条 `PitchChange`（`reasonCode: MANUAL_EDIT`，`fromPitch` 为该次修改前的音高）。`variant.changes`：相对**原曲**的净改动；被手动碰过的音记为 `MANUAL_EDIT`，其余沿用派生来源（如 Strict 的 `DEGREE_MAPPED`）。改回原音高的音不算改动 | diff、导出、表格都以原曲为基准，所有方案共享原始 ID（规格 §4.2）；逐次记录保证可追溯（规则 6） |
| 不变量 B | 修音只经 `applyManualEdit`，它只替换 `pitch`；custom 被深冻结。reducer 的 fast-check 属性测试随机组合修改、恢复、撤销、重做、生成、换目标、切换视图，每一步都断言：原曲对象不变且仍冻结；每个变体的 ID、tick、时值、力度与原曲逐一相同；`changes` 恰好列出音高不同的音 | 规则 4 |
| 吸附 | 默认开启，目标为“目标音阶”：已生成换调式时取生成目标；否则按当前设置推出（同主音换调式：设置的主音或来源主音 + 目标调式；移调：来源调式平移）。来源调式未确定时没有目标，吸附开关不可用，按半音修改。键盘 ↑/↓ 吸附时按音阶级进（`stepPitch`），拖动时取最近的音阶音（`snapPitch`，等距取低，与 strict 的 `lower` 规则一致）。Shift+↑/↓ 永远移八度 | 规格 §10.3 |
| 调外警告 | 吸附关闭时显示“吸附已关闭”提示；不在目标音阶的音在卷帘上标 `!`，在表格中标 `!`（附读屏文字），在检查器中显示 `OUT_OF_TARGET_SCALE` 警告；摘要计数。Strict 用 `preserve` 策略留下的调外音同样会被标出 | 规格 §10.3 |
| 撤销 / 重做 | 快照是**整个项目**（`input`、`trackId`、修复开关、校验、`original`、`analysis`、来源/目标设置、`generated`、`custom`、`view`、`draft`），不含历史本身、吸附开关、选中和最近一次加载错误。对象共享引用，开销极小。会被记录的：来源/目标设置、生成、派生、修音、恢复此音、恢复原样、草稿的增删改与设置，以及**替换项目的操作**（见下一行）。不记录：切换视图、选中、吸附开关、无变化的操作。上限 **100** 步，超出丢弃最旧的。拖动只在松开时提交一次 | 规格 §10.6。设置变化也可撤销，所以“改了目标后想回到刚才的 Strict + Custom”不必重新生成 |
| 替换项目不丢数据（PR #5 审查 Major） | 导入新文件（`LOADED`）、换轨（`SELECT_TRACK`）、开关修复（`SET_REPAIR`）、`RESET`、“新建旋律”（`NEW_MELODY`）、“完成并分析”（`DRAFT_FINISH`）、“放弃”（`DRAFT_CANCEL`）都是普通的可撤销步骤：替换前的整个项目压入历史，一次撤销即恢复原曲、生成结果、custom 与视图，重做再替换回去。历史不再因加载而清空。**加载失败（`LOAD_FAILED`）不替换项目**：只显示错误，原项目与历史原样保留，也不产生撤销步骤 | 选择撤销而非确认对话框：不打断操作，也覆盖了拖入文件这类没有按钮可确认的路径。没有找到不该快照的路径：换轨与开关修复同样会从同一输入重建 `original` 并丢弃 custom，所以一并纳入。代价是历史中可能保存旧项目的引用（最多 100 步），内存可接受 |
| 快捷键 | Ctrl/⌘+Z 撤销，Shift+Ctrl/⌘+Z 或 Ctrl+Y 重做，挂在 window 上；焦点在输入框、文本框、下拉框中时不拦截，保留原生文本撤销 | 避免在简谱文本框里按 Ctrl+Z 却撤销了修音 |
| “恢复原样” | 把 custom 重置为原曲音高的副本（`forkedFrom: 'original'`），并切到 Custom；可撤销 | 一键回到原样，同时保留撤销路径 |
| 色盲友好 | 改动的音：填色 **加** 斜线（生成）或交叉线（手动）、深色描边，并有竖线连到原音高（原音高处画圆点）；原曲是虚线框；调外是 `!`；选中是双层框。音阶行：左栏 ■（来源）/ □（目标），主音行写 “1”，并有实线（来源）/ 虚线（目标）横线。乐句起点是虚线竖线加 ▼P*n* 标签。图例逐项说明形状 | 规格 §10.1：不能只用颜色表达变化 |
| 乐句标记 | 第 2 句起，在 `analysis.phrases[k].startNoteId` 的起始 tick 处画标记 | 第 1 句从头开始，不需要标记 |
| 自适应 | 载入新旋律时：横向把整首放进可视宽度（每拍 6–160 px，超长旋律停在每拍 6 px 后改为滚动）；纵向把实际用到的音域 ±2 行放进可视高度（每行 6–22 px），并滚动到旋律位置。音域另向上下各留 12 行（作曲模式 18 行），便于拖动 | 规格 §10.3 |
| 触摸 | 触摸点按只做选择，不拖动（`touch-action: pan-x pan-y`），以免与滚动卷帘冲突；修音用检查器的 ▲/▼ 按钮，新建旋律用所选音的按钮组 | 手机上滚动比拖动更常用 |
| 音符表 | 默认只列改动，可勾选“显示全部音符”；每页 100 行；点行（或行首按钮）即选中，选中行带 `aria-selected` 和 ▶；卷帘选中的音会自动翻到所在页。取代 M2a 的 diff 表（保留 `data-testid="diff-table"`） | 5 000 行一次全部渲染太慢；虚拟滚动对读屏不友好，所以选择分页 |
| 新建旋律 | 设置调（1=）、拍号（2/4、3/4、4/4、6/8）、速度和网格（四分、八分、十六分）。点空白处添加，拖动音符本体移动（时间与音高），拖右边缘改时值，Delete 删除；键盘：Enter 在所选音后添加，Shift+←/→ 移动，Alt+←/→ 改时值。不允许重叠：会造成重叠的操作直接拒绝，不做裁剪。PPQ 480，力度与简谱相同（96/127），音高限 A0–C8。“完成并分析”后按时间顺序把 ID 重编为 `new:n<k>`，作为 `input.kind = 'new'` 走与简谱相同的校验/冻结/分析流程，从此适用不可变规则 | 规格 §10.3：在此之前用户的输入本身就是 Original，不违反不可变 |
| 简谱导出 | 做了，成本不高。`writeJianpu` 在 core 中，返回 `{ ok, text, syntaxVersion, warnings }`。fast-check 测试：随机十六分音符网格旋律 × 12 个调 × 4 种拍号，写出后再解析，音高与 tick 完全相同；以及“一小节内任何 60 的倍数且 ≥ 120 的间隔，要么精确往返，要么报错”。休止：按小节线拆开后，小节内用动态规划精确分解（片数最少、尽量在拍点断开，别无选择时才跨拍），所以 540 tick 的间隔写作 `0_. 0__.`；真正无法分解的间隔（如 60）报 `UNREPRESENTABLE_REST`。警告（不阻止导出）：`VELOCITY_DROPPED`——简谱没有力度，读回时都是 96/127，一条警告列出所有受影响的音；`BAR_CROSSING_NOTE`——不在拍点上跨小节线的音（如 4/4 中 tick 1800 起的四分音符），没有连线语法，该处小节线写不出，相邻两小节合并，读回时报 `BAR_DURATION_MISMATCH`，但 tick 不变。在拍点上跨小节线的音（`-` 正好落在小节线上）小节线写得对，不报警告（有测试）。工作台对当前方案、新建旋律草稿都提供“导出简谱文本”（显示文本、警告并下载 `.jianpu`）。限制：只支持单一速度/拍号；没有连线 | 规格 §10.8。用警告而不是错误：几乎每个导入的 MIDI 力度都不同，跨小节的切分音也很常见，而 tick 仍然精确 |
| custom 的导出 | 调号与文件名沿用派生来源：从 Strict 派生 → `mode` 调号，`<source>-<root>-<mode>-custom.mid`；从移调派生 → 移调规则，`<source>-transpose-up3-custom.mid`；从原曲派生 → `source` 调号，`<source>-custom.mid`。“下载 MIDI”导出正在显示的方案，因此也能导出原曲（`<source>-original.mid`） | 规格 §11.1 |
| MISSING_DEGREES | 折叠为一行摘要（“缺 n 个音级 · 涉及 m 个调式 · 展开”），用 `<details>` 展开 | 原来的详情在示例中占了半屏 |
| 布局 | 卷帘在右栏顶部（`h-72`，≥ sm 时 `h-96`），在自己的框内滚动，画布宽度跟随框宽；音符检查器紧随其后。手机宽度下页面无横向滚动（E2E 断言，含新建旋律） | 规格 §10.2 |

## 3. 测试

- core `test/manual.test.ts`：音级与吸附、`applyManualEdit` 不改输入且只改音高（fast-check）、`writeJianpu` 的写法、错误码与往返（fast-check）。
- web `test/history.test.ts`：派生、`MANUAL_EDIT`、净改动、恢复此音、恢复原样、custom 导出后重新导入（tick 不变、文件名）、设置变化后的视图回退、撤销/重做顺序与分支、不记录的操作、100 步上限、替换项目后可撤销、加载失败保留项目；**fast-check：不变量 A/B 与 changes 一致性**；新建旋律的增删改/拒绝重叠/完成/简谱往返。
- web `test/rollGeometry.test.ts`：多拍号网格、坐标换算、音域、自适应、命中测试。
- web `test/editing.test.tsx`（Testing Library）：检查器内容、键盘选择/级进/八度/Esc、关闭吸附与调外警告、Ctrl+Z/Shift+Ctrl+Z、文本框内不拦截、新建旋律的键盘编辑与完成。
- E2E `e2e/editing.spec.ts`：生成 Strict → 从表格选中改动音 → 检查器显示 `DEGREE_MAPPED` → 键盘 ←/→/↑ 修音 → 键盘与按钮撤销/重做 → 关闭吸附后的调外警告 → 下载 custom MIDI，重新导入后 tick 完全相同、只有被改的音不同 → 恢复此音 → 恢复原样；新建旋律：鼠标添加与删除、键盘画 C D E G A G E D C、加长、导出简谱文本、撤销/重做、完成并分析、生成。手机用例增加：卷帘不超出视口、检查器按钮修音、新建旋律后仍无横向滚动。原有的无网络、无 console error、CSP 守卫不变。
- 截图：`docs/screenshots/m2b/`（桌面/手机 × 浅色/深色 × 分析、卷帘、检查器、新建旋律）。`m2a/` 保留不动。

## 4. PR #5 审查与浏览器试用的修正

| 问题 | 修正 |
|---|---|
| Major：新建旋律 / 加载 / 失败的加载 / `RESET` 会不经确认丢掉整个项目（含未导出的手动修改） | 见上表“替换项目不丢数据”。reducer 测试对每条路径做“加载 → Strict → 修音 → 替换 → 撤销”，断言修改仍在；E2E 覆盖拖入损坏文件与“新建旋律 → Ctrl/⌘+Z” |
| Minor：音符表的 `!` 只标出了有改动记录的音，`preserve` 保留的调外音没有标出 | 与卷帘、检查器一致，只按音高判断；组件测试用含 `#4` 的旋律 + `preserve` |
| Minor：新建旋律的 BPM 输入框在撤销后不同步，失焦会重新应用已撤销的值 | 输入框受控于 `draft.settings.bpm`，只在编辑中保留本地文本；失焦未改动时不派发；组件测试覆盖“改 BPM → 撤销 → 失焦” |
| 文案：调式名后紧跟 scaleId（页面文字读作 `C Doriandorian`） | `ModePicker` 与候选卡片不再显示 scaleId，改为 `title` 提示 |
| 文案：手动修改的说明是英文 | 改为中文，与 strict 的说明风格一致：`手动修改：G4 → A4`、`恢复原音：E4`、`手动修改：E4 → F4（生成结果为 Eb4）`；`remode-manual` 升为 1.0.1 |

审查中核对后**不作为问题**的两项仍然成立：`writeJianpu` 的时值覆盖与跨小节警告（见上表“简谱导出”），以及 `stepPitch` / `snapPitch` 在 0、127 边界的钳制与等距取低。

### 第二轮审查（4a4c909，`writeJianpu`）

| 问题 | 修正 |
|---|---|
| 力度被悄悄丢掉（读回为 96/127） | 新增警告通道 `JianpuWriteWarning`（`code`、`message`、`noteIds`）；力度不是 96/127 时报一条 `VELOCITY_DROPPED`，列出数量与 ID。模块头注释与 `writeJianpu` 文档改为“音高与 tick 精确往返，力度不写入” |
| 能写出的休止被拒绝（540 = 480 + 不可能的 60） | 休止在小节内做精确分解（见上表“简谱导出”）；`UNREPRESENTABLE_REST` 只留给真正无法分解的间隔，说明改为实际规则（120–720 tick、步长 60、不跨小节线） |
| 不在拍点上跨小节线的音使小节合并 | 照常导出并报 `BAR_CROSSING_NOTE`；在拍点上跨小节线的写法本来就正确，未改动并补了测试 |

工作台在 Change inspector 与新建旋律两处显示这些警告（中文标签在 `labels.ts`）。新建旋律中警告列出的是完成后的音符 ID（`new:n<k>`）。

## 5. 已知限制

- 卷帘只改音高，不能在已导入的旋律上改时值（新建旋律模式除外），按规格 §4.2 设计如此。
- 键盘修音只作用于单个音；还不支持框选或多选。
- 新建旋律只有一个速度和拍号，不能在中途改变；也不能“继续编辑”已经完成的草稿（重新新建即可）。
- 撤销历史（包括被替换的旧项目）只在内存中，刷新页面即丢失（IndexedDB 持久化属规格 §10.6 的后续工作）。
- 横向缩放以视图中心为锚点，Ctrl/⌘+滚轮不以指针位置为锚点。
- 区间循环的快捷键（规格 §10.3）随 M2c 的 Transport 实现。
- 仍只在 Chromium 上跑 E2E。
- 简谱没有连线语法：不在拍点上跨小节线的音只能报 `BAR_CROSSING_NOTE`。后续：在 §10.8 语法中加入连线（需提升解析器版本），写出时把这类音拆成连线的两段。
