import Link from "next/link";
import { ROUTES } from "@/lib/constants/shared";

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <main className="flex flex-1 items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex justify-center">
          <Link
            href={ROUTES.home}
            className="rounded-sm font-semibold tracking-tight text-foreground hover:opacity-70 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          >
            InterviewIQ
          </Link>
        </div>
        {children}
      </div>
    </main>
  );
}
