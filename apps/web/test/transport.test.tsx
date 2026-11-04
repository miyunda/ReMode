import { afterEach, describe, expect, it } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from '../src/App';
import { programOf } from '../src/audio/AudioProvider';
import { DEFAULT_AUDIO_PREFS } from '../src/audio/prefs';
import { GUTTER, RULER, pitchRange } from '../src/lib/rollGeometry';
import { emptyDraft, addNote } from '../src/lib/draft';
import { initialState, variantMode, type ProjectState } from '../src/state/project';
import { flush, rig } from './fakeAudio';

afterEach(cleanup);

const DRONE_ON = { ...DEFAULT_AUDIO_PREFS, droneOn: true };
const status = () => screen.getByTestId('transport').getAttribute('data-status');
const canvas = () => document.querySelector('canvas') as HTMLCanvasElement;
const act2 = (fn: () => void) => act(async () => fn());

async function loaded(prefs = DRONE_ON) {
  const audio = rig({ prefs });
  const user = userEvent.setup();
  render(<App engine={audio.engine} />);
  await user.click(screen.getByRole('button', { name: '填入示例' }));
  await user.click(screen.getByRole('button', { name: '分析简谱' }));
  const picker = screen.getByTestId('source-picker');
  await user.selectOptions(within(picker).getByLabelText('体系'), 'church');
  await user.selectOptions(within(picker).getByLabelText('调式'), 'ionian');
  await user.click(screen.getByRole('button', { name: '使用此来源调式' }));
  return { ...audio, user };
}

const auditions = (b: ReturnType<typeof rig>['backend']) => b.voices.map((v) => v.pitch);

/** Canvas coordinates of a pitch row at the default zoom (jsdom has no layout, so no fit). */
function rowY(pitches: number[], pitch: number) {
  return RULER + (pitchRange(pitches).hi - pitch) * 14 + 7;
}

function examplePitches(engine: ReturnType<typeof rig>['engine']) {
  const program = (engine as unknown as { program: { notes: { pitch: number }[] } }).program;
  return program.notes.map((n) => n.pitch);
}

describe('transport panel', () => {
  it('is disabled until there is a melody, then plays, pauses and stops', async () => {
    const { user, backend } = await (async () => {
      const a = rig();
      const u = userEvent.setup();
      render(<App engine={a.engine} />);
      expect(screen.getByTestId('play')).toBeDisabled();
      await u.click(screen.getByRole('button', { name: '填入示例' }));
      await u.click(screen.getByRole('button', { name: '分析简谱' }));
      return { ...a, user: u };
    })();
    const play = screen.getByTestId('play');
    await user.click(play);
    await act2(flush);
    expect(status()).toBe('playing');
    expect(play).toHaveTextContent('暂停');
    expect(screen.getByTestId('transport-status')).toHaveTextContent('播放中');
    expect(backend.voices.length).toBeGreaterThan(0);
    await user.click(play);
    expect(status()).toBe('paused');
    expect(screen.getByTestId('transport-status')).toHaveTextContent('已暂停');
    await user.click(screen.getByTestId('stop'));
    expect(status()).toBe('stopped');
  });

  it('says so when the browser has no Web Audio', () => {
    render(<App />); // jsdom has none
    expect(screen.getByTestId('audio-error')).toHaveTextContent('不支持 Web Audio');
  });

  it('labels every control, with state in text as well as colour', async () => {
    await loaded();
    expect(screen.getByLabelText('播放位置')).toBeInTheDocument();
    expect(screen.getByLabelText('音量')).toBeInTheDocument();
    expect(screen.getByLabelText('音色')).toBeInTheDocument();
    expect(screen.getByLabelText('试听音符')).toBeChecked();
    expect(screen.getByLabelText('主音持续低音（drone）')).toBeChecked();
    expect(screen.getByLabelText('模式')).toHaveValue('tonic');
    const loop = screen.getByTestId('loop-toggle');
    expect(loop).toHaveAttribute('aria-pressed', 'false');
    expect(loop).toHaveTextContent('循环：关');
    expect(screen.getByTestId('play')).toHaveAttribute('aria-keyshortcuts', 'Space');
  });

  it('shows the tonic and warns about a drone fifth the mode does not have', async () => {
    const { user, engine } = await loaded();
    expect(screen.getByTestId('drone-tonic')).toHaveTextContent('主音：C');
    await user.selectOptions(screen.getByLabelText('模式'), 'tonic-fifth');
    expect(engine.getSnapshot().prefs.droneMode).toBe('tonic-fifth');
    expect(screen.queryByTestId('drone-fifth-warning')).toBeNull();
    const picker = screen.getByTestId('source-picker');
    await user.selectOptions(within(picker).getByLabelText('调式'), 'locrian');
    await user.click(screen.getByRole('button', { name: '使用此来源调式' }));
    expect(screen.getByTestId('drone-fifth-warning')).toHaveTextContent('没有纯五度');
  });

  it('switching variant during playback keeps going on the same transport', async () => {
    const { user, advance, engine, backend } = await loaded();
    await user.click(screen.getByRole('button', { name: '生成 Strict' }));
    await user.click(screen.getByTestId('play'));
    await act2(flush);
    await act2(() => advance(1.3));
    const before = engine.position();
    await user.click(screen.getByTestId('view-original'));
    expect(status()).toBe('playing');
    expect(engine.position()).toBeCloseTo(before, -1);
    await act2(() => advance(0.2));
    expect(backend.soundingAt(backend.time).length).toBeLessThanOrEqual(1);
    expect(screen.getByTestId('transport-status')).toHaveTextContent('原曲');
  });
});

