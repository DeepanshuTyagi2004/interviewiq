'use client'
import { useEffect, useState } from 'react'
import { calibrate, lookingAway, NEW_ATTENTION, type Attention } from './attention'
import { alignmentPoints, eyeGaze, headPose, type Blendshapes, type Point } from './face'
import { IDENTITY, NEW_IDENTITY, observeEmbedding, type Identity } from './identity'
import { monitorStatus, NEW_MONITOR, stepMonitor, type CameraFlag, type CameraFlagKind, type CameraStatus, type Monitor } from './monitor'
import { loadFaceEmbedder, loadFaceLandmarker, type FaceEmbedder } from './vision'

/** About five frames a second: enough for multi-second thresholds, light on a low-end laptop. */
export const FRAME_MS = 200

/** The slice of MediaPipe's FaceLandmarker this hook uses (so tests can fake it). */
export interface Landmarker {
  detectForVideo(video: HTMLVideoElement, timestamp: number): {
    faceLandmarks: Point[][]
    faceBlendshapes: { categories: { categoryName: string; score: number }[] }[]
  }
  close(): void
}

export interface CameraLoaders {
  landmarker: () => Promise<Landmarker>
  embedder: () => Promise<FaceEmbedder>
}

const DEFAULT_LOADERS: CameraLoaders = { landmarker: loadFaceLandmarker, embedder: loadFaceEmbedder }

export interface CameraProctor {
  status: CameraStatus
  /** The condition behind an amber or red border. */
  reason: CameraFlagKind | null
  /** The camera ledger: one entry per sustained violation. */
  flags: CameraFlag[]
}

const STARTING: CameraProctor = { status: 'starting', reason: null, flags: [] }

/** Watches the candidate's own camera on the device: one person, the same person, looking at the screen.
 * Feeds the tile's border and the camera ledger only; nothing is sent anywhere. */
export function useCameraProctor({
  stream, enabled, loaders = DEFAULT_LOADERS,
}: { stream: MediaStream | null; enabled: boolean; loaders?: CameraLoaders }): CameraProctor {
  const [state, setState] = useState<CameraProctor>(STARTING)
  const hasVideo = !!stream && typeof stream.getVideoTracks === 'function' && stream.getVideoTracks().length > 0

  useEffect(() => {
    if (!enabled || !stream || !hasVideo) return
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | undefined
    let landmarker: Landmarker | null = null
    let embedder: FaceEmbedder | null = null
    let monitor: Monitor = NEW_MONITOR
    let attention: Attention = NEW_ATTENTION
    let identity: Identity = NEW_IDENTITY
    let embedding = false
    let lastEmbed = 0
    let shown: CameraProctor = STARTING
    // Its own element, never shown: the tile's video is mirrored and resized with the layout.
    let video: HTMLVideoElement | null = null

    const show = (next: CameraProctor) => {
      if (next.status === shown.status && next.reason === shown.reason && next.flags === shown.flags) return
      shown = next
      setState(next)
    }

    const checkIdentity = (video: HTMLVideoElement, points: Point[], now: number) => {
      const every = identity.baseline ? IDENTITY.checkEveryMs : IDENTITY.enrollEveryMs
      if (!embedder || embedding || now - lastEmbed < every) return
      embedding = true
      lastEmbed = now
      embedder.embed(video, points)
        .then((e) => { if (!cancelled) identity = observeEmbedding(identity, e) })
        .catch(() => {})
        .finally(() => { embedding = false })
    }

    const tick = () => {
      if (cancelled || !landmarker || !video) return
      timer = setTimeout(tick, FRAME_MS)
      // A hidden tab is already counted by the proctor, and browsers stop delivering frames to it.
      if (document.hidden || video.readyState < 2 || !video.videoWidth) return
      const now = Date.now()
      let result: ReturnType<Landmarker['detectForVideo']>
      try {
        // MediaPipe needs strictly increasing timestamps, which the wall clock doesn't promise.
        result = landmarker.detectForVideo(video, performance.now())
      } catch {
        return
      }
      const faces = result.faceLandmarks.length
      let away: boolean | null = null
      if (faces === 1) {
        const w = video.videoWidth
        const h = video.videoHeight
        const lm = result.faceLandmarks[0]
        const shapes: Blendshapes = {}
        for (const c of result.faceBlendshapes[0]?.categories ?? []) shapes[c.categoryName] = c.score
        const pose = headPose(lm, w, h)
        const gaze = eyeGaze(shapes)
        attention = calibrate(attention, pose, gaze)
        away = lookingAway(pose, gaze, attention.baseline)
        // Only a clear, facing frame is compared: a turned head would look like someone else.
        if (away === false) checkIdentity(video, alignmentPoints(lm, w, h), now)
      }
      const step = stepMonitor(monitor, { faces, away, identity: identity.verdict }, now)
      monitor = step.monitor
      show({ ...monitorStatus(monitor), flags: monitor.flags })
    }

    loaders.landmarker()
      .then((lm) => {
        if (cancelled) { lm.close(); return }
        landmarker = lm
        video = document.createElement('video')
        video.muted = true
        video.playsInline = true
        video.srcObject = stream
        void video.play()?.catch(() => {})
        tick()
        // The identity model is larger; the other checks run while it loads, and a failure only turns this check off.
        return loaders.embedder().then((e) => {
          if (cancelled) e.close()
          else embedder = e
        }).catch(() => {})
      })
      .catch(() => { if (!cancelled) show({ status: 'unavailable', reason: null, flags: [] }) })

    return () => {
      cancelled = true
      clearTimeout(timer)
      if (video) {
        video.pause()
        video.srcObject = null
      }
      landmarker?.close()
      embedder?.close()
    }
  }, [enabled, stream, hasVideo, loaders])

  if (!enabled || !hasVideo) return { status: 'unavailable', reason: null, flags: state.flags }
  return state
}
