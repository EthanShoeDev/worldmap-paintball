import '@tanstack/react-start/client-only';
import { nextRandom } from './bot-brain.ts';
import type { Vec3 } from './net/protocol.ts';
import type { WeaponId } from './tuning.ts';

// Every sound is synthesized with Web Audio, so there are no audio files to
// license or load. Positioned sounds go through a panner relative to the
// camera, which `moveListener` keeps up to date.

interface Audio {
  readonly context: AudioContext;
  readonly master: GainNode;
  readonly noise: AudioBuffer;
}

let audio: Audio | undefined;
let volume = 0.6;

// Variation only: no sound has to replay the same way twice.
let seed = 1;
const roll = () => {
  const [value, next] = nextRandom(seed);
  seed = next;
  return value;
};

const whiteNoise = (context: AudioContext) => {
  const buffer = context.createBuffer(
    1,
    context.sampleRate,
    context.sampleRate,
  );
  const samples = buffer.getChannelData(0);
  for (let index = 0; index < samples.length; index++) {
    samples[index] = roll() * 2 - 1;
  }
  return buffer;
};

// Browsers only start audio after a click or key press, so this runs from
// input handlers; sounds before then are dropped.
export const unlockAudio = () => {
  if (!audio) {
    const context = new AudioContext();
    const master = context.createGain();
    master.gain.value = volume;
    master.connect(context.destination);
    audio = { context, master, noise: whiteNoise(context) };
  }
  if (audio.context.state === 'suspended') {
    audio.context.resume().catch(() => undefined);
  }
};

const running = () => (audio?.context.state === 'running' ? audio : undefined);

export const setVolume = (next: number) => {
  volume = next;
  if (audio) audio.master.gain.value = next;
};

export const moveListener = (position: Vec3, forward: Vec3) => {
  const current = running();
  if (!current) return;
  const { listener, currentTime } = current.context;
  listener.positionX.setValueAtTime(position[0], currentTime);
  listener.positionY.setValueAtTime(position[1], currentTime);
  listener.positionZ.setValueAtTime(position[2], currentTime);
  listener.forwardX.setValueAtTime(forward[0], currentTime);
  listener.forwardY.setValueAtTime(forward[1], currentTime);
  listener.forwardZ.setValueAtTime(forward[2], currentTime);
};

// Where a sound plays: at a point in the arena, or in your own head.
const outputAt = ({ context, master }: Audio, at: Vec3 | undefined) => {
  if (!at) return master;
  const panner = new PannerNode(context, {
    panningModel: 'HRTF',
    distanceModel: 'inverse',
    refDistance: 4,
    rolloffFactor: 1.2,
    positionX: at[0],
    positionY: at[1],
    positionZ: at[2],
  });
  panner.connect(master);
  return panner;
};

// A gain that rises to `peak` in `attack` seconds, `delay` seconds from now,
// and fades out over `decay`.
const envelope = (
  context: AudioContext,
  output: AudioNode,
  peak: number,
  attack: number,
  decay: number,
  delay = 0,
) => {
  const start = context.currentTime + delay;
  const gain = context.createGain();
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(peak, start + attack);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + attack + decay);
  gain.connect(output);
  return { gain, start, end: start + attack + decay };
};

const noiseBurst = (
  { context, noise }: Audio,
  output: AudioNode,
  filter: BiquadFilterOptions,
  peak: number,
  decay: number,
) => {
  const { gain, start, end } = envelope(context, output, peak, 0.004, decay);
  const shaped = new BiquadFilterNode(context, filter);
  shaped.connect(gain);
  const source = new AudioBufferSourceNode(context, { buffer: noise });
  source.connect(shaped);
  source.start(start, roll() * 0.5);
  source.stop(end);
};

const tone = (
  { context }: Audio,
  output: AudioNode,
  {
    from,
    to,
    peak,
    decay,
    type = 'sine',
    delay = 0,
  }: {
    readonly from: number;
    readonly to: number;
    readonly peak: number;
    readonly decay: number;
    readonly type?: OscillatorType;
    readonly delay?: number;
  },
) => {
  const { gain, start, end } = envelope(
    context,
    output,
    peak,
    0.003,
    decay,
    delay,
  );
  const oscillator = new OscillatorNode(context, { type, frequency: from });
  oscillator.frequency.setValueAtTime(from, start);
  oscillator.frequency.exponentialRampToValueAtTime(to, end);
  oscillator.connect(gain);
  oscillator.start(start);
  oscillator.stop(end);
};

// A burst of compressed air and the thump of the bolt; the sniper is deeper
// and the shotgun broader.
const shotVoices: Record<
  WeaponId,
  { readonly hiss: number; readonly thump: number; readonly decay: number }
> = {
  assault: { hiss: 2200, thump: 170, decay: 0.07 },
  sniper: { hiss: 1500, thump: 110, decay: 0.12 },
  shotgun: { hiss: 1100, thump: 90, decay: 0.14 },
  launcher: { hiss: 700, thump: 60, decay: 0.25 },
};

export const playShot = (weapon: WeaponId, at: Vec3 | undefined) => {
  const current = running();
  if (!current) return;
  const voice = shotVoices[weapon];
  const output = outputAt(current, at);
  noiseBurst(
    current,
    output,
    { type: 'bandpass', frequency: voice.hiss, Q: 0.9 },
    0.5,
    voice.decay,
  );
  tone(current, output, {
    from: voice.thump,
    to: voice.thump / 3,
    peak: 0.45,
    decay: voice.decay,
  });
};

export const playSplat = (at: Vec3) => {
  const current = running();
  if (!current) return;
  const output = outputAt(current, at);
  noiseBurst(
    current,
    output,
    { type: 'lowpass', frequency: 700 + roll() * 400, Q: 2 },
    0.6,
    0.12,
  );
  tone(current, output, { from: 140, to: 60, peak: 0.25, decay: 0.06 });
};

// A paint grenade bursting: a long, low wet boom.
export const playBlast = (at: Vec3) => {
  const current = running();
  if (!current) return;
  const output = outputAt(current, at);
  noiseBurst(
    current,
    output,
    { type: 'lowpass', frequency: 500, Q: 1 },
    0.9,
    0.5,
  );
  tone(current, output, { from: 90, to: 30, peak: 0.6, decay: 0.4 });
};

// You took a power-up: a quick rising arpeggio.
export const playPowerUp = () => {
  const current = running();
  if (!current) return;
  for (const [index, note] of [660, 880, 1320].entries()) {
    tone(current, current.master, {
      from: note,
      to: note,
      peak: 0.18,
      decay: 0.12,
      type: 'triangle',
      delay: index * 0.07,
    });
  }
};

// Your shot hit a player: two bright blips.
export const playHitMarker = () => {
  const current = running();
  if (!current) return;
  const { master } = current;
  tone(current, master, { from: 1500, to: 1500, peak: 0.2, decay: 0.05 });
  tone(current, master, {
    from: 2100,
    to: 2100,
    peak: 0.2,
    decay: 0.06,
    delay: 0.06,
  });
};

export const playFootstep = (sprinting: boolean) => {
  const current = running();
  if (!current) return;
  noiseBurst(
    current,
    current.master,
    { type: 'lowpass', frequency: 300 + roll() * 250, Q: 1 },
    sprinting ? 0.35 : 0.25,
    0.06,
  );
};
