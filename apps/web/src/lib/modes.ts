// Mode choices for the pickers: church modes by root, Chinese modes by
// 宫系统 + 主音 + scale type (spec §6.2). Names always come from core.

import {
  CHINESE_DEGREE_LABELS,
  CHINESE_SCALE_TYPES,
  CHINESE_SCALE_TYPE_LABELS,
  CHINESE_TONIC_DEGREES,
  CHURCH_MODES,
  ZHENGYIN,
  chineseScaleId,
  getScale,
  mod,
  modeName,
  pitchClassName,
  type ChineseScaleType,
  type ChineseTonicDegree,
  type ModeRef,
} from '@remode/core';

export const PITCH_CLASSES = Array.from({ length: 12 }, (_, pc) => ({
  pc,
  name: pitchClassName(pc),
}));

export const CHURCH_OPTIONS = CHURCH_MODES.map((m) => ({ id: m.id, label: m.label }));
export const CHINESE_TYPE_OPTIONS = CHINESE_SCALE_TYPES.map((t) => ({
  id: t,
  label: CHINESE_SCALE_TYPE_LABELS[t],
}));
export const CHINESE_DEGREE_OPTIONS = CHINESE_TONIC_DEGREES.map((d) => ({
  id: d,
  label: CHINESE_DEGREE_LABELS[d],
}));

export type ModeSystem = 'church' | 'chinese';

/** A mode as the picker shows it. */
export type PickerValue =
  | { system: 'church'; root: number; scaleId: string }
  | {
      system: 'chinese';
      gong: number;
      degree: ChineseTonicDegree;
      type: ChineseScaleType;
    };

export function toPicker(ref: ModeRef): PickerValue {
  const scale = getScale(ref.scaleId);
  if (!scale.chinese) return { system: 'church', root: mod(ref.root, 12), scaleId: ref.scaleId };
  const { tonicDegree, scaleType } = scale.chinese;
  return {
    system: 'chinese',
    gong: mod(ref.root - ZHENGYIN[tonicDegree], 12),
    degree: tonicDegree,
    type: scaleType,
  };
}

export function fromPicker(v: PickerValue): ModeRef {
  if (v.system === 'church') return { root: v.root, scaleId: v.scaleId };
  return { root: mod(v.gong + ZHENGYIN[v.degree], 12), scaleId: chineseScaleId(v.type, v.degree) };
}

export const refName = (ref: ModeRef): string => modeName(ref.root, ref.scaleId);

export const sameMode = (a: ModeRef | null | undefined, b: ModeRef | null | undefined): boolean =>
  !!a && !!b && mod(a.root, 12) === mod(b.root, 12) && a.scaleId === b.scaleId;
