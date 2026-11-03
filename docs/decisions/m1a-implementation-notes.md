# M1a 实现记录与规格偏差

状态：随 `feat/m1a-jianpu-export` 引入。简谱解析器 `remode-jianpu/1.0.0`，CLI 0.3.0；`analysisVersion` 不变（`remode-mode-2step/0.2.0`）。
M1a 只做输入/输出：简谱解析、MIDI 导出、round-trip、CLI。没有任何音高变换（M1b）。
本文件记录对规格（`docs/ReMode-Development-Plan.md` §10.8、§11、§12.3）的具体化与偏差（CLAUDE.md 规则 10）。

## 1. 简谱解析（§10.8，`packages/core/src/text/jianpu.ts`）

规格 §10.8.1 列出了语法约定，这里记录取舍的理由。

| 问题 | 决定 | 理由 |
|---|---|---|
| 参照八度 | 无标记的 `1` = 调号音在第 4 八度（`1=C` → C4 = 60，`1=G` → G4，`1=Cb` → Cb4 = 59） | 与科学音高命名直接对应（"Bb4"），不需要另一条“最靠近中央 C”的规则；`1=G` 时旋律常写在 `5,`～`5` 之间，结果仍在常用音域 |
| 一拍的长度 | 不带记号的数字永远是四分音符，与拍号分母无关 | 简谱惯例：6/8 中八分音符要写减时线。`-` 因此也是一个四分音符 |
| PPQ | 固定 480 | 十六分附点（180 tick）等所有支持的时值都是整数 tick；与 fixture 生成器一致 |
| 力度 | 固定 96/127 | 必须是 7 位 MIDI 力度才能 round-trip 精确；96 与 fixture 的默认力度相同，所以简谱与 MIDI 孪生 fixture 的音符完全一致 |
| 速度头 | `bpm=<n>` 与 `♩=<n>` 都接受，默认 120（不发警告） | 前者便于键盘输入，后者是印刷简谱的写法 |
| 缺调号/拍号 | 按 `1=C`、4/4 处理，并警告 `DEFAULT_KEY` / `DEFAULT_TIME_SIGNATURE` | 与 MIDI 导入缺省值的处理方式一致 |
| 头部位置 | 只能在第一个音之前 | 中途转调/变拍属于子集之外；报 `HEADER_AFTER_NOTES`，而不是静默接受 |
| 调号写入 | `1=X` 写成 X 大调调号（即宫系统的调号）；`A#`、`D#` 等 MIDI 调号无法表示的拼写改用等音（`Bb`）并警告 `KEY_SIGNATURE_RESPELLED` | `1=X` 表示宫（do）= X，与 §11.1 “按宫系统写调号”一致 |
| 小节检查 | 小节时值 = 写在两条小节线之间的音、休止与 `-`；`-` 计入它所在的小节，即使它延长的是上一小节的音 | 与读谱的直观一致；跨小节的延长可以写成 `2 1 - - | - |` |
| 弱起 | 不特殊处理：首小节不足也报 `BAR_DURATION_MISMATCH` 警告 | MIDI 没有弱起的概念，分析器也假定无弱起（M0 已知限制）；警告让用户知道强拍证据可能错位 |
| 错误 | 一次报告全部错误，每条带 1 起的 `line`/`column`（UTF-16 码元） | 便于 UI 一次性标注 |
| 扩展记号 | `//` 行注释、`||` 视同小节线、`’` 视同 `'`、`♯`/`♭` 视同 `#`/`b`、记号之间可不留空格 | 均不改变含义，只降低复制粘贴时的出错率 |

**音符 ID**：`<prefix>:n<k>`，默认前缀 `jianpu`，k 按音符出现顺序（休止不占号）。同一文本总是得到同一组 ID。编辑文本前部会让后面的 ID 移位；对“同一来源的不同变体共享 ID”（§4.2）没有影响，因为变体从解析结果派生。

## 2. MIDI 导出（§11，`packages/core/src/midi/export.ts`）

- 输出 format 1：指挥轨（调号、Text 元事件、速度、拍号）+ 一条旋律轨（轨名、program change、音符）。Channel 与 program 来自 `MidiMetadata`，缺省 0。
- **不重新量化**：tick、时长按原值写入；导出不依赖秒数。
- **速度**：MIDI 以整数微秒/四分音符存速度。`@tonejs/midi` 写 `floor(60e6 / bpm)`，浮点误差可能让 90 BPM（666 667 µs）写成 666 666。导出器先取最近的整数微秒，再传入一个保证 floor 后恰为该整数的 bpm。从 MIDI 读入的速度因此原样写回；不是整数微秒的速度（如简谱 `bpm=70` = 857 142.86 µs）写为最近整数并警告 `TEMPO_ROUNDED`。
- **力度**：同理，按 7 位整数写入；不是 k/127 的力度四舍五入并警告 `VELOCITY_QUANTIZED`；力度 0 会被 MIDI 当作 note-off，因此写为 1 并警告 `VELOCITY_ZERO_RAISED`。
- **调号（§11.1）**：策略 `source`（默认）/ `omit` / `mode`。
  - `mode`：写目标所在七声音集的大调调号。五声、六声中国调式用其宫系统（D 徵调式 → G 宫 → 1 个升号；六声加变宫也按宫）；七声调式用实际音集（C 宫雅乐含 F# → G 大调，C 宫燕乐含 Bb → F 大调）；教会调式用其所属自然音集（D Dorian → C）。实际调式写入 tick 0 的 Text 元事件 `ReMode mode: <调式名> [<scaleId>]`（UTF-8），并出现在导出报告的 `keySignature.mode` 中。来源已有调号时警告 `SOURCE_KEY_SIGNATURES_REPLACED`。
  - `source`：MIDI 调号只能表示 -7～+7 个升降号，无法编码的条目丢弃并警告 `KEY_SIGNATURE_DROPPED`。
