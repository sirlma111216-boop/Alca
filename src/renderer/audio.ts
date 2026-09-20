/**
 * 효과음 — 음원 파일 없이 WebAudio 로 그때그때 합성한다.
 *
 * 왜 합성인가
 *  - 내려받을 파일이 없으니 학교 인터넷이 느려도 첫 소리가 바로 난다.
 *  - 원작 아케이드 게임의 효과음을 복제하지 않는다. 여기 있는 소리는 전부
 *    사각파·삼각파·짧은 잡음으로 새로 만든 것이다.
 *
 * 지켜야 할 것
 *  - AudioContext 는 만들어만 두고 unlock() 에서 resume() 한다. 브라우저는 사용자의 첫 조작
 *    전에는 소리를 내지 못하게 막는다. unlock 전 play() 는 조용히 무시한다.
 *  - 같은 페이지에 인스턴스가 여러 개 있어도 서로 간섭하지 않는다. 전역 상태를 쓰지 않는다.
 *  - 40명 경기에서는 초당 수백 번의 충돌이 난다. 동시 발음 수(16)와 같은 종류의
 *    최소 간격(30ms)을 두어 소리가 뭉개지지 않게 한다.
 */

import type { GameAudio, GameAudioOptions, SoundName } from './types'

type Ctor = typeof AudioContext

/** 동시에 울릴 수 있는 소리 수. */
const MAX_VOICES = 16
/** 같은 종류는 이 간격 안에 한 번만. */
const THROTTLE_MS = 30

interface ToneSpec {
  /** 시작 주파수(Hz). */
  freq: number
  /** 끝 주파수. 없으면 일정하게 유지. */
  freqEnd?: number
  /** 길이(초). */
  dur: number
  type: OscillatorType
  /** 최대 음량 (0~1, 마스터에 곱해진다). */
  gain: number
  /** 시작 지연(초). */
  delay?: number
}

interface NoiseSpec {
  dur: number
  gain: number
  /** 저역 통과 차단 주파수. */
  cutoff: number
  delay?: number
}

interface Recipe {
  tones: ToneSpec[]
  noise?: NoiseSpec
}

/**
 * 소리표.
 * 음정은 대략 A 단조 5음계 위에 있어 여러 소리가 겹쳐도 불협이 덜하다.
 */
