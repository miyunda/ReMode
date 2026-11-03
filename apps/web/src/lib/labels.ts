// Chinese UI text for core's structured codes. The code itself is always shown
// next to the text; core's own (English) message stays available as detail.

import {
  CHINESE_DEGREE_LABELS,
  CHINESE_SCALE_TYPE_LABELS,
  pitchName,
  type TonicEvidenceKind,
  type ValidationIssue,
} from '@remode/core';

const LABELS: Readonly<Record<string, string>> = {
  // File / reading
  FILE_TOO_LARGE: '文件过大',
  UNSUPPORTED_FILE_TYPE: '不支持的文件类型',
  NOT_UTF8: '文本编码无效',
  READ_FAILED: '读取失败',
  MELODY_TOO_LONG: '旋律过长',
  // MIDI import errors
  EMPTY_FILE: '文件为空',
  NOT_MIDI: '不是标准 MIDI 文件',
  INVALID_HEADER: 'MIDI 文件头无效',
  TRUNCATED: '文件被截断',
  NO_TRACKS: '没有轨道',
  UNSUPPORTED_FORMAT: '不支持的 MIDI 格式',
  SMPTE_TIMING: '不支持 SMPTE 时间分辨率',
  TOO_MANY_NOTES: '音符过多',
  PARSE_FAILED: 'MIDI 解析失败',
  // MIDI import warnings
  DEFAULT_TEMPO: '缺少速度，按 120 BPM',
  DEFAULT_TIME_SIGNATURE: '缺少拍号，按 4/4',
  INVALID_TIME_SIGNATURE: '拍号无效',
  TRACK_COUNT_MISMATCH: '轨道数与文件头不符',
  TRAILING_BYTES: '文件尾部有多余字节',
  TYPE0_SPLIT_BY_CHANNEL: 'Type 0 文件按通道拆分为多条轨',
  // Validation
  EMPTY_TRACK: '空轨',
  PERCUSSION_TRACK: '打击乐轨',
  INVALID_PITCH: '音高无效',
  INVALID_START: '起始位置无效',
  INVALID_DURATION: '时值无效',
  INVALID_VELOCITY: '力度无效',
  SAME_TICK_CHORD: '同时起音（和弦）',
  DUPLICATE_NOTE: '重复音符',
  OVERLAP: '音符重叠',
  PITCH_BEND_PRESENT: '含弯音',
  SUSTAIN_PEDAL_PRESENT: '含延音踏板（CC64）',
  // Jianpu
  TEXT_TOO_LONG: '文本过长',
  INVALID_KEY: '调号无效',
  INVALID_TEMPO: '速度无效',
  DUPLICATE_HEADER: '重复的头部',
  HEADER_AFTER_NOTES: '头部出现在音符之后',
  INVALID_DEGREE: '无效的音级',
  INVALID_REST_MODIFIER: '休止符不能带此记号',
  MIXED_OCTAVE_MARKS: '高低八度点混用',
  UNSUPPORTED_DURATION: '不支持的时值记号',
  UNSUPPORTED_ACCIDENTAL: '不支持的升降号',
  DANGLING_ACCIDENTAL: '升降号后没有音符',
  DANGLING_EXTENDER: '增时线前没有音符',
  PITCH_OUT_OF_RANGE: '音高超出范围',
  UNSUPPORTED_TUPLET: '不支持连音/连线',
  UNSUPPORTED_ORNAMENT: '不支持装饰音',
  UNSUPPORTED_REPEAT: '不支持反复记号',
  UNEXPECTED_CHARACTER: '无法识别的字符',
  NO_NOTES: '没有音符',
  DEFAULT_KEY: '缺少调号，按 1=C',
  BAR_DURATION_MISMATCH: '小节时值与拍号不符',
  KEY_SIGNATURE_RESPELLED: '调号按等音改写',
  // Analysis: candidate warnings
  BELOW_COVERAGE_THRESHOLD: '音集覆盖未达阈值',
  OUT_OF_SET_NOTES: '含音集外的音',
  NOT_FINAL_NOTE: '尾音不是此主音',
  // Analysis: ambiguities
  MISSING_DEGREES: '缺少音级',
  MULTIPLE_COLLECTIONS: '多个音集同样兼容',
  TONIC_UNCLEAR: '主音不明确',
  CHROMATIC_HEAVY: '调外音过多',
  TOO_SHORT: '旋律过短',
  // Transform
  INVALID_NOTE: '音符无效',
  INVALID_SEMITONES: '半音数无效',
  INVALID_ROOT: '主音无效',
  INVALID_RANGE: '音域设置无效',
  UNKNOWN_SCALE: '未知调式',
  ACCIDENTAL_REJECTED: '含调外音，已按策略拒绝',
  PRESERVE_REQUIRES_LOOSE_TARGET: '保留调外音需要非严格目标',
  SOURCE_MODE_AMBIGUOUS: '来源调式未确定',
  RANGE_SHIFTED: '整体移动了八度以适应音域',
  RANGE_NO_FIT: '无法放入软音域',
  ACCIDENTALS_MAPPED: '调外音已就近映射',
  ACCIDENTALS_PRESERVED: '调外音保持原样',
  NO_CHARACTERISTIC_DEGREE: '旋律未用到特征音',
  CONTOUR_REVERSED: '旋律方向反转',
  REPETITION_INTRODUCED: '产生了同音重复',
  // Export
  INVALID_PPQ: 'PPQ 无效',
  INVALID_KEY_SIGNATURE: '调号无效',
  INVALID_CHANNEL: '通道无效',
  INVALID_PROGRAM: '音色号无效',
  VELOCITY_QUANTIZED: '力度量化为 7 位',
  VELOCITY_ZERO_RAISED: '0 力度提升为 1',
  TEMPO_ROUNDED: '速度按整数微秒写入',
  KEY_SIGNATURE_DROPPED: '调号无法写入',
  SOURCE_KEY_SIGNATURES_REPLACED: '来源调号已替换为目标调号',
  PITCH_BEND_DROPPED: '弯音未导出',
  SUSTAIN_PEDAL_DROPPED: '延音踏板未导出',
  TRACKS_DROPPED: '其他轨未导出',
  // Change reasons
  DEGREE_MAPPED: '按音级身份映射',
  SCALE_POSITION_MAPPED: '按音位映射',
  SCALE_CONSTRAINT: '目标缺此音级，取相邻音',
  ACCIDENTAL_NEAREST: '调外音就近处理',
  TRANSPOSE: '移调',
  RANGE_ADJUSTMENT: '音域调整',
};

