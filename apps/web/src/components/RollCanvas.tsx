// Canvas piano roll (spec §10.3). A scrollable box holds a spacer the size of
// the whole roll; a sticky canvas the size of the box redraws the visible
// window on every scroll, zoom or data change. Canvas rather than SVG: at the
// 5 000-note limit an SVG roll needs 10 000+ DOM nodes (ghost + filled +
// markers) that React re-reconciles on every drag step and selection change,
// while a canvas redraw of the visible window stays well under a frame. The
// screen-reader alternative is the synchronized note table (NoteTable).

import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
} from 'react';
import {
  inMode,
  pitchClass,
  pitchName,
  type MelodyNote,
  type MidiMetadata,
  type ModeRef,
  type PitchChange,
} from '@remode/core';
import {
  GUTTER,
  RULER,
  contentSize,
  fitView,
  gridLines,
  hitNote,
  nearestTick,
  pitchRange,
  pitchToY,
  snapTick,
  tickToX,
  timeOrderOf,
  xToTick,
  yToPitch,
  type View,
} from '../lib/rollGeometry';

export interface RollScales {
  source: ModeRef | null;
  target: ModeRef | null;
  showSource: boolean;
  showTarget: boolean;
}

type NotePatch = Partial<Pick<MelodyNote, 'pitch' | 'startTick' | 'durationTick'>>;

/** What the roll shows of the transport. */
export interface RollPlayback {
  /** Live position; read in animation frames. */
  tick: () => number;
  playing: boolean;
  /** The position at the last discrete change (a seek, a stop). */
  atTick: number;
  loop: { startTick: number; endTick: number } | null;
  loopOn: boolean;
}

