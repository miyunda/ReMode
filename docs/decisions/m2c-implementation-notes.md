# M2c 实现记录与规格偏差

状态：随 `feat/m2c-playback-audition` 引入。core 没有改动，所有算法版本号不变；新增依赖 `tone@15.1.22`（只在 `apps/web`）。
M2c 做 Transport、循环、drone、音符试听，以及新建旋律草稿的试听与播放。不做 soundfont / 采样、Expressive 优化器、PWA。
本文件记录对规格（`docs/ReMode-Development-Plan.md` §10.3、§10.4、§14 M2、§18 问题 5、ADR-014）的具体化与偏差（CLAUDE.md 规则 10）。

**无头测试听不到声音。** 自动测试只能证明调度正确、状态正确、没有 CSP 违规和错误。音色、音量平衡、drone 是否好听、延迟手感，都必须人工试听。

## 1. 结构

| 文件 | 内容 |
|---|---|
| `apps/web/src/audio/backend.ts` | `AudioBackend` 接口（`now`、`note`、`cancel`、`setDrone`、`setLevels`、`setTimbre`）和 `AudioHost` |
| `apps/web/src/audio/engine.ts` | `PlaybackEngine`：Transport、预排程、循环、drone 同步、试听。无 Tone.js、无 DOM，时钟来自后端，定时器可注入 |
| `apps/web/src/audio/timeline.ts` | tempo map：tick ⇄ 秒（纯函数） |
| `apps/web/src/audio/drone.ts` | drone 音高、调式是否有纯五度（纯函数） |
| `apps/web/src/audio/timbres.ts` | 三种振荡器音色的参数 |
| `apps/web/src/audio/prefs.ts` | 受保护的 localStorage 偏好（键 `remode.audio`） |
| `apps/web/src/audio/toneBackend.ts` | Tone.js 实现。**全项目唯一导入 Tone.js 的文件**，单独成 chunk |
| `apps/web/src/audio/webAudioHost.ts` | 用户手势 → 运行中的 AudioContext；预取音频 chunk |
| `apps/web/src/audio/AudioProvider.tsx` | React 绑定：`useTransport`、`useRollAudio`、`ProgramSync`、`programOf` |
| `apps/web/src/components/TransportPanel.tsx` | Transport 面板和快捷键 |
| `apps/web/src/lib/keyboard.ts` | 判断按键归谁（文本框 / 控件 / Transport） |

## 2. 决定与理由

