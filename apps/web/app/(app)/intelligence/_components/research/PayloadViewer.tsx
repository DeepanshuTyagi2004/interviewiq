"use client";

import dynamic from "next/dynamic";
import { useTheme } from "next-themes";

// Monaco reads browser-only APIs; never render it during SSR / `next build`.
const Editor = dynamic(() => import("@monaco-editor/react"), {
  ssr: false,
  loading: () => <div data-motion className="h-[420px] animate-pulse rounded-md bg-panel" />,
});

/** Read-only Monaco for span payloads: folding, search (⌘F), word wrap. Text is the full value. */
export function PayloadViewer({ value, language = "json", height = 420 }: { value: unknown; language?: "json" | "plaintext"; height?: number }) {
  const { resolvedTheme } = useTheme();
  const text = language === "plaintext" && typeof value === "string" ? value : JSON.stringify(value ?? null, null, 2);
  return (
    <div className="overflow-hidden rounded-md border border-line-2">
      <Editor
        height={height}
        language={language}
        value={text}
        theme={resolvedTheme === "dark" ? "vs-dark" : "light"}
        options={{
          readOnly: true, domReadOnly: true, minimap: { enabled: false }, wordWrap: "on", folding: true,
          scrollBeyondLastLine: false, fontSize: 12, renderLineHighlight: "none", automaticLayout: true,
        }}
      />
    </div>
  );
}
