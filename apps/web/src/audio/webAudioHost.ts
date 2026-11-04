// From a user gesture to a running AudioContext. The context is created and
// resumed synchronously in the gesture, because Safari ignores a resume() that
// happens after an await; the backend then adopts that context. Tone's own
// start() does the same resume, it just could not run early enough here.

import type { AudioBackend, AudioHost } from './backend';

const START_TIMEOUT_MS = 3000;

type Ctor = new (options?: AudioContextOptions) => AudioContext;

function audioContextCtor(): Ctor | undefined {
  const w = window as unknown as { AudioContext?: Ctor; webkitAudioContext?: Ctor };
  return w.AudioContext ?? w.webkitAudioContext;
}

function running(ctx: AudioContext): Promise<void> {
  if (ctx.state === 'running') return Promise.resolve();
  return new Promise((resolve, reject) => {
    const done = (fn: () => void) => {
      clearTimeout(timer);
      ctx.removeEventListener('statechange', onState);
      fn();
    };
    const onState = () => {
      if (ctx.state === 'running') done(resolve);
    };
    const timer = setTimeout(
      () => done(() => reject(new Error(`AudioContext is ${ctx.state}`))),
      START_TIMEOUT_MS,
    );
    ctx.addEventListener('statechange', onState);
  });
}

/** One silent sample: iOS keeps a resumed context muted until a source has started. */
function primeOutput(ctx: AudioContext) {
  const source = ctx.createBufferSource();
  source.buffer = ctx.createBuffer(1, 1, ctx.sampleRate);
  source.connect(ctx.destination);
  source.start();
}

export function createWebAudioHost(): AudioHost {
  const Ctor = typeof window === 'undefined' ? undefined : audioContextCtor();
  let ctx: AudioContext | null = null;
  let backend: AudioBackend | null = null;

  // A touch pointerdown does not count as activation; pointerup and click do.
  const retry = () => {
    window.removeEventListener('pointerup', retry);
    window.removeEventListener('click', retry);
    if (ctx && ctx.state !== 'running') void ctx.resume().catch(() => undefined);
  };

  return {
    supported: !!Ctor,

    unlock() {
      if (!Ctor) return;
      if (!ctx) {
        ctx = new Ctor({ latencyHint: 'interactive' });
        primeOutput(ctx);
      }
      if (ctx.state === 'running') return;
      void ctx.resume().catch(() => undefined);
      window.addEventListener('pointerup', retry);
      window.addEventListener('click', retry);
    },

    async load() {
      if (!ctx) throw new Error('no AudioContext');
      const [{ createToneBackend }] = await Promise.all([import('./toneBackend'), running(ctx)]);
      backend ??= createToneBackend(ctx);
      return backend;
    },
  };
}

/** Fetches the audio chunk while the page loads: the app must work offline once loaded. */
export function preloadAudio(): void {
  void import('./toneBackend').catch(() => undefined);
}
