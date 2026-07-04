'use client'
import { useEffect, useRef, useState } from 'react'

export function useSpeakingLevel(stream: MediaStream | null, enabled: boolean): boolean {
  const [speaking, setSpeaking] = useState(false)
  const raf = useRef<number | null>(null)
  useEffect(() => {
    if (!stream || !enabled || typeof AudioContext === 'undefined') { setSpeaking(false); return }
    const ctx = new AudioContext()
    const src = ctx.createMediaStreamSource(stream)
    const analyser = ctx.createAnalyser()
    analyser.fftSize = 512
    src.connect(analyser)
    const buf = new Uint8Array(analyser.frequencyBinCount)
    const tick = () => {
      analyser.getByteTimeDomainData(buf)
      let sum = 0
      for (let i = 0; i < buf.length; i++) { const v = (buf[i] - 128) / 128; sum += v * v }
      setSpeaking(Math.sqrt(sum / buf.length) > 0.04)   // RMS threshold
      raf.current = requestAnimationFrame(tick)
    }
    raf.current = requestAnimationFrame(tick)
    return () => { if (raf.current) cancelAnimationFrame(raf.current); ctx.close() }
  }, [stream, enabled])
  return speaking
}
