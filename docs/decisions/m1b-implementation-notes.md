# M1b 实现记录与规格偏差

状态：随 `feat/m1b-strict-remode` 引入。变换版本 `remode-strict/1.1.0`、`remode-transpose/1.0.0`，CLI 0.4.0；`analysisVersion`（`remode-mode-2step/0.2.0`）与简谱解析器版本不变。
M1b 只做 Strict 换调式、半音移调、音域控制和分析器回检。不做 Expressive 优化、动机识别、同音集换主音、UI 与试听。
本文件记录对规格（`docs/ReMode-Development-Plan.md` §7、§8.6、§11.1、§12）的具体化与偏差（CLAUDE.md 规则 10）。规格 §7.3.1 与 §7.4 已写入实现约定，这里补充理由。

## 1. 模块

| 文件 | 内容 |
|---|---|
| `packages/core/src/transform/common.ts` | 结构化错误/警告码、原因码、输入检查、只替换 `pitch` 的复制 |
| `packages/core/src/transform/range.ts` | `findOctaveShift`：全曲单一整八度移位（§7.4） |
| `packages/core/src/transform/transpose.ts` | `transpose(notes, n)` |
| `packages/core/src/transform/scaleMapping.ts` | `strictRemode`、`chooseNeighbour`、`degreeMap`、`strictRemodeWithTonic` |
| `packages/core/src/transform/recheck.ts` | `recheckTarget`：分析器回检（§8.6） |

全部为纯函数，不依赖浏览器，输入数组和音符对象都不被修改（Invariant A）；输出音符由 `{ ...note, pitch }` 构造，所以 ID、tick、时长、力度原样保留，顺序与输入相同（Invariant B）。

## 2. 决定与理由

