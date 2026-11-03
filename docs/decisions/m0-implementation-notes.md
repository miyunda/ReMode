# M0 实现记录与规格偏差

状态：随 `feat/m0-core-cli` 引入，`analysisVersion = remode-mode-2step/0.1.0`。
本文件记录 M0 实现时对规格（`docs/ReMode-Development-Plan.md` v1.1）的具体化与偏差（CLAUDE.md 规则 10）。

## 1. 音集划分（§6.3）

规格示例中的 `collectionId` 包含 `'hexa-qingjiao'` 等音阶类型名。实现按**音高集合**划分音集，中国音阶解读作为同一音集上的命名：

| collectionId | 参考集合（相对 transposition） | 命名解读 |
|---|---|---|
| `pentatonic` | `{0,2,4,7,9}` | 五声，宫 = T |
| `hexatonic` | `{0,2,4,5,7,9}` | 六声加清角（宫 = T）；六声加变宫（宫 = T+5） |
| `diatonic` | `{0,2,4,5,7,9,11}` | 教会调式（Ionian = T）；七声清乐（宫 = T）、雅乐（宫 = T+5）、燕乐（宫 = T+7） |

理由：六声加清角与六声加变宫是同一个音高集合（C 宫加清角 = F 宫加变宫），清乐/雅乐/燕乐也都是自然七声音集的旋转。若分别作为音集，同一旋律会在 step 1 被重复计数，并虚报 `MULTIPLE_COLLECTIONS`。现在：

- 每个候选的 `scaleId` 取第一个可用解读（教会调式优先于七声中国命名；清角优先于变宫），其余同主音的解读列入 `aliases`。
- 中国解读只在主音为五正音时产生；偏音永不作主音。

## 2. 输出字段

- `CollectionMatch.unusedDegrees`：绝对音级 0..11（step 1 尚无主音）。相对主音的缺失级数在 `MISSING_DEGREES` 歧义的 `missingDegrees` 中给出。
- `ModeCandidate` 增加 `name`、`chinese`、`aliases`、`evidencePoints`（证据点数之和）。
- `TonicEvidence` 增加 `matched`、`of`、`detail`，可直接显示为“3 个乐句中 2 个结束于 D”。
- `Ambiguity` 增加 `affectedModes`（主音 + scaleId + 名称）与 `missingDegrees`。
- `ModeAnalysis` 增加 `config`、`noteCount`、`pcd`、`compatibleCollections`、`selectedCollections`、`phrases`、`baseline`。

## 3. 主音证据与排序（§6.4）

默认点数（未经校准，M4 用语料校准后提升版本）：

| 证据 | 最高点数 | 给点方式 |
|---|---|---|
| `FINAL_NOTE` | 6 | 尾音音级等于候选主音 |
| `PHRASE_END` | 4 | round(4 × 命中的非末句句末数 / 非末句数) |
| `LONG_NOTE` | 3 | 长音 = 时值 ≥ 1.5 × 平均时值；按比例取整 |
| `STRONG_BEAT` | 3 | 强拍 = 小节首拍，次强拍 = 4/x 第 3 拍、6/x 9/x 12/x 每组首拍；按比例取整 |
| `AMBITUS` | 1 | 最低或最高音为主音（正格），或最低音为属音（变格） |
| `FIRST_NOTE` | 1 | 首音为主音 |

- 排序键：`evidencePoints` 降序 → 覆盖率降序 → 音集顺序 → 主音音级。点数与覆盖率都相同的候选并列同名次。
- 这是具名整数点数的透明加和，与每条证据并列输出；不是概率，也不以百分比显示。
- 只有旋律中实际出现过的音级才能成为主音候选。
- 乐句分段（§8.2 的启发式子集）：休止 ≥ 0.5 拍，或时值 ≥ 2 × 中位时值且 ≥ 1 拍的音之后断句。
- 拍位假设拍号变化落在小节线上、旋律没有弱起；弱起旋律的强拍证据会错位（已知限制）。

## 4. 歧义规则（§6.5）

| 代码 | 触发条件 |
|---|---|
| `TOO_SHORT` | 音符数 < 6 或不同音级 < 3 |
| `CHROMATIC_HEAVY` | 没有音集覆盖率 ≥ 0.95；退回覆盖率最高的自然七声音集，候选带 `BELOW_COVERAGE_THRESHOLD` |
| `MULTIPLE_COLLECTIONS` | 最小规模的兼容音集多于一个 |
| `TONIC_UNCLEAR` | 首选候选领先其他主音不足 2 点，或首选主音没有尾音支持 |
| `MISSING_DEGREES` | 对首选主音，兼容的自然七声音集给出不止一个教会调式；列出全部教会调式和七声中国解读，以及区分它们所需的级数 |

## 5. MIDI 导入（§5）

- `@tonejs/midi` 锁定为 2.0.28。它会把每条源轨按 (channel, program) 拆分，并在 format 1 中丢弃无音符的首轨（conductor track）。因此 `track-N` 指的是拆分后的轨道列表：Type 0 多通道文件自然按通道拆开；同一通道中途换音色会被拆成两轨（已知限制）。
- `@tonejs/midi` 只发布 CJS/UMD，因此以 default import 取用。CI 在构建后对 CLI 做冒烟测试，以捕获 Vitest 会掩盖的互操作问题。
- 预检：空文件、超过 4 MiB、缺少 `MThd`、头部非法、chunk 截断、无 `MTrk`、format 2、SMPTE 时基，均为结构化错误。总音符数上限 20 000。
- 文本元事件按严格 UTF-8 重新解码，失败时保留 Latin-1。
- 缺少 tick 0 的速度/拍号时补 120 BPM / 4/4，并给出警告。同一 tick 的重复事件保留最后一个。
- 没有 note-off 的 note-on 会被解析器丢弃，校验器看不到（已知限制）。

## 6. 单音校验与修复（§5.2）

- 容差 = min(15 ms 按该处速度换算的 tick 数, PPQ/16)。只有相邻两音之间、不嵌套、无同起点和弦、且在容差内的尾部粘连才 `repairable`，严重级别为 warning，分析照常进行；其余重叠为 error。
- `repairLegatoOverlaps` 只能显式调用（CLI 的 `--repair`）。它返回新的 `cleaned-source`，每处修改记录 `from/to/overlapTicks/overlapMs/causedBy`，原数组不变。

## 7. 工具链

- TypeScript 锁定 6.0.3：typescript-eslint 8.72 只支持 `<6.1`，TS 7 待其支持后再升级。
- Fixture 用 TypeScript 中的音高/时值数组描述，经独立的最小 SMF 写入器生成 `.mid`，再由测试比对已提交的字节。ADR-016 要求 fixture 优先用简谱，但简谱解析器属于 M1；到时再把旋律类 fixture 迁移为简谱。
- 音名拼写使用固定表（C Db D Eb E F F# G Ab A Bb B），暂不按上下文选择等音拼写。
