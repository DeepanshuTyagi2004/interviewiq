import { Suspense } from "react";
import { CompanyRoles } from "../../_components/CompanyRoles";

/** A company's roles: `/jobs/c/meesho?level=fresher&stack=Java`. */
export default async function CompanyRolesPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return (
    <Suspense>
      <CompanyRoles slug={slug} />
    </Suspense>
  );
}