| 问题 | 决定 | 理由 |
|---|---|---|
| 5→5 怎样映射 | **按音位**（`remode-strict/1.1.0` 起）：主音以上第 k 个音 → 目标第 k 个音，保留八度，原因码 `SCALE_POSITION_MAPPED`。宫→羽：1→1、2→♭3、3→4、5→5、6→♭7。同一类型的六声之间（加清角 ↔ 加清角、加变宫 ↔ 加变宫）同样按音位；不同类型的六声之间、以及 5↔6、5↔7、6↔7、7→7 仍按音级身份 | 五声五调的音级号不同（宫 1 2 3 5 6、商 1 2 4 5 ♭7、角 1 ♭3 4 ♭6 ♭7、徵 1 2 4 5 6、羽 1 ♭3 4 5 ♭7）。`1.0.0` 按音级身份映射，宫→羽 会把 2 和 3 合并到 ♭3。用户确认改为按音位：完全确定、一一对应、保持音高顺序，每一步仍是一步。七声的音级身份就是 1–7 的顺序，所以“按音级身份”对七声不变（测试断言两者在全部七声组合上结果相同）。调外音仍按调外音策略 |
| 规模不同、或类型不同的六声 | 一律按音级身份：同号直接映射，缺号走邻音 | 两边的音位没有对应关系；音级身份是唯一有意义的对照 |
| 目标有同号但升降不同 | 直接映射（如 3→♭3、♯4→4），记 `DEGREE_MAPPED` | 这正是“同号音级”的含义；7→7 由此完全确定 |
| “优先与下一音方向一致”的含义 | 比较的是“本音到下一音”的**进行方向**：候选音到下一音输出音高的方向（上/下/同音）与原曲相同者优先 | 字面另一种读法（“下一音在上方就选上方邻音”）在下行到邻音时会制造同音，例如宫→羽中 `2 1`（D→C）会变成 C C；按进行方向比较则得到 Eb C，保留了下行。为此 Strict 按时间倒序映射，下一音的输出已知；结果仍完全确定 |
| 平局“靠近主音” | 到任一八度主音的距离较小者；再平局取下方 | “靠近主音”需要一个可计算的定义；再平局只在三全音对称时出现，取下方是任意但确定的选择 |
| 测试中的“平局” | 现有音阶库里缺失音级都落在小三度空隙中（两个候选距离 1 与 2），所以 7→5 不会出现距离平局。平局规则由 `chooseNeighbour` 单元测试与调外音（`nearest`）覆盖 | 如实记录，避免为了测试而构造不存在的情形 |
| 调外音 `nearest` | 与缺失音级同一个邻音规则（先方向、再距离、再主音）；已在目标音阶中的调外音保留 | 一条规则；C 大调中的 Eb 换到 Dorian 后本来就合法，没有理由改 |
| `preserve` 与严格目标 | `strictTarget` 默认 true；`preserve` + 严格 → `PRESERVE_REQUIRES_LOOSE_TARGET`。CLI 的 `--accidentals preserve` 自动声明非严格，并在报告 `transform.strictTarget` 中写明 | 核心 API 保证 Invariant D 默认成立；CLI 用户选 `preserve` 本身就是放弃严格 |
| 特征音曝光 | “有差别的音级”包括只有一方拥有的音级号；只看来源拥有、且旋律调内音实际用到的那些 | 5→7（宫五声 → Lydian）时目标新增的 ♯4、7 旋律不可能用到，输出必然不变，应当提示 |
| `NO_CHARACTERISTIC_DEGREE` 的措辞 | 只有在确实没有任何改动时才说“输出与原曲相同”；否则说“调内音未改变（变化只来自调外音或音域）” | 调外音 `nearest` 或音域移位可能仍改动音符 |
| 诊断阈值 | `CONTOUR_REVERSED`：任何一处反转；`REPETITION_INTRODUCED`：新增同音步数 ≥ 2 且 ≥ 10%。阈值写入 `transform.diagnostics` | 规则 6：可追踪；反转在 Strict 中罕见，一处就值得提示 |
| 音域参照中心 | Strict 以原曲音域中点为参照；移调以移调后的音域中点为参照 | 移调的意图就是改变音区，不应被拉回原音区；Strict 的映射只改动 ±1–2 半音，参照原曲即可 |
| 软音域无解 | 退而只满足 0–127，警告 `RANGE_NO_FIT`；关闭软音域时不移位，越界即错误 | 规格要求“提示用户”；只有在无法保证合法 MIDI 时才拒绝 |
| 音域移位的原因码 | 映射与移位都改动的音保留映射原因码，说明中追加“全曲整体移动 k 个八度”；只因移位改动的音为 `RANGE_ADJUSTMENT` | `PitchChange` 只有一个 `reasonCode`；主要原因是映射 |
| 换主音且换调式 | `strictRemodeWithTonic`：先移调（默认 −5…+6 中较小的移动，可显式指定，但必须把来源主音移到目标主音），再同主音 Strict；`steps` 分两步给出，最终变体的 `changes` 对比原曲与最终结果，说明把两步串起来 | §7.1 要求两步明确显示 |
| 移调变体 ID | `custom` | `VariantId` 中没有 transpose；移调不是一种命名策略 |
| `createdAt` | 可由调用方传入，默认 `Date.now()` | 测试需要确定性输出 |

## 3. 分析器回检（§8.6）

`recheckTarget(notes, target, { ppq, timeSignatures })` 运行分析器（不含 K-S 基线），当目标调式是 rank-1 候选的主名称，或某个 rank-1 候选的别名（同音集同主音，如 C Ionian 与 C 宫清乐）时，`recognised = true`，`matchedAs` 为 `primary` 或 `alias`。它只出现在报告和测试断言中，从不参与映射决策。“未识别”是正常结果：例如只用 C D E G A 的旋律 Ionian → Lydian 后仍被识别为 C 宫五声（`MISSING_DEGREES`），测试断言 `recognised = false`。

