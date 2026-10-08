/**
 * Default (scaffold) README detection. A repository whose README is still the text its starter tool
 * generated (create-next-app, Vite, Create React App, Flutter, Angular CLI, Expo, create-t3-app,
 * SvelteKit) says nothing about the project, so it is treated as having no README.
 *
 * Matching is by word sequences, so markdown, links, code blocks and small wording changes between
 * tool versions do not matter: a README is a default one when at least one 4-word run comes from a
 * starter template and almost every other word does too (a repository title and a version number are
 * allowed). A README with a real paragraph of its own is never treated as default.
 */

const TEMPLATES: Record<string, string> = {
  "create-next-app": `This is a Next.js project bootstrapped with create-next-app. Getting Started First, run the development server:
    npm run dev yarn dev pnpm dev bun dev Open http://localhost:3000 with your browser to see the result. You can start editing the page by
    modifying app/page.tsx. You can start editing the page by modifying pages/index.tsx. pages/index.js app/page.js The page auto-updates as
    you edit the file. API routes can be accessed on http://localhost:3000/api/hello. This endpoint can be edited in pages/api/hello.ts.
    The pages/api directory is mapped to /api/*. Files in this directory are treated as API routes instead of React pages. This project
    uses next/font to automatically optimize and load Geist, a new font family for Vercel. This project uses next/font to automatically
    optimize and load Inter, a custom Google Font. Learn More To learn more about Next.js, take a look at the following resources:
    Next.js Documentation - learn about Next.js features and API. Learn Next.js - an interactive Next.js tutorial. You can check out the
    Next.js GitHub repository - your feedback and contributions are welcome! Deploy on Vercel The easiest way to deploy your Next.js app is
    to use the Vercel Platform from the creators of Next.js. Check out our Next.js deployment documentation for more details.`,
  vite: `React + Vite React + TypeScript + Vite This template provides a minimal setup to get React working in Vite with HMR and some ESLint
    rules. Currently, two official plugins are available: @vitejs/plugin-react uses Babel (or oxc when used in rolldown-vite) for Fast
    Refresh @vitejs/plugin-react-swc uses SWC for Fast Refresh React Compiler The React Compiler is not enabled on this template because of
    its impact on dev & build performances. To add it, see this documentation. Expanding the ESLint configuration If you are developing a
    production application, we recommend using TypeScript with type-aware lint rules enabled. Check out the TS template for information on
    how to integrate TypeScript and typescript-eslint in your project. If you are developing a production application, we recommend
    updating the configuration to enable type-aware lint rules. Vue 3 + Vite This template should help get you started developing with
    Vue 3 in Vite. The template uses Vue 3 script setup SFCs, check out the script setup docs to learn more. Learn more about IDE Support
    for Vue in the Vue Docs Scaling up Guide. Recommended IDE Setup VSCode + Volar`,
  "create-react-app": `Getting Started with Create React App This project was bootstrapped with Create React App. Available Scripts In the
    project directory, you can run: npm start Runs the app in the development mode. Open http://localhost:3000 to view it in your browser.
    The page will reload when you make changes. You may also see any lint errors in the console. The page will reload if you make edits.
    npm test Launches the test runner in the interactive watch mode. See the section about running tests for more information. npm run
    build Builds the app for production to the build folder. It correctly bundles React in production mode and optimizes the build for the
    best performance. The build is minified and the filenames include the hashes. Your app is ready to be deployed! See the section about
    deployment for more information. npm run eject Note: this is a one-way operation. Once you eject, you can't go back! If you aren't
    satisfied with the build tool and configuration choices, you can eject at any time. This command will remove the single build
    dependency from your project. Instead, it will copy all the configuration files and the transitive dependencies (webpack, Babel,
    ESLint, etc) right into your project so you have full control over them. All of the commands except eject will still work, but they
    will point to the copied scripts so you can tweak them. At this point you're on your own. You don't have to ever use eject. The
    curated feature set is suitable for small and middle deployments, and you shouldn't feel obligated to use this feature. However we
    understand that this tool wouldn't be useful if you couldn't customize it when you are ready for it. Learn More You can learn more in
    the Create React App documentation. To learn React, check out the React documentation. Code Splitting This section has moved here
    Analyzing the Bundle Size Making a Progressive Web App Advanced Configuration Deployment npm run build fails to minify`,
  flutter: `A new Flutter project. A new Flutter application. Getting Started This project is a starting point for a Flutter application.
    A few resources to get you started if this is your first Flutter project: Lab: Write your first Flutter app Cookbook: Useful Flutter
    samples For help getting started with Flutter development, view the online documentation, which offers tutorials, samples, guidance on
    mobile development, and a full API reference.`,
  "angular-cli": `This project was generated with Angular CLI version. This project was generated using Angular CLI version. Development
    server Run ng serve for a dev server. Navigate to http://localhost:4200/. The application will automatically reload if you change any
    of the source files. Code scaffolding Run ng generate component component-name to generate a new component. You can also use ng
    generate directive|pipe|service|class|guard|interface|enum|module. Build Run ng build to build the project. The build artifacts will be
    stored in the dist/ directory. Running unit tests Run ng test to execute the unit tests via Karma. Running end-to-end tests Run ng e2e
    to execute the end-to-end tests via a platform of your choice. To use this command, you need to first add a package that implements
    end-to-end testing capabilities. Further help To get more help on the Angular CLI use ng help or go check out the Angular CLI Overview
    and Command Reference page. To start a local development server, run: Once the server is running, open your browser and navigate to
    http://localhost:4200/. The application will automatically reload whenever you modify any of the source files. Angular CLI includes
    powerful code scaffolding tools. To generate a new component, run: For a complete list of available schematics (such as components,
    directives, or pipes), run: Building To build the project run: This will compile your project and store the build artifacts in the
    dist/ directory. By default, the production build optimizes your application for performance and speed. To execute unit tests with the
    Karma test runner, use the following command: For end-to-end (e2e) testing, run: Angular CLI does not come with an end-to-end testing
    framework by default. You can choose one that suits your needs. Additional Resources For more information on using the Angular CLI,
    including detailed command references, visit the Angular CLI Overview and Command Reference page.`,
  "create-expo-app": `Welcome to your Expo app This is an Expo project created with create-expo-app. Get started Install dependencies Start
    the app In the output, you'll find options to open the app in a development build Android emulator iOS simulator Expo Go, a limited
    sandbox for trying out app development with Expo You can start developing by editing the files inside the app directory. This project
    uses file-based routing. Get a fresh project When you're ready, run: This command will move the starter code to the app-example
    directory and create a blank app directory where you can start developing. Learn more To learn more about developing your project with
    Expo, look at the following resources: Expo documentation: Learn fundamentals, or go into advanced topics with our guides. Learn Expo
    tutorial: Follow a step-by-step tutorial where you'll create a project that runs on Android, iOS, and the web. Join the community Join
    our community of developers creating universal apps. Expo on GitHub: View our open source platform and contribute. Discord community:
    Chat with Expo users and ask questions.`,
  "create-t3-app": `Create T3 App This is a T3 Stack project bootstrapped with create-t3-app. What's next? How do I make an app with this?
    We try to keep this project as simple as possible, so you can start with just the scaffolding we set up for you, and add additional
    things later when they become necessary. If you are not familiar with the different technologies used in this project, please refer to
    the respective docs. If you still are in the wind, please join our Discord and ask for help. Learn More To learn more about the T3
    Stack, take a look at the following resources: Documentation Learn the T3 Stack Check out these awesome tutorials You can check out the
    create-t3-app GitHub repository your feedback and contributions are welcome! How do I deploy this? Follow our deployment guides for
    Vercel, Netlify and Docker for more information.`,
  sveltekit: `create-svelte sv Everything you need to build a Svelte project, powered by create-svelte. Everything you need to build a
    Svelte project, powered by sv. Creating a project If you're seeing this, you've probably already done this step. Congrats! create a new
    project in the current directory create a new project in my-app Developing Once you've created a project and installed dependencies
    with npm install (or pnpm install or yarn), start a development server: or start the server and open the app in a new browser tab
    Building To create a production version of your app: You can preview the production build with npm run preview. To deploy your app,
    you may need to install an adapter for your target environment.`,
};

