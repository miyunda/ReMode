import { describe, expect, it } from 'vitest';
import { decodeMidiText, importMidi } from '../src/index.js';
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
