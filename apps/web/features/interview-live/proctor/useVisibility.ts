'use client'
import { useEffect, useState } from 'react'

interface UseVisibilityResult {
  hidden: boolean
}

export function useVisibility(): UseVisibilityResult {
  const [hidden, setHidden] = useState(() => typeof document !== 'undefined' && document.hidden)

  useEffect(() => {
    const onVisibilityChange = () => setHidden(document.hidden)
    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => document.removeEventListener('visibilitychange', onVisibilityChange)
  }, [])

  return { hidden }
}