export interface RollCanvasProps {
  label: string;
  mode: 'edit' | 'compose';
  /** Drawn filled: the active variant (or the draft). */
  notes: readonly MelodyNote[];
  /** Original pitches drawn as dashed outlines; null when the original itself is active. */
  ghosts: readonly MelodyNote[] | null;
  changes: ReadonlyMap<string, PitchChange>;
  meta: Pick<MidiMetadata, 'ppq' | 'timeSignatures'>;
  scales: RollScales;
  /** Start ticks of phrases 2..n (spec §10.3 phrase markers). */
  phraseTicks: readonly number[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  /** Edit mode: pitch for a keyboard step (±1 step, or an octave). */
  stepPitch?: (note: MelodyNote, dir: 1 | -1, octave: boolean) => number;
  /** Edit mode: the pitch a drag lands on (snapping). */
  dragPitch?: (raw: number) => number;
  onPitch?: (id: string, pitch: number) => void;
  /** Notes outside the target scale get a "!" badge. */
  outOfTarget?: (pitch: number) => boolean;
  /** Compose mode. */
  quantum?: number;
  minTicks?: number;
  /** Returns false when the edit is refused (overlap, limits), so no sound follows it. */
  onAdd?: (pitch: number, startTick: number) => boolean;
  onUpdate?: (id: string, patch: NotePatch) => boolean;
  onDelete?: (id: string) => void;
  playback?: RollPlayback;
  /** A click on the ruler. */
  onSeek?: (tick: number) => void;
  /** A drag along the ruler. */
  onLoopRange?: (fromTick: number, toTick: number) => void;
  /** A short note: selection, an added note, a pitch change, the keyboard gutter. */
  onAudition?: (pitch: number) => void;
  /** The view refits when this changes (a new melody, a new draft). */
  fitKey: unknown;
}

interface Palette {
  base: string;
  surface: string;
  overlay: string;
  text: string;
  muted: string;
  hlLow: string;
  hlMed: string;
  hlHigh: string;
  accent: string;
  onAccent: string;
  changed: string;
  connector: string;
  source: string;
  target: string;
  phrase: string;
  focus: string;
  warn: string;
}

function readPalette(): Palette {
  const css = getComputedStyle(document.documentElement);
  const v = (name: string) => css.getPropertyValue(name).trim() || '#888';
  return {
    base: v('--rp-base'),
    surface: v('--rp-surface'),
    overlay: v('--rp-overlay'),
    text: v('--rp-text'),
    muted: v('--rp-muted-text'),
    hlLow: v('--rp-hl-low'),
    hlMed: v('--rp-hl-med'),
    hlHigh: v('--rp-hl-high'),
    accent: v('--rp-accent-fill'),
    onAccent: v('--rp-on-accent'),
    changed: v('--rp-gold'),
    connector: v('--rp-love'),
    source: v('--rp-pine'),
    target: v('--rp-iris'),
    phrase: v('--rp-iris'),
    focus: v('--rp-focus'),
    warn: v('--rp-danger-text'),
  };
}

/** Re-read the palette when the theme changes (data-theme or the system scheme). */
function usePalette(): Palette | null {
  const [palette, setPalette] = useState<Palette | null>(null);
  useEffect(() => {
    const update = () => setPalette(readPalette());
    update();
    const mo = new MutationObserver(update);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    const mq = window.matchMedia?.('(prefers-color-scheme: dark)');
    mq?.addEventListener?.('change', update);
    return () => {
      mo.disconnect();
      mq?.removeEventListener?.('change', update);
    };
  }, []);
  return palette;
}

const hatch = (
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  cross: boolean,
) => {
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  ctx.beginPath();
  for (let d = -h; d < w; d += 5) {
    ctx.moveTo(x + d, y + h);
    ctx.lineTo(x + d + h, y);
    if (cross) {
      ctx.moveTo(x + d, y);
      ctx.lineTo(x + d + h, y + h);
    }
  }
  ctx.stroke();
  ctx.restore();
};

type Drag =
  | { kind: 'pitch'; id: string; pitch: number; moved: boolean }
  | {
      kind: 'move' | 'resize';
      id: string;
      x0: number;
      startTick: number;
      durationTick: number;
      pitch: number;
      patch: NotePatch;
      moved: boolean;
    }
  | { kind: 'ruler'; x0: number; tick: number; to: number; moved: boolean };

const MIN_TICKS_PAD = 1;
/** Pixels of pointer travel that turn a ruler click into a loop drag. */
const RULER_DRAG_PX = 6;
/** The playhead turns the page this far from the right edge. */
const FOLLOW_MARGIN = 40;

export function RollCanvas(props: RollCanvasProps) {
  const {
    notes,
    ghosts,
    changes,
    meta,
    scales,
    phraseTicks,
    selectedId,
    mode,
    onSelect,
    fitKey,
    quantum = meta.ppq / 2,
  } = props;
  const boxRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const playheadRef = useRef<HTMLDivElement>(null);
  // The last pitch sounded during a drag: pointer moves can arrive between renders.
  const dragSounded = useRef<number | null>(null);
  const palette = usePalette();
  const helpId = useId();
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [zoom, setZoom] = useState({ pxPerTick: 40 / meta.ppq, rowH: 14 });
  const [scroll, setScroll] = useState({ x: 0, y: 0 });
  const [drag, setDrag] = useState<Drag | null>(null);
  const [announce, setAnnounce] = useState('');

  // Displayed notes: the drag preview replaces its note.
  const shown = useMemo(() => {
    if (!drag?.moved || drag.kind === 'ruler') return notes;
    return notes.map((n) =>
      n.id !== drag.id
        ? n
        : drag.kind === 'pitch'
          ? { ...n, pitch: drag.pitch }
          : { ...n, ...drag.patch },
    );
  }, [notes, drag]);

  const range = useMemo(
    () =>
      pitchRange(
        [...notes.map((n) => n.pitch), ...(ghosts ?? []).map((n) => n.pitch)],
        mode === 'compose' ? 18 : 12,
      ),
    [notes, ghosts, mode],
  );
  const totalTicks = useMemo(() => {
    const last = Math.max(0, ...shown.map((n) => n.startTick + n.durationTick));
    const bar =
      (meta.ppq * 4 * (meta.timeSignatures[0]?.numerator ?? 4)) /
      (meta.timeSignatures[0]?.denominator ?? 4);
    return Math.max(props.minTicks ?? 0, Math.ceil(last / bar + MIN_TICKS_PAD) * bar);
  }, [shown, meta, props.minTicks]);
  const order = useMemo(() => timeOrderOf(notes), [notes]);
  const content = contentSize({ ...zoom, range }, totalTicks);
  const view: View = { ...zoom, range, scrollX: scroll.x, scrollY: scroll.y };

  // Box size.
  useLayoutEffect(() => {
    const box = boxRef.current;
    if (!box) return;
    const measure = () => setSize({ width: box.clientWidth, height: box.clientHeight });
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    ro.observe(box);
    return () => ro.disconnect();
  }, []);

  // Auto-fit on a new melody / draft once the box has a size.
  const fitted = useRef<unknown>(Symbol('unfitted'));
  const fit = useCallback(() => {
    const box = boxRef.current;
    if (!box || size.width === 0) return;
    const f = fitView(notes, range, totalTicks, meta.ppq, size);
    setZoom({ pxPerTick: f.pxPerTick, rowH: f.rowH });
    box.scrollLeft = f.scrollX;
    box.scrollTop = f.scrollY;
    setScroll({ x: f.scrollX, y: f.scrollY });
  }, [notes, range, totalTicks, meta.ppq, size]);
  useLayoutEffect(() => {
    if (size.width === 0 || fitted.current === fitKey) return;
    fitted.current = fitKey;
    fit();
  }, [fitKey, size.width, fit]);

  // Draw.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !palette || size.width === 0) return;
    const ctx = canvas.getContext?.('2d');
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    const { width: W, height: H } = size;
    if (canvas.width !== Math.round(W * dpr) || canvas.height !== Math.round(H * dpr)) {
      canvas.width = Math.round(W * dpr);
      canvas.height = Math.round(H * dpr);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const p = palette;
    const { rowH } = view;
    ctx.fillStyle = p.base;
    ctx.fillRect(0, 0, W, H);

    // Rows: black keys, then source / target scale shading.
    const firstPitch = Math.min(range.hi, yToPitch(view, RULER));
    const lastPitch = Math.max(range.lo, yToPitch(view, H));
    for (let pitch = firstPitch; pitch >= lastPitch; pitch--) {
      const y = pitchToY(view, pitch);
      const pc = pitchClass(pitch);
      if ([1, 3, 6, 8, 10].includes(pc)) {
        ctx.fillStyle = p.hlLow;
        ctx.fillRect(GUTTER, y, W, rowH);
      }
      ctx.globalAlpha = 0.14;
      if (scales.showSource && scales.source && inMode(pitch, scales.source)) {
        ctx.fillStyle = p.source;
        ctx.fillRect(GUTTER, y, W, rowH);
      }
      if (scales.showTarget && scales.target && inMode(pitch, scales.target)) {
        ctx.fillStyle = p.target;
        ctx.fillRect(GUTTER, y, W, rowH);
      }
      ctx.globalAlpha = 1;
      // Tonic rows: a solid rule above the row (source) / dashed (target).
      for (const [m, show, dash] of [
        [scales.source, scales.showSource, []],
        [scales.target, scales.showTarget, [4, 3]],
      ] as const) {
        if (!show || !m || pitchClass(pitch - m.root) !== 0) continue;
        ctx.strokeStyle = m === scales.source ? p.source : p.target;
        ctx.lineWidth = 1.5;
        ctx.setLineDash([...dash]);
        ctx.beginPath();
        ctx.moveTo(GUTTER, y + rowH - 0.5);
        ctx.lineTo(W, y + rowH - 0.5);
        ctx.stroke();
        ctx.setLineDash([]);
      }
      ctx.strokeStyle = p.hlLow;
      ctx.lineWidth = 1;
      if (pc === 0) {
        ctx.strokeStyle = p.hlMed;
        ctx.beginPath();
        ctx.moveTo(GUTTER, y + rowH - 0.5);
        ctx.lineTo(W, y + rowH - 0.5);
        ctx.stroke();
      }
    }

    // Bar / beat grid.
    const t0 = Math.max(0, xToTick(view, GUTTER));
    const t1 = xToTick(view, W);
    const lines = gridLines(meta, t0, t1 + 1);
    for (const l of lines) {
      const x = Math.round(tickToX(view, l.tick)) + 0.5;
      ctx.strokeStyle = l.kind === 'bar' ? p.hlHigh : p.hlMed;
      ctx.lineWidth = l.kind === 'bar' ? 1.5 : 1;
      ctx.globalAlpha = l.kind === 'bar' ? 1 : 0.6;
      ctx.beginPath();
      ctx.moveTo(x, RULER);
      ctx.lineTo(x, H);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
    // Compose grid: quantum lines when there is room.
    if (mode === 'compose' && quantum * view.pxPerTick >= 8) {
      ctx.strokeStyle = p.hlLow;
      ctx.lineWidth = 1;
      for (let t = Math.ceil(t0 / quantum) * quantum; t < t1; t += quantum) {
        const x = Math.round(tickToX(view, t)) + 0.5;
        ctx.beginPath();
        ctx.moveTo(x, RULER);
        ctx.lineTo(x, H);
        ctx.stroke();
      }
    }

    // Phrase markers.
    ctx.strokeStyle = p.phrase;
    ctx.setLineDash([6, 4]);
    ctx.lineWidth = 1.5;
    for (const t of phraseTicks) {
      if (t < t0 - 1 || t > t1) continue;
      const x = Math.round(tickToX(view, t)) + 0.5;
      ctx.beginPath();
      ctx.moveTo(x, RULER);
      ctx.lineTo(x, H);
      ctx.stroke();
    }
    ctx.setLineDash([]);

    // Loop range: shaded while on; both edges are solid lines (with [ ] in the ruler).
    const loopRange =
      drag?.kind === 'ruler' && drag.moved
        ? {
            startTick: Math.min(drag.tick, drag.to),
            endTick: Math.max(drag.tick, drag.to),
            on: true,
          }
        : props.playback?.loop
          ? { ...props.playback.loop, on: props.playback.loopOn }
          : null;
    if (loopRange?.on) {
      const x0 = Math.max(GUTTER, tickToX(view, loopRange.startTick));
      const x1 = Math.min(W, tickToX(view, loopRange.endTick));
      if (x1 > x0) {
        ctx.globalAlpha = 0.12;
        ctx.fillStyle = p.connector;
        ctx.fillRect(x0, RULER, x1 - x0, H - RULER);
        ctx.globalAlpha = 1;
      }
      ctx.strokeStyle = p.connector;
      ctx.lineWidth = 1.5;
      for (const t of [loopRange.startTick, loopRange.endTick]) {
        const x = Math.round(tickToX(view, t)) + 0.5;
        if (x < GUTTER || x > W) continue;
        ctx.beginPath();
        ctx.moveTo(x, RULER);
        ctx.lineTo(x, H);
        ctx.stroke();
      }
    }

    const visible = (n: MelodyNote) =>
      n.startTick + n.durationTick >= t0 &&
      n.startTick <= t1 &&
      n.pitch <= firstPitch + 1 &&
      n.pitch >= lastPitch - 1;
    const rect = (n: MelodyNote) => {
      const x = tickToX(view, n.startTick);
      const w = Math.max(3, n.durationTick * view.pxPerTick - 1);
      return { x, y: pitchToY(view, n.pitch) + 1, w, h: Math.max(3, rowH - 2) };
    };

    // Ghosts: the original as dashed outlines.
    if (ghosts) {
      ctx.strokeStyle = p.muted;
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 2]);
      for (const g of ghosts) {
        if (!visible(g)) continue;
        const r = rect(g);
        ctx.strokeRect(r.x + 0.5, r.y + 0.5, r.w - 1, r.h - 1);
      }
      ctx.setLineDash([]);
    }

    // Connectors from the original pitch to the changed pitch.
    const ghostById = ghosts ? new Map(ghosts.map((g) => [g.id, g])) : null;
    if (ghostById) {
      ctx.strokeStyle = p.connector;
      ctx.fillStyle = p.connector;
      ctx.lineWidth = 1.5;
      for (const n of shown) {
        const g = ghostById.get(n.id);
        if (!g || g.pitch === n.pitch || !(visible(n) || visible(g))) continue;
        const x = tickToX(view, n.startTick) + 3;
        const y0 = pitchToY(view, g.pitch) + rowH / 2;
        const y1 = pitchToY(view, n.pitch) + rowH / 2;
        ctx.beginPath();
        ctx.moveTo(x, y0);
        ctx.lineTo(x, y1);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(x, y0, 2.5, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // Active notes: filled; changed notes hatched (single = generated, cross = manual).
    for (const n of shown) {
      if (!visible(n)) continue;
      const r = rect(n);
      const g = ghostById?.get(n.id);
      const changed = !!g && g.pitch !== n.pitch;
      const manual =
        changes.get(n.id)?.reasonCode === 'MANUAL_EDIT' ||
        (drag?.moved && drag.kind !== 'ruler' && drag.id === n.id);
      ctx.fillStyle = changed ? p.changed : p.accent;
      ctx.fillRect(r.x, r.y, r.w, r.h);
      if (changed) {
        ctx.strokeStyle = p.base;
        ctx.lineWidth = 1;
        hatch(ctx, r.x, r.y, r.w, r.h, !!manual);
        ctx.strokeStyle = p.text;
        ctx.strokeRect(r.x + 0.5, r.y + 0.5, r.w - 1, r.h - 1);
      }
      if (props.outOfTarget?.(n.pitch) && r.h >= 6) {
        ctx.fillStyle = p.warn;
        ctx.font = `bold ${Math.min(12, r.h)}px system-ui, sans-serif`;
        ctx.textBaseline = 'middle';
        ctx.fillText('!', r.x + r.w + 2, r.y + r.h / 2);
      }
      if (n.id === selectedId) {
        ctx.strokeStyle = p.focus;
        ctx.lineWidth = 3;
        ctx.strokeRect(r.x - 2, r.y - 2, r.w + 4, r.h + 4);
        ctx.strokeStyle = p.text;
        ctx.lineWidth = 1;
        ctx.strokeRect(r.x - 0.5, r.y - 0.5, r.w + 1, r.h + 1);
      }
    }

    // Keyboard gutter: key, name, source / target membership columns.
    ctx.fillStyle = p.surface;
    ctx.fillRect(0, RULER, GUTTER, H);
    ctx.font = `${Math.min(11, Math.max(8, rowH - 3))}px system-ui, sans-serif`;
    ctx.textBaseline = 'middle';
    for (let pitch = firstPitch; pitch >= lastPitch; pitch--) {
      const y = pitchToY(view, pitch);
      const black = [1, 3, 6, 8, 10].includes(pitchClass(pitch));
      // Piano keys keep piano colours in both themes.
      ctx.fillStyle = black ? '#26233a' : '#fffaf3';
      ctx.fillRect(GUTTER - 18, y, 18, rowH);
      ctx.strokeStyle = p.hlHigh;
      ctx.lineWidth = 1;
      ctx.strokeRect(GUTTER - 17.5, y + 0.5, 17, rowH - 1);
      if (rowH >= 9 && (pitchClass(pitch) === 0 || rowH >= 13)) {
        ctx.fillStyle = pitchClass(pitch) === 0 ? p.text : p.muted;
        ctx.fillText(pitchName(pitch), 2, y + rowH / 2);
      }
      // Membership marks: ■ / 1 in the source column, □ / 1 in the target column.
      const cols = [
        [scales.source, scales.showSource, GUTTER - 32, p.source, true],
        [scales.target, scales.showTarget, GUTTER - 24, p.target, false],
      ] as const;
      for (const [m, show, x, colour, solid] of cols) {
        if (!show || !m || !inMode(pitch, m)) continue;
        const s = Math.min(5, rowH - 3);
        const cy = y + rowH / 2;
        if (pitchClass(pitch - m.root) === 0 && rowH >= 10) {
          ctx.fillStyle = colour;
          ctx.font = `bold ${Math.min(10, rowH - 2)}px system-ui, sans-serif`;
          ctx.fillText('1', x - 1, cy);
          ctx.font = `${Math.min(11, Math.max(8, rowH - 3))}px system-ui, sans-serif`;
        } else if (solid) {
          ctx.fillStyle = colour;
          ctx.fillRect(x, cy - s / 2, s, s);
        } else {
          ctx.strokeStyle = colour;
          ctx.lineWidth = 1;
          ctx.strokeRect(x + 0.5, cy - s / 2 + 0.5, s - 1, s - 1);
        }
      }
    }

    // Ruler: bar numbers and phrase labels.
    ctx.fillStyle = p.surface;
    ctx.fillRect(0, 0, W, RULER);
    ctx.strokeStyle = p.hlHigh;
    ctx.beginPath();
    ctx.moveTo(0, RULER - 0.5);
    ctx.lineTo(W, RULER - 0.5);
    ctx.stroke();
    ctx.font = '11px system-ui, sans-serif';
    ctx.textBaseline = 'middle';
    let lastLabel = -Infinity;
    for (const l of lines) {
      if (l.kind !== 'bar') continue;
      const x = tickToX(view, l.tick);
      if (x < GUTTER - 1 || x - lastLabel < 28) continue;
      lastLabel = x;
      ctx.fillStyle = p.text;
      ctx.fillText(String(l.bar), x + 3, RULER / 2 - 2);
    }
    phraseTicks.forEach((t, i) => {
      const x = tickToX(view, t);
      if (x < GUTTER || x > W) return;
      ctx.fillStyle = p.phrase;
      ctx.beginPath();
      ctx.moveTo(x, RULER - 1);
      ctx.lineTo(x - 4, RULER - 7);
      ctx.lineTo(x + 4, RULER - 7);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = p.muted;
      ctx.font = '9px system-ui, sans-serif';
      ctx.fillText(`P${i + 2}`, x + 5, RULER - 5);
      ctx.font = '11px system-ui, sans-serif';
    });
    if (loopRange) {
      const x0 = tickToX(view, loopRange.startTick);
      const x1 = tickToX(view, loopRange.endTick);
      ctx.strokeStyle = p.connector;
      ctx.lineWidth = 2;
      ctx.setLineDash(loopRange.on ? [] : [3, 3]);
      ctx.beginPath();
      ctx.moveTo(Math.max(GUTTER, x0), RULER - 2);
      ctx.lineTo(Math.min(W, x1), RULER - 2);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = p.connector;
      ctx.font = 'bold 12px system-ui, sans-serif';
      if (x0 >= GUTTER && x0 <= W) ctx.fillText('[', x0 + 2, RULER - 9);
      if (x1 >= GUTTER && x1 <= W) ctx.fillText(']', x1 - 6, RULER - 9);
    }
    ctx.fillStyle = p.surface;
    ctx.fillRect(0, 0, GUTTER, RULER);
  });

  // --- Interaction ----------------------------------------------------------

  const local = (e: PointerEvent) => {
    const r = (canvasRef.current as HTMLCanvasElement).getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const noteAt = (x: number, y: number) => {
    if (x < GUTTER || y < RULER) return -1;
    return hitNote(notes, xToTick(view, x), yToPitch(view, y));
  };

  const describe = (n: MelodyNote) => {
    const i = order.indexOf(notes.indexOf(n));
    return `第 ${i + 1} 个音 ${pitchName(n.pitch)}`;
  };

  const onPointerDown = (e: PointerEvent<HTMLCanvasElement>) => {
    if (e.button !== 0) return;
    const { x, y } = local(e);
    if (y < RULER) {
      if (x < GUTTER || !props.onSeek) return;
      e.currentTarget.setPointerCapture?.(e.pointerId);
      const tick = xToTick(view, x);
      setDrag({ kind: 'ruler', x0: x, tick, to: tick, moved: false });
      return;
    }
    if (x < GUTTER) {
      props.onAudition?.(yToPitch(view, y));
      return;
    }
    boxRef.current?.focus({ preventScroll: true });
    const i = noteAt(x, y);
    const n = notes[i];
    const touch = e.pointerType === 'touch';
    if (!n) {
      if (mode === 'compose' && props.onAdd) {
        const pitch = yToPitch(view, y);
        if (props.onAdd(pitch, snapTick(xToTick(view, x), quantum))) props.onAudition?.(pitch);
      } else onSelect(null);
      return;
    }
    onSelect(n.id);
    setAnnounce(`已选中${describe(n)}`);
    props.onAudition?.(n.pitch);
    dragSounded.current = n.pitch;
    if (touch) return; // touch: tap selects; pitch / time via keyboard or the inspector buttons
    e.currentTarget.setPointerCapture?.(e.pointerId);
    if (mode === 'edit') {
      if (props.onPitch) setDrag({ kind: 'pitch', id: n.id, pitch: n.pitch, moved: false });
      return;
    }
    const right = tickToX(view, n.startTick + n.durationTick);
    setDrag({
      kind: right - x <= 6 ? 'resize' : 'move',
      id: n.id,
      x0: x,
      startTick: n.startTick,
      durationTick: n.durationTick,
      pitch: n.pitch,
      patch: {},
      moved: false,
    });
  };

  const onPointerMove = (e: PointerEvent<HTMLCanvasElement>) => {
    if (!drag) return;
    const { x, y } = local(e);
    // Sounds at the moment the pitch changes, not on every pointer move.
    const sound = (pitch: number) => {
      if (pitch === dragSounded.current) return;
      dragSounded.current = pitch;
      props.onAudition?.(pitch);
    };
    if (drag.kind === 'ruler') {
      const moved = drag.moved || Math.abs(x - drag.x0) >= RULER_DRAG_PX;
      if (moved) {
        const grid = meta.ppq / 2;
        setDrag({
          ...drag,
          tick: drag.moved ? drag.tick : nearestTick(drag.tick, grid),
          to: nearestTick(xToTick(view, x), grid),
          moved,
        });
      }
      return;
    }
    if (drag.kind === 'pitch') {
      const raw = yToPitch(view, y);
      const pitch = props.dragPitch ? props.dragPitch(raw) : raw;
      if (pitch !== drag.pitch || drag.moved) {
        setDrag({ ...drag, pitch, moved: true });
        sound(pitch);
      }
      return;
    }
    const dt = Math.round((x - drag.x0) / view.pxPerTick / quantum) * quantum;
    const patch: NotePatch =
      drag.kind === 'resize'
        ? { durationTick: Math.max(quantum, drag.durationTick + dt) }
        : { startTick: Math.max(0, drag.startTick + dt), pitch: yToPitch(view, y) };
    if (
      patch.durationTick !== drag.patch.durationTick ||
      patch.startTick !== drag.patch.startTick ||
      patch.pitch !== drag.patch.pitch
    ) {
      setDrag({ ...drag, patch, moved: true });
      if (patch.pitch !== undefined) sound(patch.pitch);
    }
  };

  const onPointerUp = () => {
    const d = drag;
    setDrag(null);
    if (d?.kind === 'ruler') {
      if (d.moved) props.onLoopRange?.(d.tick, d.to);
      else props.onSeek?.(nearestTick(d.tick, meta.ppq / 4));
      return;
    }
    if (!d?.moved) return;
    if (d.kind === 'pitch') {
      const n = notes.find((x) => x.id === d.id);
      if (n && n.pitch !== d.pitch) {
        props.onPitch?.(d.id, d.pitch);
        setAnnounce(`已改为 ${pitchName(d.pitch)}`);
      }
    } else props.onUpdate?.(d.id, d.patch);
  };

  // Keep the selected note in view.
  useEffect(() => {
    const box = boxRef.current;
    const n = notes.find((x) => x.id === selectedId);
    if (!box || !n || size.width === 0) return;
    const x0 = GUTTER + n.startTick * zoom.pxPerTick;
    const x1 = x0 + n.durationTick * zoom.pxPerTick;
    const y0 = RULER + (range.hi - n.pitch) * zoom.rowH;
    if (x0 - GUTTER < box.scrollLeft + GUTTER || x1 > box.scrollLeft + size.width - 8)
      box.scrollLeft = Math.max(0, x0 - GUTTER - size.width / 3);
    if (y0 - RULER < box.scrollTop + RULER || y0 + zoom.rowH > box.scrollTop + size.height - 4)
      box.scrollTop = Math.max(0, y0 - size.height / 2);
    // Only on selection / pitch changes, not on every scroll.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, notes]);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const idx = notes.findIndex((n) => n.id === selectedId);
    const cur = notes[idx];
    const pos = cur ? order.indexOf(idx) : -1;
    const selectAt = (k: number) => {
      const n = notes[order[Math.max(0, Math.min(order.length - 1, k))] as number];
      if (!n) return;
      onSelect(n.id);
      setAnnounce(`已选中${describe(n)}`);
      if (n.id !== cur?.id) props.onAudition?.(n.pitch);
    };
    const key = e.key;
    let handled = true;
    if (key === 'Escape') onSelect(null);
    else if (key === 'Home') selectAt(0);
    else if (key === 'End') selectAt(order.length - 1);
    else if ((key === 'ArrowLeft' || key === 'ArrowRight') && !e.shiftKey && !e.altKey) {
      selectAt(pos < 0 ? 0 : pos + (key === 'ArrowRight' ? 1 : -1));
    } else if ((key === 'ArrowUp' || key === 'ArrowDown') && cur) {
      const dir = key === 'ArrowUp' ? 1 : -1;
      if (mode === 'edit' && props.onPitch && props.stepPitch) {
        const to = props.stepPitch(cur, dir, e.shiftKey);
        if (to !== cur.pitch) {
          props.onPitch(cur.id, to);
          setAnnounce(`${describe(cur)} 改为 ${pitchName(to)}`);
          props.onAudition?.(to);
        }
      } else if (mode === 'compose') {
        const pitch = cur.pitch + dir * (e.shiftKey ? 12 : 1);
        if (props.onUpdate?.(cur.id, { pitch })) props.onAudition?.(pitch);
      }
    } else if (mode === 'compose' && cur && (key === 'ArrowLeft' || key === 'ArrowRight')) {
      const dir = key === 'ArrowRight' ? 1 : -1;
      if (e.shiftKey)
        props.onUpdate?.(cur.id, { startTick: Math.max(0, cur.startTick + dir * quantum) });
      else
        props.onUpdate?.(cur.id, {
          durationTick: Math.max(quantum, cur.durationTick + dir * quantum),
        });
    } else if (mode === 'compose' && cur && (key === 'Delete' || key === 'Backspace')) {
      props.onDelete?.(cur.id);
      setAnnounce('已删除音符');
    } else if (mode === 'compose' && key === 'Enter' && props.onAdd) {
      const last = notes[order[order.length - 1] as number];
      const after = cur ?? last;
      const pitch = after?.pitch ?? 60;
      if (props.onAdd(pitch, after ? after.startTick + after.durationTick : 0))
        props.onAudition?.(pitch);
    } else handled = false;
    if (handled) e.preventDefault();
  };

  const zoomX = (f: number) => {
    const box = boxRef.current;
    const centre = box ? (box.scrollLeft + size.width / 2 - GUTTER) / zoom.pxPerTick : 0;
    const pxPerTick = Math.max(2 / meta.ppq, Math.min(400 / meta.ppq, zoom.pxPerTick * f));
    setZoom({ ...zoom, pxPerTick });
    requestAnimationFrame(() => {
      if (box) box.scrollLeft = Math.max(0, centre * pxPerTick + GUTTER - size.width / 2);
    });
  };
  const zoomY = (d: number) => setZoom({ ...zoom, rowH: Math.max(6, Math.min(32, zoom.rowH + d)) });

  // Ctrl/Cmd + wheel zooms horizontally (a native listener: React's wheel listener is passive).
  const zoomXRef = useRef(zoomX);
  useEffect(() => {
    zoomXRef.current = zoomX;
  });
  useEffect(() => {
    const box = boxRef.current;
    if (!box) return;
    const onWheel = (e: WheelEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      zoomXRef.current(e.deltaY < 0 ? 1.25 : 0.8);
    };
    box.addEventListener('wheel', onWheel, { passive: false });
    return () => box.removeEventListener('wheel', onWheel);
  }, []);

  // The playhead: moved in animation frames, so playback never re-renders the roll.
  const paintView = useRef({ view, width: size.width, dragging: false });
  useEffect(() => {
    paintView.current = { view, width: size.width, dragging: drag !== null };
  });
  const playback = props.playback;
  const tickNow = playback?.tick;
  const playing = playback?.playing ?? false;
  const atTick = playback?.atTick;
  useEffect(() => {
    const el = playheadRef.current;
    if (!el || !tickNow) return;
    let raf = 0;
    let wasVisible = false;
    const paint = () => {
      const { view: v, width, dragging } = paintView.current;
      const tick = tickNow();
      const x = tickToX(v, tick);
      const box = boxRef.current;
      if (playing && wasVisible && !dragging && box && (x > width - FOLLOW_MARGIN || x < GUTTER))
        box.scrollLeft = Math.max(0, x + v.scrollX - GUTTER - FOLLOW_MARGIN);
      wasVisible = x >= GUTTER && x <= width;
      el.dataset['tick'] = String(Math.round(tick));
      el.style.display = wasVisible ? 'block' : 'none';
      el.style.transform = `translateX(${x}px)`;
      if (playing) raf = requestAnimationFrame(paint);
    };
    paint();
    return () => cancelAnimationFrame(raf);
  }, [tickNow, playing, atTick, scroll.x, zoom.pxPerTick, size.width]);

  const selected = notes.find((n) => n.id === selectedId);
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <div
        className="flex flex-wrap items-center gap-1 text-sm"
        role="toolbar"
        aria-label="卷帘缩放"
      >
        <span className="text-muted-text">横向</span>
        <button
          type="button"
          className="btn px-2 py-0.5"
          onClick={() => zoomX(1 / 1.5)}
          aria-label="横向缩小"
        >
          −
        </button>
        <button
          type="button"
          className="btn px-2 py-0.5"
          onClick={() => zoomX(1.5)}
          aria-label="横向放大"
        >
          +
        </button>
        <span className="ml-2 text-muted-text">纵向</span>
        <button
          type="button"
          className="btn px-2 py-0.5"
          onClick={() => zoomY(-2)}
          aria-label="纵向缩小"
        >
          −
        </button>
        <button
          type="button"
          className="btn px-2 py-0.5"
          onClick={() => zoomY(2)}
          aria-label="纵向放大"
        >
          +
        </button>
        <button type="button" className="btn ml-2 px-2 py-0.5" onClick={fit} data-testid="roll-fit">
          适应旋律
        </button>
      </div>
      <div
        ref={boxRef}
        className="relative h-72 max-w-full overflow-auto rounded-lg border border-hl-high bg-base sm:h-96"
        tabIndex={0}
        role="application"
        aria-roledescription="钢琴卷帘"
        aria-label={props.label}
        aria-describedby={helpId}
        data-testid="piano-roll"
        data-selected={selectedId ?? ''}
        data-notes={notes.length}
        onScroll={(e) => setScroll({ x: e.currentTarget.scrollLeft, y: e.currentTarget.scrollTop })}
        onKeyDown={onKeyDown}
      >
        <div
          style={{
            width: Math.max(content.width, size.width),
            height: Math.max(content.height, size.height),
          }}
        >
          <div
            className="sticky top-0 left-0 overflow-hidden"
            style={{ width: size.width, height: size.height }}
          >
            <canvas
              ref={canvasRef}
              className="block touch-pan-x touch-pan-y"
              style={{
                width: size.width,
                height: size.height,
                cursor: drag ? 'grabbing' : 'default',
              }}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={() => setDrag(null)}
              aria-hidden="true"
            />
            {playback && (
              <div
                ref={playheadRef}
                className="pointer-events-none absolute inset-y-0 left-0 w-0.5 bg-text"
                data-testid="playhead"
                aria-hidden="true"
              />
            )}
          </div>
        </div>
      </div>
      <p id={helpId} className="text-xs text-muted-text">
        {mode === 'edit'
          ? '键盘：←/→ 选择上一个/下一个音，↑/↓ 改音高（吸附时按音阶级进，否则按半音），Shift+↑/↓ 改八度，Esc 取消选择；鼠标可上下拖动音符。只改音高，不改时值。点击顶部标尺定位，沿标尺拖动设循环区间，点击左侧琴键试听。'
          : '键盘：Enter 在所选音之后添加音，←/→ 选择，↑/↓ 改音高（Shift 为八度），Shift+←/→ 移动，Alt+←/→ 缩短/加长，Delete 删除；鼠标点击空白处添加，拖动移动，拖右边缘改时值。点击顶部标尺定位，沿标尺拖动设循环区间，点击左侧琴键试听。'}
      </p>
      <p className="sr-only" aria-live="polite" data-testid="roll-announce">
        {announce}
      </p>
      {selected === undefined && selectedId && <span className="sr-only">所选音不在当前视图</span>}
    </div>
  );
}
