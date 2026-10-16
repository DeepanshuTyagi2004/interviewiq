/**
 * Loads the two on-device models. Both run in the browser (WebAssembly, GPU where available): no frame,
 * crop or embedding ever leaves the candidate's machine, and nothing here calls an LLM.
 *
 * - Face landmarker (MediaPipe, Apache-2.0): face count, landmarks and eye-direction blendshapes.
 * - SFace face recognition, int8 (OpenCV Zoo, Apache-2.0): a 128-number embedding of an aligned 112x112 face.
 *
 * The model files are kept on the device after the first download (modelCache.ts), so later interviews fetch
 * nothing; the WebAssembly runtimes are kept by the browser's HTTP cache (immutable on jsDelivr).
 *
 * Files come from pinned public CDNs by default. Set NEXT_PUBLIC_VISION_ASSETS_URL to self-host them;
 * that folder must hold `mediapipe/` (the package's wasm/ folder), `face_landmarker.task`, `ort/` (the
 * onnxruntime-web dist/ *.wasm and *.mjs files) and `face_recognition_sface_2021dec_int8.onnx`.
 */
import type { FaceLandmarker } from '@mediapipe/tasks-vision'
import { ARCFACE_TEMPLATE, similarityTransform, type Point } from './face'
import { loadModelFile } from './modelCache'

// Keep these in step with package.json.
const MEDIAPIPE_VERSION = '1.0.1'
const ORT_VERSION = '1.30.0'
const SFACE_REVISION = '3d7082438a6e4551e840c9b2bb60b71e8da4b524'

const SELF_HOSTED = process.env.NEXT_PUBLIC_VISION_ASSETS_URL?.replace(/\/$/, '')

export const ASSETS = SELF_HOSTED
  ? {
      mediapipeWasm: `${SELF_HOSTED}/mediapipe`,
      landmarker: `${SELF_HOSTED}/face_landmarker.task`,
      ortWasm: `${SELF_HOSTED}/ort/`,
      sface: `${SELF_HOSTED}/face_recognition_sface_2021dec_int8.onnx`,
    }
  : {
      mediapipeWasm: `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MEDIAPIPE_VERSION}/wasm`,
      landmarker: 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task',
      ortWasm: `https://cdn.jsdelivr.net/npm/onnxruntime-web@${ORT_VERSION}/dist/`,
      sface: `https://huggingface.co/opencv/face_recognition_sface/resolve/${SFACE_REVISION}/face_recognition_sface_2021dec_int8.onnx`,
    }

/** SHA-256 of each model file: checked before it is used or kept on the device (self-hosted copies must match). */
export const MODEL_SHA256 = {
  landmarker: '64184e229b263107bc2b804c6625db1341ff2bb731874b0bcc2fe6544e0bc9ff',
  sface: '2b0e941e6f16cc048c20aee0c8e31f569118f65d702914540f7bfdc14048d78a',
} as const

const landmarkerFile = () => loadModelFile(ASSETS.landmarker, MODEL_SHA256.landmarker)
const sfaceFile = () => loadModelFile(ASSETS.sface, MODEL_SHA256.sface)

/** Downloads (or finds on the device) both model files ahead of the round, e.g. on the instruction page, so the
 * check starts at once in the room. Never throws. */
export async function prefetchVisionModels(): Promise<void> {
  await Promise.allSettled([landmarkerFile(), sfaceFile()])
}

/** Up to this many faces are found per frame; two is enough to know "more than one". */
const MAX_FACES = 3

export async function loadFaceLandmarker(): Promise<FaceLandmarker> {
  const { FaceLandmarker, FilesetResolver } = await import('@mediapipe/tasks-vision')
  const [fileset, model] = await Promise.all([FilesetResolver.forVisionTasks(ASSETS.mediapipeWasm), landmarkerFile()])
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
  const ort = await import('onnxruntime-web/wasm')
  ort.env.wasm.wasmPaths = ASSETS.ortWasm
  // Threads need cross-origin isolation, which the app doesn't have; one thread is plenty every few seconds.
  ort.env.wasm.numThreads = 1
  ort.env.logLevel = 'error'
  const session = await ort.InferenceSession.create(await sfaceFile(), { executionProviders: ['wasm'] })
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
