// Sounds are synthesized on the fly: no audio files to load or license
const VOLUME_KEY = 'galactica:volume';
const DEFAULT_VOLUME = 0.6;

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let noiseBuffer: AudioBuffer | null = null;
let volume = readVolume();

function readVolume(): number {
	try {
		const raw = localStorage.getItem(VOLUME_KEY);
		const v = raw === null ? DEFAULT_VOLUME : Number(raw);
		return Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : DEFAULT_VOLUME;
	} catch {
		return DEFAULT_VOLUME;
	}
}

export function getVolume(): number {
	return volume;
}

export function setVolume(v: number) {
	volume = Math.min(1, Math.max(0, v));
	if (master) master.gain.value = volume;
	try {
		localStorage.setItem(VOLUME_KEY, String(volume));
	} catch {
		// Private browsing: the setting simply lasts for this page only
	}
}

// Shared with the music so both play through a single audio context
export function audioContext(): AudioContext | null {
	if (typeof window === 'undefined') return null;
	if (!ctx) {
		try {
			ctx = new AudioContext();
		} catch {
			return null;
		}
		master = ctx.createGain();
		master.gain.value = volume;
		master.connect(ctx.destination);
	}
	if (ctx.state === 'suspended') ctx.resume().catch(() => {});
	return ctx;
}

function audio(): { ctx: AudioContext; out: GainNode } | null {
	if (volume === 0) return null;
	const c = audioContext();
	return c ? { ctx: c, out: master! } : null;
}

export function noise(c: AudioContext): AudioBuffer {
	if (!noiseBuffer) {
		noiseBuffer = c.createBuffer(1, c.sampleRate, c.sampleRate);
		const data = noiseBuffer.getChannelData(0);
		for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
	}
	return noiseBuffer;
}

function envelope(c: AudioContext, out: AudioNode, peak: number, attack: number, decay: number) {
	const g = c.createGain();
	const t = c.currentTime;
	g.gain.setValueAtTime(0.0001, t);
	g.gain.exponentialRampToValueAtTime(peak, t + attack);
	g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
	g.connect(out);
	return g;
}

function tone(
	type: OscillatorType,
	from: number,
	to: number,
	duration: number,
	peak: number,
	delay = 0
) {
	const a = audio();
	if (!a) return;
	const { ctx: c, out } = a;
	const osc = c.createOscillator();
	osc.type = type;
	const t = c.currentTime + delay;
	osc.frequency.setValueAtTime(from, t);
	osc.frequency.exponentialRampToValueAtTime(to, t + duration);
	const g = c.createGain();
	g.gain.setValueAtTime(0.0001, t);
	g.gain.exponentialRampToValueAtTime(peak, t + 0.005);
	g.gain.exponentialRampToValueAtTime(0.0001, t + duration);
	osc.connect(g).connect(out);
	osc.start(t);
	osc.stop(t + duration + 0.02);
}

function burst(
	duration: number,
	peak: number,
	filter: BiquadFilterType,
	from: number,
	to: number
) {
	const a = audio();
	if (!a) return;
	const { ctx: c, out } = a;
	const src = c.createBufferSource();
	src.buffer = noise(c);
	const f = c.createBiquadFilter();
	f.type = filter;
	const t = c.currentTime;
	f.frequency.setValueAtTime(from, t);
	f.frequency.exponentialRampToValueAtTime(to, t + duration);
	src.connect(f).connect(envelope(c, out, peak, 0.005, duration));
	src.start(t);
	src.stop(t + duration + 0.05);
}

// `near` is false for the opponent's actions, played softer so our own stand out
export function shot(near = true) {
	tone('square', 1100, 260, 0.09, near ? 0.06 : 0.03);
}

export function missile(near = true) {
	tone('sawtooth', 240, 70, 0.32, near ? 0.09 : 0.05);
	burst(0.3, near ? 0.06 : 0.03, 'bandpass', 1800, 300);
}

// The opponent got hit by us
export function hitConfirm() {
	tone('triangle', 1500, 1300, 0.06, 0.08);
}

// We got hit
export function hurt(heavy: boolean) {
	burst(heavy ? 0.25 : 0.12, heavy ? 0.35 : 0.2, 'lowpass', 1200, 120);
	tone('sine', heavy ? 140 : 180, 50, heavy ? 0.25 : 0.12, heavy ? 0.3 : 0.18);
}

export function explosion() {
	burst(0.9, 0.5, 'lowpass', 2500, 60);
	tone('sine', 90, 30, 0.7, 0.4);
}

export function dash(near = true) {
	burst(0.22, near ? 0.12 : 0.06, 'bandpass', 400, 2400);
}

export function victory() {
	[523, 659, 784, 1047].forEach((f, i) => tone('triangle', f, f, 0.22, 0.12, i * 0.11));
}

export function defeat() {
	[392, 330, 262].forEach((f, i) => tone('triangle', f, f * 0.97, 0.3, 0.1, i * 0.16));
}
