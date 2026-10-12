'use client'
import { createContext, useContext } from 'react'
import type { ForeignInsert } from './editorClipboard'

/** What the room's panes can tell the proctor: the editor reports text that came from outside the room. */
export interface ProctorActions {
  foreignPaste(info: ForeignInsert): void
}

const Ctx = createContext<ProctorActions>({ foreignPaste: () => {} })

export const ProctorActionsProvider = Ctx.Provider

export function useProctorActions(): ProctorActions {
  return useContext(Ctx)
}