export const codeLabel = (code: string): string => LABELS[code] ?? code;

export const EVIDENCE_LABELS: Readonly<Record<TonicEvidenceKind, string>> = {
  FINAL_NOTE: '尾音',
  PHRASE_END: '句末音',
  LONG_NOTE: '长音',
  STRONG_BEAT: '强拍',
  AMBITUS: '音域',
  FIRST_NOTE: '首音',
};

export const chineseTypeLabel = (t: keyof typeof CHINESE_SCALE_TYPE_LABELS) =>
  CHINESE_SCALE_TYPE_LABELS[t];
export const chineseDegreeLabel = (d: keyof typeof CHINESE_DEGREE_LABELS) =>
  CHINESE_DEGREE_LABELS[d];

const ids = (x: string[]) => x.join('、');

/** One-sentence Chinese explanation of a validation issue from its structured fields. */
export function validationText(issue: ValidationIssue): string {
  const p = (issue.pitches ?? []).map(pitchName);
  const at = issue.tick !== undefined ? `tick ${issue.tick}：` : '';
  switch (issue.code) {
    case 'EMPTY_TRACK':
      return '该轨没有音符。';
    case 'PERCUSSION_TRACK':
      return '该轨在 MIDI 第 10 通道（打击乐），音符号代表鼓件而非音高，不参与旋律分析。';
    case 'INVALID_PITCH':
      return `音符 ${ids(issue.noteIds)} 的音高不在 0–127 的整数范围内。`;
    case 'INVALID_START':
      return `音符 ${ids(issue.noteIds)} 的起始 tick 无效。`;
    case 'INVALID_DURATION':
      return `${at}音符 ${ids(issue.noteIds)} 时值为 0 或负数；请在源文件中删除后重新导入。`;
    case 'INVALID_VELOCITY':
      return `音符 ${ids(issue.noteIds)} 的力度不在 0..1。`;
    case 'SAME_TICK_CHORD':
      return `${at}${p.join('、')} 同时起音（和弦）。裁剪无法把和弦变成单声部，请在源文件中保留每个起音一个音。`;
    case 'DUPLICATE_NOTE':
      return `${at}${issue.noteIds.length} 个相同的 ${p[0] ?? ''} 同时起音。`;
    case 'OVERLAP': {
      const [a, b] = p;
      const ms = issue.overlapMs !== undefined ? `（约 ${issue.overlapMs} ms）` : '';
      return issue.repairable
        ? `${at}${a} 在 ${b} 起音时仍在发声 ${issue.overlapTicks} tick${ms}，属于容差内的连奏尾音，可安全修复。`
        : `${at}${a} 在 ${b} 起音时仍在发声 ${issue.overlapTicks} tick${ms}，超出连奏容差或为嵌套重叠，需要在源文件中处理。`;
    }
    case 'PITCH_BEND_PRESENT':
      return '该轨含弯音；分析只使用离散音符号，忽略弯音后的连续音高，导出时也不保留。';
    case 'SUSTAIN_PEDAL_PRESENT':
      return '该轨使用了延音踏板（CC64）；即使音符不重叠，听起来也可能是多声部。导出时不保留。';
  }
}

export const ambiguityReasonText = (reason: string): string =>
  reason === 'SEVERAL_RANK1'
    ? '多个调式并列第 1'
    : reason === 'NO_CANDIDATE'
      ? '没有候选'
      : reason === 'NO_ANALYSIS'
        ? '尚未分析'
        : `${codeLabel(reason)}（${reason}）`;
