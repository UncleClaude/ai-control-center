// Soft two-note chime synthesised with WebAudio: no audio asset, same sound on every OS.
let ctx: AudioContext | null = null

export function playChime(): void {
  try {
    ctx ??= new AudioContext()
    const now = ctx.currentTime
    const master = ctx.createGain()
    master.gain.value = 0.18
    master.connect(ctx.destination)
    for (const [i, freq] of [880, 1318.5].entries()) {
      const t = now + i * 0.11
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.type = 'sine'
      osc.frequency.value = freq
      gain.gain.setValueAtTime(0, t)
      gain.gain.linearRampToValueAtTime(1, t + 0.012)
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.55)
      osc.connect(gain).connect(master)
      osc.start(t)
      osc.stop(t + 0.6)
    }
  } catch {
    /* audio unavailable */
  }
}
