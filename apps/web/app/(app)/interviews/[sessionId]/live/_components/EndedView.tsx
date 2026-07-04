'use client'

import Link from 'next/link'

/** Shown once the interview has ended (machine states `ending`/`ended`). Simple hand-off to
 * the post-interview report — the report page itself is built in a later task. */
export function EndedView({ sessionId }: { sessionId: string }) {
  return (
    <div className="m-auto flex flex-col items-center gap-4 text-center">
      <h1 className="text-2xl font-semibold">Interview ended</h1>
      <p className="text-sm text-muted-foreground">
        Thanks for completing the interview. Your report will be ready shortly.
      </p>
      <Link href={`/interviews/${sessionId}/report`} className="text-sm font-medium underline underline-offset-4">
        View report
      </Link>
    </div>
  )
}