| 问题 | 决定 | 理由 |
|---|---|---|
| Tone.js 版本 | **15.1.22**（npm `latest`，2025-04 发布），精确锁定。`next` 标签（15.5.x）是开发版，不用 | 稳定版，且已在下面的 CSP 条件下实测 |
| CSP | **`_headers` 没有改动**。Tone 有两处会被 `worker-src 'self'` / `script-src 'self'` 拒绝：`Ticker` 的默认时钟用 blob: Worker；`AudioWorklet` 也用 blob: URL。做法：① 不从 `tone` 根模块导入，它的 `index.js` 在求值时调用 `getContext()`，加载页面就会创建默认 Context、AudioContext 和 blob Worker；改为深路径导入 `Global`、`Context`、`Synth`。② 在创建任何节点之前 `setContext()`，用 `clockSource: 'timeout'` 的 Context。③ 不用任何 Worklet 节点 | 不放宽策略比放宽好。实测：无头 Chromium 在生产 CSP 下没有违规和 console error；临时探针（在 destination 前接 AnalyserNode，未入库）读到播放时 RMS 约 0.1，暂停 300 ms 后约 0.0008，说明真的有输出且没有粘连。`test/boundaries.test.ts` 防止有人改回根模块导入 |
| 用不用 Tone.Transport | **不用**。engine 自己做预排程，Tone 只负责合成 | 一个 tick 位置、一份 tempo map，由纯逻辑换算；这样切换方案、循环、定位都能用假后端精确测试 |
| 调度 | 预排程：每 25 ms 把未来 150 ms 内的音交给后端（隐藏标签页 1.5 s，因为定时器被节流）。播放时间轴是一串“段”：音频时间 T 时位置是 tick P，运行到 tick E。循环追加一段；切换、定位、改循环都取消所有音并在当前位置开新段（延后 30 ms，保证第一个音不迟到）。待发声的音只有一个来源，所以不会粘连或叠音 | 经典做法。fast-check 属性测试随机组合播放、暂停、停止、定位、切换、循环和时间推进（200 轮），每一步断言最多一个音在响、位置在范围内、不播放时没有声音也没有 drone，整轮结束后断言任何两个音都没有在时间上重叠 |
| 切换方案 | 位置以 tick 保持。跨越当前位置的音从当前位置发声（剩余不足 30 ms 的跳过）。发声内容完全相同时（如改了调式但音相同）不重启，避免无谓的重新起音 | A/B 比较时，长音上切换也要立刻听到新方案 |
| 每个音一个 Synth | 每个音 `new Synth`，经一个原生 GainNode 接到总线，结束后释放；取消时 GainNode 用 `setTargetAtTime` 约 6 ms 淡出，未开始的直接释放 | Tone 的 `PolySynth` 靠 Context 时钟延迟触发，取消已排程的音很麻烦。实测：300 BPM 十六分音符（每秒 20 个音）播放 5 秒，没有 long task，JS 堆约 11 MB |
| 解锁音频 | `AudioContext` 在手势内同步创建并 `resume()`（`webAudioHost.ts`），Tone 之后接管这个 Context，而不是调用 `Tone.start()`。触摸的 pointerdown 不算激活，所以挂一次 pointerup/click 重试。等待运行超过 3 秒就报“音频未能启动”，下次手势重试 | Safari 不接受 await 之后的 `resume()`，而 Tone 是懒加载的，必须在 await 之前。`Tone.start()` 做的也是 `resume()` |
| 第一次手势不丢声音 | `audition` 记下待发声的音高，后端就绪后发声；连续多次取最后一个。`play` 同理，就绪前按了停止则取消 | 任务要求 |
| 懒加载 + 无运行时请求 | `toneBackend` 是动态 import，不进入入口 chunk；但在 `main.tsx` 里页面加载时就取回（`preloadAudio`）。模块求值没有副作用，不创建 AudioContext | 若首次手势才取，既违反“运行时不发请求”（E2E 断言），也让“加载后断网”时播放失败（§14 DoD）。首屏 JS 不变大，只是多一个并行请求 |
| 体积 | 入口 JS 402.09 → 426.37 kB（gzip 128.17 → 136.64）；新增懒加载 chunk 209.92 kB（gzip 53.12）。CSS 20.53 → 21.22 kB | 深路径导入只带 `Synth` 及其依赖，不带 Tone 的其余部分 |
| **drone 默认状态（§18 问题 5 是开放问题）** | **默认开，仅主音**，音量 60%（相对主音量）。保存在 localStorage。改默认值只需改 `DEFAULT_AUDIO_PREFS` 一行 | ADR-014 与产品原则 8：调式色彩要被听见，默认关的话多数用户根本听不到差别。只用主音而不是主音 + 五度：主音是唯一所有调式都有的参照；纯五度在 Locrian、角调式等调内不存在。**这只是暂定，规格仍把它列为待试听验证的问题**，请人工试听后决定 |
| drone 音高 | 根音固定在 G2–F#3 这一个八度内；五度始终是纯五度（+7） | 不随旋律音域变化，切换方案时音域不跳。旋律落在很低的音区时会与 drone 相撞，属已知限制 |
| drone 与主音 | 所选方案的调式：原曲 = 来源调式；Strict = 目标；移调 = 来源调式平移；Custom = 派生来源的调式；草稿 = `1=` 的调（ionian）。来源调式未确定（`sourceMode` 不成立）时**不猜**，不发声并提示先指定 | 猜错的 drone 比没有更误导。新增 `variantMode`（`state/project.ts`） |
| 没有纯五度的调式 | “主音 + 五度”仍给纯五度，但显示警告“此调式没有纯五度” | 规格写的就是主音 + 五度；不悄悄改音 |
| drone 导出 | **没有做**独立轨导出，留待后续（§10.4） | 需要改 core 的导出器和导出界面，属于单独的切片。drone 不经过导出路径，E2E 断言下载的 MIDI 只有一轨且音数不变 |
| 循环 | `L` 开关，`[` `]` 在播放位置设起点/终点，卷帘标尺拖动设区间（吸附八分音符），另有按钮。没有区间时 `L` 循环整首。跨过循环终点的音在终点截断；从起点之前开始的音在起点发声；播放头在区间之后时跑到曲终。开关循环可能让正在响的音重新起音 | 按钮保证手机和键盘都能设置，因为触摸拖动标尺会滚动卷帘 |
| 标尺 | 点击定位（吸附十六分音符）；移动 6 px 以上算拖动 | 区分点击与拖动 |
| 结束 / 停止 | 到曲终或按停止：状态 stopped，回到开头。暂停保持位置。在曲终按播放从头开始（有循环时从循环起点） | 常见行为 |
| 换旋律 | 同一旋律的方案共享位置；换了 `original`（或进出草稿）就停止并回到开头，清除循环。编辑 Custom 或草稿时继续播放，从当前位置用新音符重排 | 位置只在同一条旋律内才有意义 |
| 空格 | 文本框、文本域、下拉框内不接管。按钮、链接、复选框如果是键盘到达的，空格归它们（原生激活）；如果是鼠标点到的，空格归 Transport。判断方法是记录最后一次是指针还是 Tab 移动的焦点，**不能用 `:focus-visible`**：按键本身会让它变真 | 否则点了方案标签后按空格，只会再点一次标签，A/B 比较时无法暂停。E2E 覆盖了这几种情况，包括空格不会触发两次 |
| 试听的发声点 | 显式写在交互处（`onAudition`），不用 effect 监听状态 | 撤销、切换视图也会改变音高，但这些不该发声。拖动用 ref 记住最后发声的音高，因为 pointermove 可能在两次渲染之间连续到达。提交（松开指针）不发声。被拒绝的添加或改音（重叠、超限）不发声 |
| 试听开关 | 默认开，localStorage 持久化，关闭时连左栏琴键也不发声。播放时静音（含等待后端加载期间）；暂停时恢复 | 一个开关，一条规则 |
| 一次一个试听音 | 新试听截断上一个；时值 0.35 s | 快速 ←/→ 不堆积 |
| Transport 位置 | 放在卷帘正下方、音符检查器之上，替换原占位（原占位在检查器之下） | 规格 §10.2 的布局如此，也让播放控件离卷帘最近 |
| 不重渲染 | 位置不进 React：播放头和读数在 rAF 中直接写 DOM（`data-tick` 供 E2E 读取） | 播放时 React 不重绘卷帘和表格 |
| 无障碍 | 所有控件可 Tab 到达并有标签；循环 `aria-pressed` 且文字写“开/关”；状态文字 `aria-live`；位置滑块带 `aria-valuetext`，是标尺的键盘替代；循环区间有文字，卷帘上有实线和 `[ ]`，不只靠颜色；最近试听的音名显示在 Transport | 规格 §10.1，任务第 6 条：不只靠声音 |

