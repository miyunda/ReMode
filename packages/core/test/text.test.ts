import { describe, expect, it } from 'vitest';
import { decodeMidiText, encodeMidiText, importMidi } from '../src/index.js';
import { fixtureBytes } from './helpers.js';

const asLatin1 = (s: string) => String.fromCharCode(...new TextEncoder().encode(s));

describe('decodeMidiText', () => {
  it('re-decodes UTF-8 bytes', () => {
    expect(decodeMidiText(asLatin1('G 徵 – Flöte'))).toBe('G 徵 – Flöte');
  });
  it('keeps Latin-1 text that is not valid UTF-8', () => {
    expect(decodeMidiText('Flöte')).toBe('Flöte');
    expect(decodeMidiText('Ã')).toBe('Ã'); // truncated sequence
  });
  it('decodes fixture track names', () => {
    const r = importMidi(fixtureBytes('mode-pentatonic-c-gong-zhi.mid'));
    expect(r.ok && r.midi.tracks[0]!.name).toBe('G 徵');
  });
});

describe('encodeMidiText', () => {
  it('matches TextEncoder and round-trips through decodeMidiText', () => {
    for (const s of ['plain', 'G 徵 – Flöte', 'D 徵调式（G 宫系统，五声）', '𝄞 clef']) {
      expect(encodeMidiText(s)).toBe(asLatin1(s));
      expect(decodeMidiText(encodeMidiText(s))).toBe(s);
    }
  });
});
