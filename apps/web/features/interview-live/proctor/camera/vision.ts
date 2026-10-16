/**
 * Loads the two on-device models for the live room. Both run in the browser (WebAssembly, GPU where available):
 * no frame, crop or embedding ever leaves the candidate's machine, and nothing here calls an LLM.
 *
 * - Face landmarker (MediaPipe, Apache-2.0): face count, landmarks and eye-direction blendshapes.
 * - SFace face recognition, int8 (OpenCV Zoo, Apache-2.0): a 128-number embedding of an aligned 112x112 face.
 *
 * Every file (runtimes included) comes from the device copy that visionAssets.ts downloads in the background;
 * nothing is fetched here. When a file isn't on the device yet, loading fails and the round runs without the check.
 */
import type { FaceLandmarker } from '@mediapipe/tasks-vision'
import { ARCFACE_TEMPLATE, similarityTransform, type Point } from './face'
import { readVisionFile } from './visionAssets'

/** Up to this many faces are found per frame; two is enough to know "more than one". */
const MAX_FACES = 3

function blobUrl(bytes: Uint8Array, type: string): string {
  return URL.createObjectURL(new Blob([bytes as Uint8Array<ArrayBuffer>], { type }))
}

export async function loadFaceLandmarker(): Promise<FaceLandmarker> {
  const [loader, wasm, model] = await Promise.all([
    readVisionFile('mpLoader'), readVisionFile('mpWasm'), readVisionFile('landmarker'),
  ])
  const { FaceLandmarker } = await import('@mediapipe/tasks-vision')
  // What FilesetResolver.forVisionTasks would return, pointing at the device copies.
  const fileset = { wasmLoaderPath: blobUrl(loader, 'text/javascript'), wasmBinaryPath: blobUrl(wasm, 'application/wasm') }
  const options = (delegate: 'GPU' | 'CPU') => ({
    baseOptions: { modelAssetBuffer: model, delegate },
    runningMode: 'VIDEO' as const,
    numFaces: MAX_FACES,
    outputFaceBlendshapes: true,
  })
  try {
    return await FaceLandmarker.createFromOptions(fileset, options('GPU'))
  } catch {
    return FaceLandmarker.createFromOptions(fileset, options('CPU'))
  }
}

export interface FaceEmbedder {
  /** The embedding of the face whose five alignment points (in video pixels) are given. */
  embed(video: HTMLVideoElement, points: Point[]): Promise<Float32Array>
  close(): void
}

const CROP = 112

export async function loadFaceEmbedder(): Promise<FaceEmbedder> {
  const [runtime, model] = await Promise.all([readVisionFile('ortWasm'), readVisionFile('sface')])
  const ort = await import('onnxruntime-web/wasm')
  ort.env.wasm.wasmBinary = runtime
  // Threads need cross-origin isolation, which the app doesn't have; one thread is plenty every few seconds.
  ort.env.wasm.numThreads = 1
  ort.env.logLevel = 'error'
  const session = await ort.InferenceSession.create(model, { executionProviders: ['wasm'] })
  const canvas = document.createElement('canvas')
  canvas.width = CROP
  canvas.height = CROP
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) throw new Error('no 2d canvas')
  const input = session.inputNames[0]
  const output = session.outputNames[0]

  return {
    async embed(video, points) {
      ctx.setTransform(1, 0, 0, 1, 0, 0)
      ctx.clearRect(0, 0, CROP, CROP)
      ctx.setTransform(...similarityTransform(points, ARCFACE_TEMPLATE))
      ctx.drawImage(video, 0, 0)
      const { data } = ctx.getImageData(0, 0, CROP, CROP)
      // RGB planes, raw 0..255: what the model expects (OpenCV feeds it blobFromImage(swapRB) without scaling).
      const area = CROP * CROP
      const chw = new Float32Array(3 * area)
      for (let i = 0; i < area; i++) {
        chw[i] = data[i * 4]
        chw[area + i] = data[i * 4 + 1]
        chw[2 * area + i] = data[i * 4 + 2]
      }
      const result = await session.run({ [input]: new ort.Tensor('float32', chw, [1, 3, CROP, CROP]) })
      return new Float32Array(result[output].data as Float32Array)
    },
    close() {
      void session.release()
    },
  }
}