测试中的回检断言：49 个教会调式两两组合全部识别为目标；C 大调 fixture → C 羽、C 宫 → C 羽（按音位）识别为目标；`NO_CHARACTERISTIC_DEGREE` 样本识别失败。

## 4. CLI 0.4.0

- `transpose <input> --semitones N`：`--semitones -3` 被改写为 `--semitones=-3` 后再交给 `parseArgs`（它把 `-3` 当作选项）。来源有调号且 N 不是 12 的倍数时不写调号，警告 `KEY_SIGNATURES_OMITTED`（转写调号需要处理拼写，留待以后）。默认文件名 `<source>-transpose-up<N>.mid` / `-down<N>.mid`。
- `remode <input> --to [<root>:]<scaleId>`：
  - 来源调式：`--from <root>:<scaleId>`，否则取 rank-1 候选。rank 1 有多个不同调式，或有 `TONIC_UNCLEAR`、`MULTIPLE_COLLECTIONS`、`CHROMATIC_HEAVY`、`TOO_SHORT` 时，退出码 6（`SOURCE_MODE_AMBIGUOUS`）并要求 `--from`。`MISSING_DEGREES` 不阻止：此时 rank-1 是较小的音集（如五声），从它出发的映射是确定的；歧义仍列在 `sourceAnalysis.ambiguities` 中。
  - `--to` 带根音且与来源不同 → 两步（`steps`）。
  - 调号策略 `mode`（目标音集调号 + `ReMode mode: …` Text 事件），文件名 `<source>-<root>-<scaleId>-strict.mid`（§11.1）。
  - `--strategy strict` 可选，其他值为用法错误（Expressive 在 M3）。
  - 报告：`sourceAnalysis`、`sourceMode`、`targetMode`、`transform`、`steps`、`summary`、`diff`、`warnings`、`diagnostics`、`recheck`、`output`、`export`、`errors`。
- MIDI 输入的 `transpose` / `remode` 支持 `--track` 与 `--repair`；导出时报告丢弃的弯音、CC64 与其他轨道。
- `export` 仍只接受简谱：MIDI → MIDI 不做变换没有意义，提示改用 `transpose` 或 `remode`。
- 新退出码：6 来源调式歧义，7 变换失败（`ACCIDENTAL_REJECTED`、`PITCH_OUT_OF_RANGE` 等）。

## 5. 测试

- `packages/core/test/transform.test.ts`：移调（含负数、越界、无效输入）；`findOctaveShift`；49 对教会调式 7→7（逐音期望值 + Invariant F + 回检）；清乐/雅乐/燕乐 7→7；低于主音与跨八度；宫→羽与全部 20 对有序五声组合（按音位：双射、轮廓不变）；同类与跨类六声；七声上音级身份与音位结果相同；7→5 邻音（方向、距离、平局规则）；6→5 / 7→6；5→7；`NO_CHARACTERISTIC_DEGREE`；三种调外音策略；音域移位与无解；两步换主音；Strict 输出导出 → 再导入（Invariant E）；全部音阶两两组合可运行。
- `packages/core/test/transform.property.test.ts`（fast-check，固定种子）：随机单声部旋律、音阶、主音与音域设置下的 Invariant A、B、C、D，以及“每个改动的音恰有一条 `PitchChange`”；七声 → 七声的 Invariant F；五声/同类六声之间按音位映射的双射与保序。
- 新增简谱 fixture `mode-church-c-ionian.jianpu`（MIDI 孪生 `mode-church-c-ionian.mid`）。
- `tools/cli/test/cli.test.ts`：两个新命令的成功路径、歧义拒绝、两步换主音、调外音策略、MIDI 输入、音域与用法错误。
- `pnpm smoke` 增加了移调与 Strict 换调式，以及对 Strict 输出的再分析。

## 6. 已知限制

- 移调不转写调号，只省略。
- 局部八度折叠未实现（§7.4 中为可选附加策略）。
- 轮廓与重复只做诊断；改善它们是 Expressive（M3）的工作。
