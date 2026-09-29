import { PageHeader } from "@/components/patterns";
import { BookingForm } from "./_components/BookingForm";
import { SessionsList } from "./_components/SessionsList";

/**
 * Mock interviews hub: book a session (role + round + slot) and track prep status. Server
 * Component shell; the form and list are client components (they use hooks + interaction).
 */
export default function InterviewsPage() {
  return (
    <div className="flex-1 space-y-8 p-6">
      <PageHeader
        title="Mock interviews"
        description="Pick a role and round, choose a time, and we'll prepare a tailored interview before your slot."
      />
      <BookingForm />
      <SessionsList />
    </div>
  );
}