describe('keyboard', () => {
  const space = (target: Element | Window) =>
    fireEvent.keyDown(target, { key: ' ', code: 'Space' });

  it('Space toggles play/pause from the roll or the page', async () => {
    await loaded();
    space(screen.getByTestId('piano-roll'));
    await act2(flush);
    expect(status()).toBe('playing');
    space(document.body);
    expect(status()).toBe('paused');
  });

  it('Space stays with text fields, and held keys do not retrigger', async () => {
    await loaded();
    space(screen.getByLabelText('简谱文本'));
    expect(status()).toBe('stopped');
    expect(fireEvent.keyDown(document.body, { key: ' ', code: 'Space', repeat: true })).toBe(false);
    expect(status()).toBe('stopped');
  });

  it('L toggles the loop, [ and ] set its edges; text fields keep the keys', async () => {
    const { engine } = await loaded();
    const k = (key: string, target: Element = document.body) => fireEvent.keyDown(target, { key });
    k('l', screen.getByLabelText('简谱文本'));
    expect(engine.getSnapshot().loopOn).toBe(false);
    k('l');
    expect(screen.getByTestId('loop-toggle')).toHaveAttribute('aria-pressed', 'true');
    await act2(() => engine.seek(960));
    k('[');
    expect(engine.getSnapshot().loop?.startTick).toBe(960);
    await act2(() => engine.seek(1920));
    k(']');
    expect(engine.getSnapshot().loop).toEqual({ startTick: 960, endTick: 1920 });
    expect(screen.getByTestId('loop-range')).toHaveTextContent('1.3 – 2.1');
    k('L');
    expect(engine.getSnapshot().loopOn).toBe(false);
  });
});

describe('roll ruler', () => {
  it('a click seeks, a drag sets the loop', async () => {
    const { engine } = await loaded();
    const c = canvas();
    const atTick = (t: number) => GUTTER + (t * 40) / 480;
    fireEvent.pointerDown(c, { clientX: atTick(960), clientY: 5 });
    fireEvent.pointerUp(c, { clientX: atTick(960), clientY: 5 });
    expect(engine.getSnapshot().tick).toBe(960);

    fireEvent.pointerDown(c, { clientX: atTick(480), clientY: 5 });
    fireEvent.pointerMove(c, { clientX: atTick(1450), clientY: 5 });
    fireEvent.pointerUp(c, { clientX: atTick(1450), clientY: 5 });
    expect(engine.getSnapshot()).toMatchObject({
      loopOn: true,
      loop: { startTick: 480, endTick: 1440 },
      tick: 960,
    });
  });
});

