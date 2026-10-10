import type { NodePreset } from "@/features/loops/presets";
import { MOCK_ROUND_MINUTES } from "@/lib/constants/interview";

/** Render only this node; never snapshot the palette's scrolling/composited DOM. */
export function createNodeDragPreview(node: NodePreset): HTMLElement {
  const title = document.createElement("span");
  title.textContent = node.label;
  const details = document.createElement("span");
  details.textContent = node.kind === "round" ? `${node.type} · ${MOCK_ROUND_MINUTES} min` : "Reference only";
  const canvas = document.createElement("canvas");
  canvas.width = 240;
  canvas.height = 80;
  canvas.append(title, details);
  const context = canvas.getContext("2d");
  let preview: HTMLElement = canvas;
  if (context) {
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, 240, 80);
    context.strokeStyle = "#cbd5e1";
    context.strokeRect(0.5, 0.5, 239, 79);
    context.fillStyle = "#0f172a";
    context.font = "600 13px sans-serif";
    context.fillText(node.label, 12, 28, 216);
    context.fillStyle = "#475569";
    context.font = "11px sans-serif";
    context.fillText(details.textContent, 12, 58, 216);
  } else {
    // Plain standalone card for environments without a canvas renderer.
    preview = document.createElement("div");
    preview.append(title, details);
    Object.assign(preview.style, { background: "#ffffff", color: "#0f172a", border: "1px solid #cbd5e1", padding: "12px", font: "13px sans-serif" });
    Object.assign(title.style, { display: "block", fontWeight: "600", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" });
    Object.assign(details.style, { display: "block", marginTop: "12px", fontSize: "11px", color: "#475569" });
  }
  preview.setAttribute("aria-hidden", "true");
  preview.draggable = false;
  Object.assign(preview.style, { position: "fixed", left: "-10000px", top: "0", width: "240px", height: "80px", boxSizing: "border-box", pointerEvents: "none", userSelect: "none" });
  document.body.append(preview);
  return preview;
}
