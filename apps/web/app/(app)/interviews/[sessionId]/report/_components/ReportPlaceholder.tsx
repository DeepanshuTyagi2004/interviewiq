"use client";

import { useSession } from "@/features/interview";

export function ReportPlaceholder({ sessionId }: { sessionId: string }) {
  const { data: session, isLoading, error } = useSession(sessionId);

  if (isLoading) {
    return (
      <main className="flex-1 p-8">
        <div className="max-w-2xl mx-auto">
          <div className="animate-pulse">
            <div className="h-6 bg-gray-300 rounded w-1/3 mb-4"></div>
            <div className="h-4 bg-gray-200 rounded w-1/2 mb-2"></div>
            <div className="h-4 bg-gray-200 rounded w-2/3"></div>
          </div>
          <p className="mt-4 text-gray-600">Loading interview report...</p>
        </div>
      </main>
    );
  }

  if (error || !session) {
    return (
      <main className="flex-1 p-8">
        <div className="max-w-2xl mx-auto">
          <div className="rounded-lg border border-red-200 bg-red-50 p-4">
            <p className="font-semibold text-red-900">Error</p>
            <p className="text-sm text-red-700">
              Failed to load your interview session. Please try refreshing the page.
            </p>
          </div>
        </div>
      </main>
    );
  }

  const displayCompany = session.companyName ?? session.company;

  return (
    <main className="flex-1 p-8">
      <div className="max-w-2xl mx-auto">
        <div className="mb-8">
          <h1 className="text-3xl font-bold mb-2">
            {displayCompany} — {session.roundType.toUpperCase()}
          </h1>
          <p className="text-gray-600">
            Round: {session.level} | {session.specialization}
          </p>
        </div>

        <div className="rounded-lg border border-amber-200 bg-amber-50 p-6">
          <div className="flex items-start gap-4">
            <div className="text-2xl">⏱️</div>
            <div>
              <p className="font-semibold text-amber-900 mb-2">
                Your report is being prepared
              </p>
              <p className="text-sm text-amber-700">
                Detailed scoring, feedback, and recommendations will be available shortly.
                Check back in a moment for your comprehensive interview analysis.
              </p>
            </div>
          </div>
        </div>

        <div className="mt-8 p-4 bg-gray-50 rounded-lg">
          <h2 className="font-semibold text-gray-900 mb-2">What happens next</h2>
          <ul className="text-sm text-gray-600 space-y-2">
            <li>• Our AI interviewer is analyzing your responses</li>
            <li>• Generating a detailed scorecard with strengths and areas to improve</li>
            <li>• Compiling personalized recommendations for this role</li>
          </ul>
        </div>
      </div>
    </main>
  );
}
