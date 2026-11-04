import { describe, expect, it } from 'vitest';
import { dronePitches, modeHasFifth } from '../src/audio/drone';
import {
  AUDIO_PREFS_KEY,
  DEFAULT_AUDIO_PREFS,
  parsePrefs,
  readPrefs,
  savePrefs,
} from '../src/audio/prefs';
import { TIMBRES } from '../src/audio/timbres';
import { isTyping, spaceIsTransport } from '../src/lib/keyboard';

describe('drone pitches', () => {
  it('keeps the root in one octave, G2–F#3, for every tonic', () => {
    const roots = Array.from({ length: 12 }, (_, pc) => dronePitches(pc, 'tonic')[0]!);
    expect(Math.min(...roots)).toBe(43);
    expect(Math.max(...roots)).toBe(54);
    roots.forEach((r, pc) => expect(r % 12).toBe(pc));
  });
  it('adds a perfect fifth in 主音 + 五度', () => {
    expect(dronePitches(0, 'tonic-fifth')).toEqual([48, 55]);
    expect(dronePitches(7, 'tonic-fifth')).toEqual([43, 50]);
  });
  it('knows which modes have no perfect fifth', () => {
    expect(modeHasFifth({ root: 0, scaleId: 'dorian' })).toBe(true);
    expect(modeHasFifth({ root: 0, scaleId: 'locrian' })).toBe(false);
  });
});

describe('audio preferences', () => {
  it('defaults: audition on', () => {
    expect(parsePrefs(null)).toEqual(DEFAULT_AUDIO_PREFS);
    expect(DEFAULT_AUDIO_PREFS.audition).toBe(true);
  });
  it('round-trips through localStorage', () => {
    savePrefs({ ...DEFAULT_AUDIO_PREFS, audition: false, timbre: TIMBRES[1]!.id });
    expect(readPrefs()).toMatchObject({ audition: false, timbre: TIMBRES[1]!.id });
    window.localStorage.removeItem(AUDIO_PREFS_KEY);
  });
  it('survives garbage and clamps values', () => {
    expect(parsePrefs('{not json')).toEqual(DEFAULT_AUDIO_PREFS);
    expect(parsePrefs('[1]')).toEqual(DEFAULT_AUDIO_PREFS);
    expect(
      parsePrefs('{"audition":"yes","masterVolume":7,"droneMode":"x","timbre":"nope"}'),
    ).toEqual({ ...DEFAULT_AUDIO_PREFS, masterVolume: 1 });
  });
  it('survives storage that throws', () => {
    const real = Object.getOwnPropertyDescriptor(window, 'localStorage')!;
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      get() {
        throw new Error('denied');
      },
    });
    expect(readPrefs()).toEqual(DEFAULT_AUDIO_PREFS);
    expect(() => savePrefs(DEFAULT_AUDIO_PREFS)).not.toThrow();
    Object.defineProperty(window, 'localStorage', real);
  });
});

describe('who owns Space', () => {
  const el = (html: string) => {
    const box = document.createElement('div');
    box.innerHTML = html;
    document.body.append(box);
    return box.firstElementChild as HTMLElement;
  };
  it('text fields keep their keys', () => {
    for (const html of [
      '<input>',
      '<input type="text">',
      '<textarea></textarea>',
      '<select></select>',
      '<div contenteditable="true"></div>',
    ]) {
      expect(isTyping(el(html))).toBe(true);
      expect(spaceIsTransport(el(html), true)).toBe(false);
    }
  });
  it('a slider, the roll and the page do not', () => {
    expect(isTyping(el('<input type="range">'))).toBe(false);
    expect(spaceIsTransport(el('<input type="range">'), false)).toBe(true);
    expect(spaceIsTransport(el('<div tabindex="0" role="application"></div>'), false)).toBe(true);
    expect(spaceIsTransport(document.body, false)).toBe(true);
  });
  it('a control keeps Space when reached by keyboard, not when clicked', () => {
    for (const html of ['<button></button>', '<input type="checkbox">', '<a href="#x"></a>']) {
      expect(spaceIsTransport(el(html), false)).toBe(false);
      expect(spaceIsTransport(el(html), true)).toBe(true);
    }
  });
});
