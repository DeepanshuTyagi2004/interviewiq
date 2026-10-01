import { CompanyLibrary } from "./_components/CompanyLibrary";

export default async function JobsPage({
  searchParams,
}: {
  searchParams: Promise<{ company?: string | string[] }>;
}) {
  const { company } = await searchParams;
  return <CompanyLibrary initialCompany={typeof company === "string" && company ? company : null} />;
}
