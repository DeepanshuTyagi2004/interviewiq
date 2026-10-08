import { describe, expect, it } from "vitest";
import { readmeTemplate } from "../../src/domain/profileScoring/readmeTemplates.js";

// As the GitHub collector stores them: code blocks, images and HTML stripped, whitespace collapsed.
const NEXT = "This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app). Getting Started First, run the development server: Open [http://localhost:3000](http://localhost:3000) with your browser to see the result. You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file. This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel. Learn More To learn more about Next.js, take a look at the following resources: - [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API. - [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial. You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome! Deploy on Vercel The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new) from the creators of Next.js. Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.";
const VITE = "# React + Vite This template provides a minimal setup to get React working in Vite with HMR and some ESLint rules. Currently, two official plugins are available: - [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react) uses [Babel](https://babeljs.io/) for Fast Refresh - [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react-swc) uses [SWC](https://swc.rs/) for Fast Refresh";

describe("default README detection", () => {
  it("recognizes unchanged starter READMEs, with a title or version added", () => {
    expect(readmeTemplate(NEXT)).toBe("create-next-app");
    expect(readmeTemplate(`# vibe v2.1 ${NEXT}`)).toBe("create-next-app");
    expect(readmeTemplate(VITE)).toBe("vite");
    expect(readmeTemplate("# progress_checker A new Flutter project.")).toBe("flutter");
  });

  it("keeps a README with real content of its own", () => {
    expect(readmeTemplate(`# Vibe Vibe turns prompts into working Next.js apps inside E2B sandboxes, with Inngest jobs and a live preview. ${NEXT}`)).toBeNull();
    expect(readmeTemplate("# todo-api A REST API for todos with JWT auth, Postgres and Redis caching. Run with docker compose up.")).toBeNull();
    expect(readmeTemplate("Built with create-next-app and then rewritten: a multi-tenant invoicing app with Stripe billing, role-based access and an audit log.")).toBeNull();
  });
});