describe('note audition', () => {
  it('selecting a note in the table sounds the pitch of the view', async () => {
    const { user, backend } = await loaded();
    await user.click(screen.getByRole('button', { name: '生成 Strict' }));
    const row = document.querySelector('[data-note-id="jianpu:n1"]') as HTMLElement;
    await user.click(within(row).getByRole('button'));
    await act2(flush);
    expect(auditions(backend)).toEqual([63]);
    expect(screen.getByTestId('audition-last')).toHaveTextContent('Eb4');
  });

  it('←/→ select with a sound; ↑/↓ sound the new pitch, once each', async () => {
    const { user, backend } = await loaded();
    await user.click(screen.getByRole('button', { name: '生成 Strict' }));
    const roll = screen.getByTestId('piano-roll');
    fireEvent.keyDown(roll, { key: 'Home' });
    await act2(flush);
    fireEvent.keyDown(roll, { key: 'ArrowRight' });
    fireEvent.keyDown(roll, { key: 'ArrowUp' });
    fireEvent.keyDown(roll, { key: 'End' });
    fireEvent.keyDown(roll, { key: 'End' }); // already selected: no new note, no sound
    expect(backend.voices).toHaveLength(4);
  });

  it('dragging sounds only when the pitch changes, one note per pitch', async () => {
    const { user, engine, backend } = await loaded(DEFAULT_AUDIO_PREFS);
    await user.click(screen.getByTestId('snap-toggle')); // semitones, so each row is a pitch
    const pitches = examplePitches(engine);
    const first = pitches[0]!;
    const y = (p: number) => rowY(pitches, p);
    const c = canvas();
    const x = GUTTER + 10;
    fireEvent.pointerDown(c, { clientX: x, clientY: y(first) });
    await act2(flush);
    expect(auditions(backend)).toEqual([first]);
    for (const dy of [0, 1, 2, 3, 4, 5, 6]) {
      fireEvent.pointerMove(c, { clientX: x, clientY: y(first) - dy }); // same row
    }
    expect(auditions(backend)).toEqual([first]);
    for (const p of [first + 1, first + 1, first + 2, first + 2, first + 1]) {
      fireEvent.pointerMove(c, { clientX: x, clientY: y(p) });
    }
    expect(auditions(backend)).toEqual([first, first + 1, first + 2, first + 1]);
    fireEvent.pointerUp(c, { clientX: x, clientY: y(first + 1) });
    expect(auditions(backend)).toHaveLength(4); // the commit is silent
  });

  it('clicking the keyboard gutter sounds that pitch, and selects nothing', async () => {
    const { engine, backend } = await loaded();
    const pitches = examplePitches(engine);
    fireEvent.pointerDown(canvas(), { clientX: 30, clientY: rowY(pitches, 70) });
    await act2(flush);
    expect(auditions(backend)).toEqual([70]);
    expect(screen.getByTestId('piano-roll')).toHaveAttribute('data-selected', '');
  });

  it('the inspector buttons sound the new pitch', async () => {
    const { user, backend } = await loaded();
    await user.click(screen.getByTestId('table-all'));
    const row = document.querySelector('[data-note-id="jianpu:n1"]') as HTMLElement;
    await user.click(within(row).getByRole('button'));
    await act2(flush);
    await user.click(screen.getByTestId('inspector-up'));
    await act2(flush);
    expect(auditions(backend)).toEqual([64, 65]);
  });

  it('is silent during playback and when switched off; the choice is saved', async () => {
    const saved: boolean[] = [];
    const audio = rig({ onPrefs: (p) => saved.push(p.audition) });
    const user = userEvent.setup();
    render(<App engine={audio.engine} />);
    await user.click(screen.getByRole('button', { name: '填入示例' }));
    await user.click(screen.getByRole('button', { name: '分析简谱' }));
    const roll = screen.getByTestId('piano-roll');
    await user.click(screen.getByTestId('play'));
    await act2(flush);
    const during = audio.backend.voices.length;
    fireEvent.keyDown(roll, { key: 'ArrowRight' });
    expect(audio.backend.voices).toHaveLength(during);
    expect(screen.getByTestId('audition-last')).toHaveTextContent('自动静音');
    await user.click(screen.getByTestId('stop'));
    await user.click(screen.getByTestId('audition-toggle'));
    expect(saved).toEqual([false]);
    const after = audio.backend.voices.length;
    fireEvent.keyDown(roll, { key: 'ArrowRight' });
    await act2(flush);
    expect(audio.backend.voices).toHaveLength(after);
  });
});

