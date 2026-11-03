import { useId, useRef, useState, type DragEvent } from 'react';
import { WEB_LIMITS, formatBytes } from '../lib/limits';
import {
  ACCEPT,
  loadFile,
  loadJianpuText,
  type LoadFailure,
  type LoadResult,
} from '../lib/loadInput';
import { useDispatch, useProject } from '../state/ProjectContext';
import { Issue } from './ui';

/** Uses only 1 2 3 5 6, so the analysis reports MISSING_DEGREES (spec §6.5). */
export const JIANPU_EXAMPLE = `// 示例：只用 1 2 3 5 6（C D E G A）
1=C 4/4 ♩=96
| 1 3 5 6 | 5 3 2 1 | 2 3 5 6 |
| 1' 6 5 3 | 2 3 2 1 | 1 - - - |`;

const STAGE: Record<LoadFailure['stage'], string> = {
  file: '读取文件',
  midi: 'MIDI 解析',
  jianpu: '简谱解析',
};

export function LoadFailureView({ failure }: { failure: LoadFailure }) {
  return (
    <div role="alert" className="flex flex-col gap-2" data-testid="load-failure">
      <p className="text-sm font-medium text-danger-text">
        {STAGE[failure.stage]}失败{failure.fileName ? `：${failure.fileName}` : ''}
      </p>
      <ul className="flex flex-col gap-2">
        {failure.errors.map((e, i) => (
          <Issue
            key={i}
            level="error"
            code={e.code}
            text={e.message}
            {...(e.line !== undefined ? { location: `第 ${e.line} 行，第 ${e.column} 列` } : {})}
          />
        ))}
        {failure.warnings.map((w, i) => (
          <Issue
            key={`w${i}`}
            level="warning"
            code={w.code}
            text={w.message}
            {...(w.line !== undefined ? { location: `第 ${w.line} 行，第 ${w.column} 列` } : {})}
          />
        ))}
      </ul>
    </div>
  );
}

export function ImportPanel() {
  const dispatch = useDispatch();
  const { loadFailure } = useProject();
  const [text, setText] = useState('');
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const textId = useId();
  const countId = useId();
  const overLimit = text.length > WEB_LIMITS.maxJianpuChars;
  const limitsId = useId();

  const apply = (r: LoadResult) =>
    dispatch(
      r.ok ? { type: 'LOADED', input: r.input } : { type: 'LOAD_FAILED', failure: r.failure },
    );

  const onFiles = async (files: FileList | null) => {
    const file = files?.[0];
    if (!file) return;
    setBusy(true);
    try {
      apply(await loadFile(file));
    } finally {
      setBusy(false);
      if (fileInput.current) fileInput.current.value = '';
    }
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    void onFiles(e.dataTransfer.files);
  };

  return (
    <div className="flex flex-col gap-3">
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        data-testid="dropzone"
        className={`flex flex-col items-center gap-2 rounded-lg border-2 border-dashed p-4 text-center text-sm ${
          dragging ? 'border-pine bg-hl-low' : 'border-hl-high'
        }`}
      >
        <p>把 MIDI 或简谱文件拖到这里，或</p>
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => fileInput.current?.click()}
          disabled={busy}
          aria-describedby={limitsId}
        >
          选择文件…
        </button>
        <input
          ref={fileInput}
          type="file"
          accept={ACCEPT}
          className="sr-only"
          tabIndex={-1}
          aria-label="选择 MIDI 或简谱文件"
          data-testid="file-input"
          onChange={(e) => void onFiles(e.target.files)}
        />
        <p id={limitsId} className="text-xs text-muted-text">
          .mid / .midi / .jianpu / .txt · 文件 ≤ {formatBytes(WEB_LIMITS.maxFileBytes)} · 文件内音符
          ≤ {WEB_LIMITS.maxNotes.toLocaleString('zh-CN')} · 单条旋律 ≤{' '}
          {WEB_LIMITS.maxMelodyNotes.toLocaleString('zh-CN')} 音 · 简谱 ≤{' '}
          {WEB_LIMITS.maxJianpuChars.toLocaleString('zh-CN')} 字符
        </p>
      </div>

      <form
        className="flex flex-col gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          apply(loadJianpuText(text, null));
        }}
      >
        <label htmlFor={textId} className="text-sm font-medium">
          简谱文本
        </label>
        <textarea
          id={textId}
          className="field min-h-28 font-mono"
          value={text}
          spellCheck={false}
          placeholder="1=C 4/4 | 5 3 2 1 | 6. 5_ 3 - |"
          aria-describedby={countId}
          onChange={(e) => setText(e.target.value)}
        />
        {/* No maxLength: a long paste is never truncated silently; the parser reports TEXT_TOO_LONG. */}
        <p
          id={countId}
          data-testid="jianpu-count"
          className={`text-xs ${overLimit ? 'font-medium text-danger-text' : 'text-muted-text'}`}
          {...(overLimit ? { role: 'alert' } : {})}
        >
          {text.length.toLocaleString('zh-CN')} /{' '}
          {WEB_LIMITS.maxJianpuChars.toLocaleString('zh-CN')} 字符
          {overLimit && '：超过上限，分析时会报 TEXT_TOO_LONG，文本不会被截断。'}
        </p>
        <p className="text-xs text-muted-text">
          语法：<code>1=调</code>、拍号、<code>♩=速度</code>，<code>'</code>/<code>,</code>{' '}
          高/低八度，
          <code>#</code>/<code>b</code> 升降，<code>_</code> 八分、<code>__</code> 十六分，
          <code>.</code> 附点，<code>-</code> 延长一拍，<code>0</code> 休止，<code>|</code> 小节线。
        </p>
        <div className="flex flex-wrap gap-2">
          <button type="submit" className="btn btn-primary" disabled={!text.trim()}>
            分析简谱
          </button>
          <button type="button" className="btn" onClick={() => setText(JIANPU_EXAMPLE)}>
            填入示例
          </button>
        </div>
      </form>

      {loadFailure && <LoadFailureView failure={loadFailure} />}
    </div>
  );
}
