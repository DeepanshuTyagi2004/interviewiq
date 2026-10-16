import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { VisionState } from './visionAssets'

const h = vi.hoisted(() => ({ state: { phase: 'checking', received: 0, total: 100 } as VisionState, start: vi.fn() }))
vi.mock('./visionAssets', () => ({ useVisionAssets: () => h.state, startVisionDownload: h.start }))

import { CameraCheckStatus } from './CameraCheckStatus'

beforeEach(() => { h.start.mockClear() })

describe('CameraCheckStatus', () => {
  it('shows a tick when the files are on the device', () => {
    h.state = { phase: 'ready', received: 100, total: 100 }
    render(<CameraCheckStatus />)
    expect(screen.getByText('Ready:')).toBeInTheDocument()
    expect(screen.getByText('Camera check ready')).toBeInTheDocument()
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument()
  })

  it('shows a cross and the progress while downloading, and makes sure the download runs', () => {
    h.state = { phase: 'downloading', received: 42, total: 100 }
    render(<CameraCheckStatus />)
    expect(screen.getByText('Not ready:')).toBeInTheDocument()
    expect(screen.getByText('Camera check downloading · 42%')).toBeInTheDocument()
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '42')
    expect(screen.getByText(/your camera won't be checked this round/)).toBeInTheDocument()
    expect(h.start).toHaveBeenCalled()
  })

  it('offers a retry after a failed download', async () => {
    h.state = { phase: 'error', received: 10, total: 100 }
    render(<CameraCheckStatus />)
    h.start.mockClear()
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(h.start).toHaveBeenCalledTimes(1)
  })

  it('says when this browser cannot keep the files', () => {
    h.state = { phase: 'unsupported', received: 0, total: 100 }
    render(<CameraCheckStatus />)
    expect(screen.getByText('Camera check not available in this browser')).toBeInTheDocument()
  })
})