- **`@tonejs/midi` 2.0.28 的调号缺陷**：它的编码器把升降号数写成 `index + 7`（应为 `index - 7`），所以任何调号都会偏移 14，解码后变成 `undefined`。导出器在编码后修正指挥轨中 `FF 59` 事件的那个字节（`fixKeySignatureBytes`），测试覆盖全部 15 个大调和 15 个小调调号。升级 `@tonejs/midi` 时须重新检查。
- **文本编码**：`midi-file` 把每个 UTF-16 码元当作一个字节写出，中文轨名会被写坏。导出器先把轨名与 Text 事件转成 UTF-8 字节串（`encodeMidiText`），导入端已有的 `decodeMidiText` 再还原。
- **报告而不静默丢弃**：`MidiMetadata` 不携带弯音、CC、其他轨道。调用方可通过 `options.source`（`hasPitchBend`、`hasSustainPedal`、`droppedTracks`）声明这些事实，导出器分别给出 `PITCH_BEND_DROPPED`、`SUSTAIN_PEDAL_DROPPED`、`TRACKS_DROPPED` 警告。非法数据（音高越界、非整数或负 tick、时长 ≤ 0、力度不在 0..1、非法 PPQ/速度/拍号/通道/program、未知 scaleId）是结构化错误，此时不输出任何字节。
- **文件名**：`exportFileName` 按 §11.1 模式 `<source>-<root>-<mode>-<variant>.mid`，规则见规格。

## 3. Round-trip（Invariant E，§12.3）

`packages/core/test/roundtrip.test.ts` 对每个通过校验的 MIDI fixture 轨道、每个简谱 fixture 以及若干内联简谱，检查 导出 → 再导入 后：音符数、音高、起始 tick、时长、力度、PPQ、速度（按整数微秒比较）、拍号、调号、channel、program、轨名均相同，且再导出一次的字节完全相同（多轮导出不漂移）。

## 4. Fixture（ADR-016）

- `tools/fixtures` 的目录项可以是简谱文本（`.jianpu`，UTF-8），原样写入 `fixtures/generated/`。生成器不调用被测的解析器，与 MIDI fixture 用独立 SMF 写入器的原则一致。
- 本次新增三个简谱 fixture，各有一个 MIDI 孪生：`mode-church-c-dorian`（首调写法 `1=Bb`，主音为 `2`）、`mode-pentatonic-c-gong-zhi`、`missing-degrees-cdega`（末小节只有一拍，验证 `BAR_DURATION_MISMATCH` 只是警告）。测试断言简谱与孪生 MIDI 的音符、PPQ、速度、拍号完全相同，`analyzeMode` 的完整输出（音符 ID 按序号归一后）完全相同。
- 其余旋律类 fixture 暂未迁移为简谱；拍号变化、多轨、畸形数据等本来就只能用 MIDI 表达。

## 5. CLI

- 两个子命令的输入方式相同（CLI 0.3.0 统一）：位置参数是文件，按扩展名判断格式（`.jianpu`、`.txt` 按 UTF-8 简谱解析，其他按 MIDI）；`--jianpu "<text>"` 永远是内联文本，不当作路径。两者同时给出或都不给是用法错误。
- `analyze`：报告的 `input.format` 与 `import.source` 标明来源；简谱输入的 `selectedTrack` 为 `"jianpu"`，`--track` 不适用（用法错误）。解析失败退出码 3，`errors` 中每条带行列号。
- `export <file.jianpu> [-o out.mid]` 或 `export --jianpu "<text>"`：只做简谱 → MIDI，保留来源调号（`1=X` → X 大调）。不给 `-o` 时按 `exportFileName` 写到当前目录（`<source>-original.mid`，内联文本为 `melody-original.mid`）。MIDI 输入在 M1b 有变换之前没有可转换的内容，给出明确提示并以用法错误（退出码 1）拒绝。编码失败退出码 5。
- 0.2.0 中 `export --jianpu` 曾表示文件路径，与 `analyze` 不一致；0.3.0 起统一。
- `pnpm smoke` 增加了：分析简谱 fixture、导出为 MIDI、再分析导出的文件。
