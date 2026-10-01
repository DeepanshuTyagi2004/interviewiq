import { ROUTES } from "@/lib/constants/shared";

export interface NavLink {
  label: string;
  href: string;
  /** Shows the design's ⌄ marker. */
  menu?: boolean;
}

/** Header links. Anchors are root-relative so they work from every marketing page. */
export const HEADER_LINKS: NavLink[] = [
  { label: "Product", href: "/#product", menu: true },
  { label: "Solutions", href: "/#how", menu: true },
  { label: "Universities", href: "/#universities" },
  { label: "FAQ", href: "/#faq" },
  { label: "Companies", href: "/#companies" },
];

export const FOOTER_COLUMNS: { title: string; links: NavLink[] }[] = [
  {
    title: "Get started",
    links: [
      { label: "Start free", href: ROUTES.signup },
      { label: "Book a demo", href: ROUTES.contact },
      { label: "Log in", href: ROUTES.login },
    ],
  },
  {
    title: "Product",
    links: [
      { label: "Company research", href: "/#product" },
      { label: "Interview", href: "/#interview" },
      { label: "Debrief", href: "/#debrief" },
      { label: "Readiness", href: "/#readiness" },
    ],
  },
  {
    title: "Solutions",
    links: [
      { label: "Students", href: ROUTES.signup },
      { label: "Universities", href: ROUTES.forColleges },
      { label: "Professionals", href: ROUTES.signup },
    ],
  },
  {
    title: "Company",
    links: [
      { label: "About", href: ROUTES.about },
      { label: "Careers", href: ROUTES.contact },
      { label: "Contact", href: ROUTES.contact },
    ],
  },
];