const SHINGLE = 4;
/** Words a default README may add to its template: a repository title, a version number. */
const ALLOWED_EXTRA_WORDS = 8;
const ALLOWED_EXTRA_SHARE = 0.05;

function words(text: string): string[] {
  return text
    .replace(/\[([^\]]*)\]\([^)]*\)/g, " $1 ")
    .replace(/https?:\/\/\S+/g, " ")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean);
}

const shingles = (list: string[]) => new Set(list.slice(0, Math.max(0, list.length - SHINGLE + 1)).map((_, i) => list.slice(i, i + SHINGLE).join(" ")));
const TEMPLATE_SHINGLES = Object.entries(TEMPLATES).map(([name, text]) => ({ name, shingles: shingles(words(text)) }));

/** The starter tool whose unchanged README this is, or null for a README with real content. */
export function readmeTemplate(text: string): string | null {
  const list = words(text);
  for (const template of TEMPLATE_SHINGLES) {
    const covered = new Array<boolean>(list.length).fill(false);
    for (let i = 0; i + SHINGLE <= list.length; i++) {
      if (template.shingles.has(list.slice(i, i + SHINGLE).join(" "))) for (let j = i; j < i + SHINGLE; j++) covered[j] = true;
    }
    const matched = covered.filter(Boolean).length, extra = list.length - matched;
    if (matched >= SHINGLE && extra <= Math.max(ALLOWED_EXTRA_WORDS, ALLOWED_EXTRA_SHARE * list.length)) return template.name;
  }
  return null;
}
