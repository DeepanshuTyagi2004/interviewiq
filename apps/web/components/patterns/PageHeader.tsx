import * as React from "react";
import { PageHeader as DsPageHeader } from "@/components/ds/PageHeader";

export interface PageHeaderProps {
  title: string;
  description?: string;
  /** Optional small label above the title ("Dashboard"). */
  eyebrow?: string;
  actions?: React.ReactNode;
  className?: string;
}

/** Forwards to `ds/PageHeader`. */
export function PageHeader(props: PageHeaderProps) {
  return <DsPageHeader {...props} />;
}
