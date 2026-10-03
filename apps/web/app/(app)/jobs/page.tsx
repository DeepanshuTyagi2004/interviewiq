import { redirect } from "next/navigation";
import { ROUTES } from "@/lib/constants/shared";
import { CompanyLibrary } from "./_components/CompanyLibrary";

export default async function JobsPage({
  searchParams,
}: {
  searchParams: Promise<{ company?: string | string[] }>;
}) {
  const { company } = await searchParams;
  // Old links (`/jobs?company=meesho`) land on the company's roles page.
  if (typeof company === "string" && company) redirect(`${ROUTES.jobs}/c/${encodeURIComponent(company)}`);
  return <CompanyLibrary />;
}
