// Short sounds synthesised with WebAudio: no audio asset, same sound on every OS.
let ctx: AudioContext | null = null

function tones(seq: { freq: number; at: number; dur?: number }[], volume = 0.18): void {
  try {
    ctx ??= new AudioContext()
    const now = ctx.currentTime
    const master = ctx.createGain()
    master.gain.value = volume
    master.connect(ctx.destination)
    for (const { freq, at, dur = 0.5 } of seq) {
      const t = now + at
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.type = 'sine'
      osc.frequency.value = freq
      gain.gain.setValueAtTime(0, t)
      gain.gain.linearRampToValueAtTime(1, t + 0.012)
      gain.gain.exponentialRampToValueAtTime(0.001, t + dur)
      osc.connect(gain).connect(master)
      osc.start(t)
      osc.stop(t + dur + 0.05)
    }
  } catch {
    /* audio unavailable */
  }
}

/** Soft two-note chime for notifications. */
export function playChime(): void {
  tones([
    { freq: 880, at: 0, dur: 0.55 },
    { freq: 1318.5, at: 0.11, dur: 0.55 },
  ])
}

/** Push-to-talk: a rising blip when the mic opens (you can talk). */
export function playMicOn(): void {
  tones(
    [
      { freq: 587.33, at: 0, dur: 0.1 },
      { freq: 880, at: 0.06, dur: 0.14 },
    ],
    0.22,
  )
}

/** Push-to-talk: a falling blip when the mic closes (muted). */
export function playMicOff(): void {
  tones(
    [
      { freq: 587.33, at: 0, dur: 0.1 },
      { freq: 392, at: 0.06, dur: 0.16 },
    ],
    0.22,
  )
}
