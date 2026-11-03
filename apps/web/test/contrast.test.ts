// WCAG AA for the colour tokens in src/styles.css, in both themes.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const css = readFileSync(join(import.meta.dirname, '../src/styles.css'), 'utf8');

function block(selector: string): Record<string, string> {
  const at = css.indexOf(selector);
  if (at < 0) throw new Error(`no ${selector}`);
  const body = css.slice(css.indexOf('{', at) + 1, css.indexOf('}', at));
  return Object.fromEntries(
    [...body.matchAll(/--rp-([\w-]+):\s*(#[0-9a-f]{6})/gi)].map((m) => [
      m[1]!,
      m[2]!.toLowerCase(),
    ]),
  );
}

const luminance = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const v = parseInt(hex.slice(i, i + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a: string, b: string) => {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p) as [number, number];
  return (x + 0.05) / (y + 0.05);
};

const light = block(':root {');
const dark = block(":root[data-theme='dark']");
const darkAuto = block(":root:not([data-theme='light'])");

const TEXT_ON = ['base', 'surface', 'overlay'];
const TEXT = ['text', 'muted-text', 'accent-text', 'danger-text', 'warn-text'];

describe('theme tokens', () => {
  it('the prefers-color-scheme dark block matches the manual dark block', () => {
    expect(darkAuto).toEqual(dark);
    expect(Object.keys(dark).sort()).toEqual(Object.keys(light).sort());
  });

  for (const [name, t] of [
    ['Rosé Pine Dawn', light],
    ['Rosé Pine', dark],
  ] as const) {
    it(`${name}: text tokens reach 4.5:1 on every surface`, () => {
      for (const fg of TEXT)
        for (const bg of TEXT_ON)
          expect(contrast(t[fg]!, t[bg]!), `${fg} on ${bg}`).toBeGreaterThanOrEqual(4.5);
    });
    it(`${name}: button text and focus ring`, () => {
      expect(contrast(t['on-accent']!, t['accent-fill']!)).toBeGreaterThanOrEqual(4.5);
      for (const bg of TEXT_ON) expect(contrast(t.focus!, t[bg]!)).toBeGreaterThanOrEqual(3);
    });
  }
});