function recipeFor(name: SoundName, pitch: number): Recipe {
  const p = (hz: number): number => hz * pitch
  switch (name) {
    case 'brick-hit':
      return { tones: [{ freq: p(520), dur: 0.045, type: 'square', gain: 0.16 }] }
    case 'brick-break':
      return {
        tones: [
          { freq: p(660), freqEnd: p(330), dur: 0.09, type: 'square', gain: 0.2 },
          { freq: p(990), dur: 0.05, type: 'triangle', gain: 0.1, delay: 0.01 },
        ],
        noise: { dur: 0.07, gain: 0.08, cutoff: 3200 },
      }
    case 'paddle-hit':
      return { tones: [{ freq: p(300), freqEnd: p(360), dur: 0.06, type: 'triangle', gain: 0.22 }] }
    case 'wall-hit':
      return { tones: [{ freq: p(220), dur: 0.03, type: 'square', gain: 0.1 }] }
    case 'ball-launch':
      return { tones: [{ freq: p(280), freqEnd: p(560), dur: 0.12, type: 'triangle', gain: 0.18 }] }
    case 'ball-catch':
      return { tones: [{ freq: p(440), dur: 0.05, type: 'sine', gain: 0.16 }] }
    case 'item-spawn':
      return {
        tones: [
          { freq: p(880), dur: 0.05, type: 'triangle', gain: 0.1 },
          { freq: p(1170), dur: 0.05, type: 'triangle', gain: 0.08, delay: 0.05 },
        ],
      }
    case 'item-collect':
      // 상승 2음 — "좋은 일" 이라는 신호.
      return {
        tones: [
          { freq: p(587), dur: 0.08, type: 'square', gain: 0.16 },
          { freq: p(880), dur: 0.12, type: 'square', gain: 0.16, delay: 0.07 },
        ],
      }
    case 'item-miss':
      return { tones: [{ freq: p(180), freqEnd: p(140), dur: 0.08, type: 'sine', gain: 0.1 }] }
    case 'item-expire':
      return {
        tones: [
          { freq: p(440), dur: 0.06, type: 'sine', gain: 0.1 },
          { freq: p(330), dur: 0.09, type: 'sine', gain: 0.1, delay: 0.06 },
        ],
      }
    case 'laser-fire':
      return { tones: [{ freq: p(1200), freqEnd: p(300), dur: 0.07, type: 'sawtooth', gain: 0.12 }] }
    case 'shield-bounce':
      return {
        tones: [{ freq: p(392), freqEnd: p(784), dur: 0.1, type: 'square', gain: 0.18 }],
        noise: { dur: 0.05, gain: 0.06, cutoff: 2400 },
      }
    case 'life-lost':
      return {
        tones: [
          { freq: p(392), freqEnd: p(196), dur: 0.28, type: 'triangle', gain: 0.22 },
          { freq: p(262), freqEnd: p(131), dur: 0.3, type: 'square', gain: 0.12, delay: 0.06 },
        ],
      }
    case 'wave-clear':
      return {
        tones: [
          { freq: p(523), dur: 0.1, type: 'square', gain: 0.18 },
          { freq: p(659), dur: 0.1, type: 'square', gain: 0.18, delay: 0.09 },
          { freq: p(784), dur: 0.18, type: 'square', gain: 0.18, delay: 0.18 },
        ],
      }
    case 'game-over':
      return {
        tones: [
          { freq: p(392), dur: 0.16, type: 'triangle', gain: 0.2 },
          { freq: p(311), dur: 0.16, type: 'triangle', gain: 0.2, delay: 0.16 },
          { freq: p(196), freqEnd: p(147), dur: 0.42, type: 'triangle', gain: 0.22, delay: 0.32 },
        ],
      }
    case 'countdown':
      return { tones: [{ freq: p(440), dur: 0.09, type: 'square', gain: 0.2 }] }
    case 'countdown-go':
      return {
        tones: [
          { freq: p(660), dur: 0.1, type: 'square', gain: 0.24 },
          { freq: p(990), dur: 0.2, type: 'square', gain: 0.2, delay: 0.08 },
        ],
      }
    case 'result-fanfare':
      // 결과 공개 — 짧은 4음. 길게 끌지 않는다(수업 흐름을 끊지 않도록).
      return {
        tones: [
          { freq: p(523), dur: 0.12, type: 'square', gain: 0.2 },
          { freq: p(659), dur: 0.12, type: 'square', gain: 0.2, delay: 0.11 },
          { freq: p(784), dur: 0.12, type: 'square', gain: 0.2, delay: 0.22 },
          { freq: p(1047), dur: 0.34, type: 'square', gain: 0.22, delay: 0.33 },
        ],
      }
    case 'ui-click':
      return { tones: [{ freq: p(720), dur: 0.025, type: 'square', gain: 0.12 }] }
    default:
      return { tones: [{ freq: p(440), dur: 0.04, type: 'square', gain: 0.12 }] }
  }
}

