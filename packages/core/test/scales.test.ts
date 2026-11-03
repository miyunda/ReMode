import { describe, expect, it } from 'vitest';
import {
  CHINESE_TONIC_DEGREES,
  PIANYIN_ROLES,
  SCALES,
  getScale,
  mod,
  modeName,
  scalePitchClasses,
} from '../src/index.js';

const identity = (id: string) =>
  getScale(id).degreeIdentity.map(
    ({ degree, alter }) => `${alter === -1 ? 'b' : alter === 1 ? '#' : ''}${degree}`,
  );

describe('mod', () => {
  it('is a mathematical modulo for negative numbers', () => {
    expect(mod(-1, 12)).toBe(11);
    expect(mod(-12, 12)).toBe(0);
    expect(mod(-13, 12)).toBe(11);
    expect(mod(25, 12)).toBe(1);
  });
});

describe('church modes (spec §6.2)', () => {
  it.each([
    ['ionian', [0, 2, 4, 5, 7, 9, 11]],
    ['dorian', [0, 2, 3, 5, 7, 9, 10]],
    ['phrygian', [0, 1, 3, 5, 7, 8, 10]],
    ['lydian', [0, 2, 4, 6, 7, 9, 11]],
    ['mixolydian', [0, 2, 4, 5, 7, 9, 10]],
    ['aeolian', [0, 2, 3, 5, 7, 8, 10]],
    ['locrian', [0, 1, 3, 5, 6, 8, 10]],
  ])('%s intervals', (id, intervals) => {
    expect(getScale(id).intervals).toEqual(intervals);
  });

  it('degree identities', () => {
    expect(identity('dorian')).toEqual(['1', '2', 'b3', '4', '5', '6', 'b7']);
    expect(identity('lydian')).toEqual(['1', '2', '3', '#4', '5', '6', '7']);
    expect(identity('locrian')).toEqual(['1', 'b2', 'b3', '4', 'b5', 'b6', 'b7']);
  });
});

describe('Chinese scales (spec §6.2)', () => {
  it.each([
    ['pentatonic-gong', [0, 2, 4, 7, 9]],
    ['pentatonic-shang', [0, 2, 5, 7, 10]],
    ['pentatonic-jue', [0, 3, 5, 8, 10]],
    ['pentatonic-zhi', [0, 2, 5, 7, 9]],
    ['pentatonic-yu', [0, 3, 5, 7, 10]],
    ['hexa-qingjiao-gong', [0, 2, 4, 5, 7, 9]],
    ['hexa-biangong-gong', [0, 2, 4, 7, 9, 11]],
    ['qingyue-gong', [0, 2, 4, 5, 7, 9, 11]],
    ['yayue-gong', [0, 2, 4, 6, 7, 9, 11]],
    ['yanyue-gong', [0, 2, 4, 5, 7, 9, 10]],
  ])('%s intervals', (id, intervals) => {
    expect(getScale(id).intervals).toEqual(intervals);
  });

  it('pentatonic degree identities follow spec §7.3', () => {
    expect(identity('pentatonic-gong')).toEqual(['1', '2', '3', '5', '6']);
    expect(identity('pentatonic-zhi')).toEqual(['1', '2', '4', '5', '6']);
    expect(identity('pentatonic-shang')).toEqual(['1', '2', '4', '5', 'b7']);
    expect(identity('pentatonic-jue')).toEqual(['1', 'b3', '4', 'b6', 'b7']);
    expect(identity('pentatonic-yu')).toEqual(['1', 'b3', '4', '5', 'b7']);
    expect(identity('hexa-biangong-gong')).toEqual(['1', '2', '3', '5', '6', '7']);
    expect(identity('yayue-gong')).toEqual(['1', '2', '3', '#4', '5', '6', '7']);
  });

  it('has every scale type on all five 正音 and nothing else', () => {
    const chinese = SCALES.filter((s) => s.chinese);
    expect(chinese).toHaveLength(6 * 5);
    expect(SCALES).toHaveLength(7 + 30);
    for (const s of chinese) {
      expect(CHINESE_TONIC_DEGREES).toContain(s.chinese!.tonicDegree);
      // The tonic (interval 0) is never a 偏音.
      expect(PIANYIN_ROLES as readonly string[]).not.toContain(s.degreeRoles[0]);
      expect(s.degreeRoles[0]).toBe(s.chinese!.tonicDegree);
    }
  });

  it('marks 偏音 as characteristic degrees', () => {
    expect(getScale('qingyue-gong').characteristicDegrees).toEqual([4, 7]);
    expect(getScale('yayue-gong').characteristicDegrees).toEqual([4, 7]);
    expect(getScale('yanyue-gong').characteristicDegrees).toEqual([4, 7]);
    expect(getScale('pentatonic-gong').characteristicDegrees).toEqual([]);
  });
});

describe('dual-coordinate naming', () => {
  it('names Chinese modes as 主音 + 调式（宫系统，音阶）', () => {
    expect(modeName(2, 'pentatonic-zhi')).toBe('D 徵调式（G 宫系统，五声）');
    expect(modeName(9, 'qingyue-yu')).toBe('A 羽调式（C 宫系统，七声清乐）');
    expect(modeName(2, 'hexa-qingjiao-shang')).toBe('D 商调式（C 宫系统，六声加清角）');
  });

  it('names church modes plainly', () => {
    expect(modeName(2, 'dorian')).toBe('D Dorian');
  });

  it('places a mode on its root', () => {
    expect(scalePitchClasses(getScale('pentatonic-zhi'), 2)).toEqual([2, 4, 7, 9, 11]);
  });
});