describe('new-melody mode', () => {
  async function draft() {
    const audio = rig({ prefs: DRONE_ON });
    const user = userEvent.setup();
    render(<App engine={audio.engine} />);
    await user.click(screen.getByTestId('new-melody'));
    return { ...audio, user, roll: screen.getByTestId('piano-roll') };
  }

  it('adding a note sounds it, a refused add does not, ↑ sounds the new pitch', async () => {
    const { backend, roll } = await draft();
    fireEvent.keyDown(roll, { key: 'Enter' });
    await act2(flush);
    expect(auditions(backend)).toEqual([60]);
    fireEvent.keyDown(roll, { key: 'ArrowUp' });
    fireEvent.keyDown(roll, { key: 'Enter' });
    expect(auditions(backend)).toEqual([60, 61, 61]);
    for (let i = 0; i < 60; i++) fireEvent.keyDown(roll, { key: 'ArrowUp' });
    const atLimit = backend.voices.length;
    fireEvent.keyDown(roll, { key: 'ArrowUp' }); // above C8: refused
    expect(backend.voices).toHaveLength(atLimit);
  });

  it('plays the draft without finishing it, with a drone on its key', async () => {
    const { backend, roll, user, advance } = await draft();
    expect(screen.getByTestId('play')).toBeDisabled();
    fireEvent.keyDown(roll, { key: 'Enter' });
    fireEvent.keyDown(roll, { key: 'Enter' });
    await act2(flush);
    const heard = backend.voices.length;
    await user.click(screen.getByTestId('play'));
    await act2(flush);
    expect(status()).toBe('playing');
    expect(screen.getByTestId('transport-status')).toHaveTextContent('新建旋律草稿');
    expect(screen.getByTestId('transport')).toHaveAttribute('data-drone', '48');
    expect(backend.voices.length).toBeGreaterThan(heard);
    await act2(() => advance(5));
    expect(status()).toBe('stopped');
    expect(screen.getByTestId('transport')).toHaveAttribute('data-drone', '');
  });

  it('finishing the draft stops playback: it is a new melody', async () => {
    const { roll, user } = await draft();
    fireEvent.keyDown(roll, { key: 'Enter' });
    await user.click(screen.getByTestId('play'));
    await act2(flush);
    await user.click(screen.getByTestId('draft-finish'));
    expect(status()).toBe('stopped');
  });
});

describe('programOf / variantMode', () => {
  it('a draft is a program of its own, with its key as the tonic', () => {
    const draft = addNote(emptyDraft({ ...emptyDraft().settings, keyPc: 7 }), {
      pitch: 67,
      startTick: 0,
    });
    const state: ProjectState = { ...initialState, draft };
    expect(variantMode(state)).toEqual({ root: 7, scaleId: 'ionian' });
    const p = programOf(state);
    expect(p?.key).toBe('draft');
    expect(p?.notes.map((n) => n.pitch)).toEqual([67]);
  });
  it('nothing loaded: no program, no mode', () => {
    expect(programOf(initialState)).toBeNull();
    expect(variantMode(initialState)).toBeNull();
  });
});
