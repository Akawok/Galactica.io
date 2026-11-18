import { audioContext, noise } from './sfx';

// A synthwave loop composed in code: A minor, Am - F - C - G, 16 bars that build and break down
const VOLUME_KEY = 'galactica:musicVolume';
const DEFAULT_VOLUME = 0.35;
const BPM = 100;
const STEP = 60 / BPM / 4;
const STEPS_PER_BAR = 16;
const LOOKAHEAD_S = 0.12;
const FADE_IN_S = 2;

// MIDI notes per bar: pad voicing, bass root
const CHORDS = [
	{ pad: [57, 60, 64], bass: 45 },
	{ pad: [57, 60, 65], bass: 41 },
	{ pad: [55, 60, 64], bass: 48 },
	{ pad: [55, 59, 62], bass: 43 }
];
const ARP_PATTERN = [0, 1, 2, 3, 2, 1, 0, 1, 2, 3, 2, 1, 3, 2, 1, 2];

// Four 4-bar sections: intro, groove, groove with lead, breakdown
const SECTIONS = [
	{ bass: true, arp: false, hats: false },
	{ bass: true, arp: true, hats: true },
	{ bass: true, arp: true, hats: true },
	{ bass: false, arp: true, hats: false }
];

let volume = readVolume();
// True between startMusic and stopMusic, so raising the volume only resumes music where it belongs
let wanted = false;
// Each start gets an id: a screen being torn down cannot stop the music its successor started
let session = 0;
let out: GainNode | null = null;
let echo: GainNode | null = null;
let timer: ReturnType<typeof setInterval> | null = null;
let nextTime = 0;
let step = 0;

function readVolume(): number {
	try {
		const raw = localStorage.getItem(VOLUME_KEY);
		const v = raw === null ? DEFAULT_VOLUME : Number(raw);
		return Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : DEFAULT_VOLUME;
	} catch {
		return DEFAULT_VOLUME;
	}
}

export function getMusicVolume(): number {
	return volume;
}

export function setMusicVolume(v: number) {
	volume = Math.min(1, Math.max(0, v));
	const c = out?.context;
	if (out && c) out.gain.setTargetAtTime(volume, c.currentTime, 0.1);
	try {
		localStorage.setItem(VOLUME_KEY, String(volume));
	} catch {
		// Private browsing: the setting simply lasts for this page only
	}
	if (volume > 0 && wanted && !timer) begin();
}

function freq(midi: number): number {
	return 440 * Math.pow(2, (midi - 69) / 12);
}

export function startMusic(): number {
	wanted = true;
	session++;
	if (!timer && volume > 0) begin();
	return session;
}

function begin() {
	const c = audioContext();
	if (!c) return;

	out = c.createGain();
	out.gain.setValueAtTime(0.0001, c.currentTime);
	out.gain.exponentialRampToValueAtTime(Math.max(volume, 0.0001), c.currentTime + FADE_IN_S);
	out.connect(c.destination);

	// Dotted-eighth echo that gives the lead its spacey tail
	const delay = c.createDelay(1);
	delay.delayTime.value = STEP * 3;
	const feedback = c.createGain();
	feedback.gain.value = 0.35;
	echo = c.createGain();
	echo.gain.value = 0.3;
	echo.connect(delay);
	delay.connect(feedback).connect(delay);
	delay.connect(out);

	nextTime = c.currentTime + 0.1;
	step = 0;
	timer = setInterval(() => schedule(c), 25);
}

export function stopMusic(id: number, fadeSeconds = 0.8) {
	if (id !== session) return;
	wanted = false;
	if (!timer || !out) return;
	clearInterval(timer);
	timer = null;
	const node = out;
	const c = node.context;
	node.gain.cancelScheduledValues(c.currentTime);
	node.gain.setValueAtTime(Math.max(node.gain.value, 0.0001), c.currentTime);
	node.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + fadeSeconds);
	setTimeout(() => node.disconnect(), fadeSeconds * 1000 + 200);
	out = null;
	echo = null;
}

function schedule(c: BaseAudioContext) {
	// A throttled background tab must not replay every missed note at once
	if (nextTime < c.currentTime - 0.05) nextTime = c.currentTime + 0.05;
	while (nextTime < c.currentTime + LOOKAHEAD_S) {
		playStep(c, step, nextTime);
		nextTime += STEP;
		step++;
	}
}

function playStep(c: BaseAudioContext, s: number, t: number) {
	if (!out || !echo) return;
	const bar = Math.floor(s / STEPS_PER_BAR);
	const inBar = s % STEPS_PER_BAR;
	const chord = CHORDS[bar % CHORDS.length];
	const section = SECTIONS[Math.floor(bar / 4) % SECTIONS.length];

	if (inBar === 0) pad(c, chord.pad, t, STEP * STEPS_PER_BAR);
	if (section.bass && inBar % 2 === 0) bass(c, chord.bass + (inBar % 8 === 6 ? 12 : 0), t);
	if (section.hats && inBar % 4 === 2) hat(c, t);
	if (section.arp) {
		const i = ARP_PATTERN[inBar];
		const note = i === 3 ? chord.pad[0] + 12 : chord.pad[i];
		lead(c, note + 12, t);
	}
}

function voice(
	c: BaseAudioContext,
	type: OscillatorType,
	note: number,
	t: number,
	attack: number,
	length: number,
	peak: number,
	cutoff: number,
	dest: AudioNode,
	detune = 0
) {
	const osc = c.createOscillator();
	osc.type = type;
	osc.frequency.value = freq(note);
	osc.detune.value = detune;
	const filter = c.createBiquadFilter();
	filter.type = 'lowpass';
	filter.frequency.value = cutoff;
	const g = c.createGain();
	g.gain.setValueAtTime(0.0001, t);
	g.gain.exponentialRampToValueAtTime(peak, t + attack);
	g.gain.exponentialRampToValueAtTime(0.0001, t + length);
	osc.connect(filter).connect(g).connect(dest);
	osc.start(t);
	osc.stop(t + length + 0.05);
}

function pad(c: BaseAudioContext, notes: number[], t: number, length: number) {
	for (const note of notes) {
		voice(c, 'sawtooth', note, t, 0.6, length, 0.03, 900, out!, -7);
		voice(c, 'sawtooth', note, t, 0.6, length, 0.03, 900, out!, 7);
	}
}

function bass(c: BaseAudioContext, note: number, t: number) {
	voice(c, 'sawtooth', note, t, 0.01, 0.22, 0.12, 500, out!);
}

function lead(c: BaseAudioContext, note: number, t: number) {
	voice(c, 'triangle', note, t, 0.005, 0.14, 0.05, 3000, out!);
	voice(c, 'triangle', note, t, 0.005, 0.14, 0.05, 3000, echo!);
}

function hat(c: BaseAudioContext, t: number) {
	const src = c.createBufferSource();
	src.buffer = noise(c as AudioContext);
	const filter = c.createBiquadFilter();
	filter.type = 'highpass';
	filter.frequency.value = 7000;
	const g = c.createGain();
	g.gain.setValueAtTime(0.0001, t);
	g.gain.exponentialRampToValueAtTime(0.03, t + 0.003);
	g.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
	src.connect(filter).connect(g).connect(out!);
	src.start(t);
	src.stop(t + 0.08);
}