export function createGameAudio(options: GameAudioOptions): GameAudio {
  let enabled = options.enabled
  const master = Math.max(0, Math.min(1, options.masterVolume ?? 0.7))

  let ctx: AudioContext | null = null
  let masterGain: GainNode | null = null
  let noiseBuffer: AudioBuffer | null = null
  let unlocked = false
  let destroyed = false
  let voices = 0
  const lastPlayedAt = new Map<SoundName, number>()

  // AudioContext 는 여기서 "만들기만" 한다. 소리는 unlock() 이후에만 난다.
  try {
    const w = globalThis as unknown as { AudioContext?: Ctor; webkitAudioContext?: Ctor }
    const Ctx = w.AudioContext ?? w.webkitAudioContext
    if (Ctx) {
      ctx = new Ctx()
      masterGain = ctx.createGain()
      masterGain.gain.value = master
      masterGain.connect(ctx.destination)
    }
  } catch {
    ctx = null
    masterGain = null
  }

  function ensureNoise(context: AudioContext): AudioBuffer {
    if (noiseBuffer) return noiseBuffer
    const length = Math.floor(context.sampleRate * 0.25)
    const buffer = context.createBuffer(1, length, context.sampleRate)
    const data = buffer.getChannelData(0)
    for (let i = 0; i < length; i += 1) data[i] = Math.random() * 2 - 1
    noiseBuffer = buffer
    return buffer
  }

  function trackVoice(node: AudioScheduledSourceNode, gain: GainNode): void {
    voices += 1
    node.onended = (): void => {
      voices = Math.max(0, voices - 1)
      try {
        node.disconnect()
        gain.disconnect()
      } catch {
        /* 이미 끊겼으면 무시 */
      }
    }
  }

  function playTone(context: AudioContext, out: GainNode, spec: ToneSpec, volume: number): void {
    if (voices >= MAX_VOICES) return
    const t0 = context.currentTime + (spec.delay ?? 0)
    const osc = context.createOscillator()
    const gain = context.createGain()
    osc.type = spec.type
    osc.frequency.setValueAtTime(Math.max(20, spec.freq), t0)
    if (spec.freqEnd !== undefined) {
      osc.frequency.exponentialRampToValueAtTime(Math.max(20, spec.freqEnd), t0 + spec.dur)
    }
    const peak = Math.max(0.0001, spec.gain * volume)
    // 딸깍 소리를 막기 위해 아주 짧은 어택과 지수 감쇠를 준다.
    gain.gain.setValueAtTime(0.0001, t0)
    gain.gain.linearRampToValueAtTime(peak, t0 + 0.006)
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + spec.dur)
    osc.connect(gain)
    gain.connect(out)
    trackVoice(osc, gain)
    osc.start(t0)
    osc.stop(t0 + spec.dur + 0.02)
  }

  function playNoise(context: AudioContext, out: GainNode, spec: NoiseSpec, volume: number): void {
    if (voices >= MAX_VOICES) return
    const t0 = context.currentTime + (spec.delay ?? 0)
    const src = context.createBufferSource()
    src.buffer = ensureNoise(context)
    const filter = context.createBiquadFilter()
    filter.type = 'lowpass'
    filter.frequency.value = spec.cutoff
    const gain = context.createGain()
    const peak = Math.max(0.0001, spec.gain * volume)
    gain.gain.setValueAtTime(peak, t0)
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + spec.dur)
    src.connect(filter)
    filter.connect(gain)
    gain.connect(out)
    voices += 1
    src.onended = (): void => {
      voices = Math.max(0, voices - 1)
      try {
        src.disconnect()
        filter.disconnect()
        gain.disconnect()
      } catch {
        /* 무시 */
      }
    }
    src.start(t0)
    src.stop(t0 + spec.dur + 0.02)
  }

  return {
    get enabled(): boolean {
      return enabled
    },

    setEnabled(next: boolean): void {
      enabled = next
      if (!next && masterGain && ctx) {
        // 이미 예약된 소리까지 즉시 멈춘다.
        try {
          masterGain.gain.cancelScheduledValues(ctx.currentTime)
          masterGain.gain.setValueAtTime(0, ctx.currentTime)
        } catch {
          /* 무시 */
        }
      } else if (next && masterGain && ctx) {
        try {
          masterGain.gain.setValueAtTime(master, ctx.currentTime)
        } catch {
          /* 무시 */
        }
      }
    },

    unlock(): void {
      if (destroyed || !ctx) return
      unlocked = true
      if (ctx.state === 'suspended') {
        void ctx.resume().catch(() => {
          /* 사용자 조작이 아직 없었다면 다음 기회에 다시 시도된다 */
        })
      }
    },

    play(name: SoundName, opts?: { volume?: number; pitch?: number }): void {
      if (destroyed || !enabled || !unlocked) return
      const context = ctx
      const out = masterGain
      if (!context || !out || context.state !== 'running') return

      const now = context.currentTime * 1000
      const last = lastPlayedAt.get(name)
      if (last !== undefined && now - last < THROTTLE_MS) return
      lastPlayedAt.set(name, now)

      const volume = Math.max(0, Math.min(1, opts?.volume ?? 1))
      if (volume <= 0) return
      const pitch = Math.max(0.25, Math.min(4, opts?.pitch ?? 1))
      const recipe = recipeFor(name, pitch)
      for (let i = 0; i < recipe.tones.length; i += 1) {
        playTone(context, out, recipe.tones[i], volume)
      }
      if (recipe.noise) playNoise(context, out, recipe.noise, volume)
    },

    destroy(): void {
      if (destroyed) return
      destroyed = true
      enabled = false
      lastPlayedAt.clear()
      const context = ctx
      const out = masterGain
      ctx = null
      masterGain = null
      noiseBuffer = null
      voices = 0
      try {
        out?.disconnect()
      } catch {
        /* 무시 */
      }
      if (context && context.state !== 'closed') {
        void context.close().catch(() => {
          /* 이미 닫혔으면 무시 */
        })
      }
    },
  }
}
