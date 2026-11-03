// MIDI text meta events carry bytes with no declared encoding. midi-file hands
// them over as one char per byte (Latin-1). Most current DAWs write UTF-8, so
// re-decode when the bytes are valid UTF-8 and keep Latin-1 otherwise.

/** Strict UTF-8 decode of a byte-per-char string; null if not valid UTF-8. */
function strictUtf8(latin1: string): string | null {
  let out = '';
  for (let i = 0; i < latin1.length;) {
    const b0 = latin1.charCodeAt(i);
    if (b0 > 0xff) return null;
    let len: number;
    let cp: number;
    if (b0 < 0x80) [len, cp] = [1, b0];
    else if (b0 >= 0xc2 && b0 <= 0xdf) [len, cp] = [2, b0 & 0x1f];
    else if (b0 >= 0xe0 && b0 <= 0xef) [len, cp] = [3, b0 & 0x0f];
    else if (b0 >= 0xf0 && b0 <= 0xf4) [len, cp] = [4, b0 & 0x07];
    else return null;
    if (i + len > latin1.length) return null;
    for (let k = 1; k < len; k++) {
      const b = latin1.charCodeAt(i + k);
      if ((b & 0xc0) !== 0x80) return null;
      cp = (cp << 6) | (b & 0x3f);
    }
    const min = [0, 0, 0x80, 0x800, 0x10000][len] as number;
    if (cp < min || cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff)) return null;
    out += String.fromCodePoint(cp);
    i += len;
  }
  return out;
}

export function decodeMidiText(raw: string): string {
  return strictUtf8(raw) ?? raw;
}

/**
 * UTF-8 bytes as a byte-per-char string, the form midi-file writes verbatim.
 * Hand-rolled because core's lib target (ES2023, no DOM) has no TextEncoder.
 */
export function encodeMidiText(text: string): string {
  let out = '';
  for (const ch of text) {
    const cp = ch.codePointAt(0) as number;
    if (cp < 0x80) out += ch;
    else if (cp < 0x800) out += String.fromCharCode(0xc0 | (cp >> 6), 0x80 | (cp & 0x3f));
    else if (cp < 0x10000) {
      out += String.fromCharCode(0xe0 | (cp >> 12), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f));
    } else {
      out += String.fromCharCode(
        0xf0 | (cp >> 18),
        0x80 | ((cp >> 12) & 0x3f),
        0x80 | ((cp >> 6) & 0x3f),
        0x80 | (cp & 0x3f),
      );
    }
  }
  return out;
}