## 3. 测试

- `test/engine.test.ts`（假后端 `test/fakeAudio.ts`）：跨速度变化的排程、预排程窗口、隐藏标签页、到曲终结束、迟到的定时器、暂停/停止/定位、加载中取消、失败重试、无 Web Audio；切换方案（位置、释放、已排程音取消、相同内容不重启、换旋律、删空草稿、改速度）；循环（精确重复、截断、回绕、起点之前的音、区间之后、边界设置）；drone（只在播放时、跟随主音、无主音、模式、不进入旋律音）；试听（解锁手势不丢声、取最后一个、截断、播放时静音、开关）；偏好；fast-check 不变量。
- `test/timeline.test.ts`：多段速度、默认 120 BPM、无效事件、乱序、单调与往返（fast-check）。
- `test/audioPure.test.ts`：drone 音高、纯五度判断、偏好的解析与存储异常、空格归属。
- `test/transport.test.tsx`（Testing Library + 假后端）：面板状态与标签、空格 / L / `[` `]`、标尺点击与拖动、表格/键盘/检查器试听、拖动时每个音高只响一次、左栏琴键、草稿的添加与播放、完成草稿后停止。
- `test/boundaries.test.ts`：core 没有 Tone.js 导入和依赖；web 中只有 `toneBackend.ts` 导入，且不是根模块；没有静态导入 `toneBackend`。
- `e2e/playback.spec.ts`：真实 Tone.js、生产 CSP，沿用无网络、无 console error、无 CSP 违规的守卫。只断言状态，不断言声音。手机用例用真实触摸点按。
- 截图：`docs/screenshots/m2c/`（在 M2b 的基础上增加 transport）。`m2a/`、`m2b/` 保留不动。

## 4. 已知限制

- **听感未经验证。** 三种音色和音量平衡是按经验写的，没有人听过。
- E2E 只在 Chromium 上跑。Safari / iOS 的解锁路径按已知行为编写，没有实测。iOS 的静音开关会让 Web Audio 无声。
- 没有补偿 `outputLatency`，播放头相对声音可能略早（蓝牙耳机更明显）。
- 关闭循环、改循环会让正在响的音重新起音。
- drone 音区固定，旋律在 G2–F#3 附近时会相撞。
- 编辑速度只在新建旋律模式可用；导入的 tempo map 按原样播放。
- drone 独立轨导出未实现。
