// Data-driven regression over fixtures/generated/manifest.json.

import { describe, expect, it } from 'vitest';
import {
  analyzeMode,
  importMidi,
  melodyCandidates,
  pitchClassName,
  validateTrack,
  type ParsedMidi,
} from '../src/index.js';
import { fixtureBytes, manifest } from './helpers.js';

const parse = (file: string): ParsedMidi => {
  const r = importMidi(fixtureBytes(file), { sourceFileName: file });
  if (!r.ok) throw new Error(`${file}: ${r.error.code}`);
  return r.midi;
};

describe.each(manifest())('$file', ({ file, expect: exp }) => {
  it('imports as expected', () => {
    const r = importMidi(fixtureBytes(file));
    expect(r.ok).toBe(exp.import.ok);
    if (!r.ok) {
      expect(r.error.code).toBe(exp.import.errorCode);
      return;
    }
    const m = r.midi;
    if (exp.import.format !== undefined) expect(m.format).toBe(exp.import.format);
    if (exp.import.ppq !== undefined) expect(m.metadata.ppq).toBe(exp.import.ppq);
    if (exp.import.melodyTracks !== undefined) {
      expect(melodyCandidates(m)).toHaveLength(exp.import.melodyTracks);
    }
    if (exp.import.percussionTracks !== undefined) {
      expect(m.tracks.filter((t) => t.isPercussion)).toHaveLength(exp.import.percussionTracks);
    }
    if (exp.import.emptyTracks !== undefined) {
      expect(m.tracks.filter((t) => t.noteCount === 0)).toHaveLength(exp.import.emptyTracks);
    }
    for (const w of exp.import.warnings ?? []) {
      expect(m.warnings.map((x) => x.code)).toContain(w);
    }
    if (exp.import.tempoCount !== undefined) {
      expect(m.metadata.tempoMap).toHaveLength(exp.import.tempoCount);
    }
    if (exp.import.timeSignatureCount !== undefined) {
      expect(m.metadata.timeSignatures).toHaveLength(exp.import.timeSignatureCount);
    }
  });

  const v = exp.validation;
  if (v) {
    it('validates as expected', () => {
      const m = parse(file);
      const track = m.tracks.find((t) => t.id === v.trackId);
      expect(track).toBeDefined();
      const report = validateTrack(track!, m.metadata);
      expect(report.ok).toBe(v.ok);
      expect(report.monophonic).toBe(v.monophonic);
      const codes = report.issues.map((x) => x.code);
      for (const c of v.codes) expect(codes).toContain(c);
      if (v.codes.length === 0) expect(report.issues).toEqual([]);
      if (v.repairable !== undefined) {
        expect(report.issues.filter((x) => x.repairable)).toHaveLength(v.repairable);
      }
    });
  }

  const a = exp.analysis;
  if (a) {
    it('analyses as expected', () => {
      const m = parse(file);
      const track = m.tracks.find((t) => t.id === a.trackId)!;
      const analysis = analyzeMode(track.notes, m.metadata);
      const codes = analysis.ambiguities.map((x) => x.code);
      for (const c of a.ambiguities) expect(codes).toContain(c);
      for (const c of a.absent ?? []) expect(codes).not.toContain(c);
      if (a.top) {
        const top = analysis.candidates.filter((c) => c.rank === 1);
        expect(top, JSON.stringify(analysis.candidates.slice(0, 3), null, 1)).toHaveLength(1);
        const best = top[0]!;
        expect(pitchClassName(best.rootPitchClass)).toBe(a.top.root);
        expect(best.scaleId).toBe(a.top.scaleId);
        if (a.top.name) expect(best.name).toBe(a.top.name);
        for (const alias of a.top.aliases ?? []) {
          expect(best.aliases.map((x) => x.scaleId)).toContain(alias);
        }
      }
      if (a.missingDegreesScaleIds) {
        const md = analysis.ambiguities.find((x) => x.code === 'MISSING_DEGREES')!;
        for (const id of a.missingDegreesScaleIds) expect(md.affectedScaleIds).toContain(id);
      }
    });
  }
});
