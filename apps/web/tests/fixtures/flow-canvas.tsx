import { useState } from "react";
import { createRoot } from "react-dom/client";
import { HudZoomOff } from "../../components/hud/scope";
import { FlowCanvas, PALETTE_MIME } from "../../features/loops/components/FlowCanvas";
import { NodePalette } from "../../app/(app)/processes/_components/NodePalette";
import { newCatalogueNode, newRoundNode, MAX_INFO_NODES, MAX_ROUND_NODES } from "../../features/loops/graph";
import { NODE_PRESETS } from "../../features/loops/presets";
import type { ProcessGraph } from "../../features/loops/types";
import "../../app/globals.css";

const initial: ProcessGraph = {
  nodes: [
    { id: "a", kind: "round", type: "dsa", name: "Alpha", durationMinutes: 60, difficulty: "medium", topics: [], position: { x: 0, y: 0 } },
    { id: "b", kind: "round", type: "dsa", name: "Beta", durationMinutes: 60, difficulty: "medium", topics: [], position: { x: 300, y: 0 } },
  ],
  edges: [{ source: "a", target: "b" }],
};

function Fixture() {
  const [graph, setGraph] = useState(initial);
  const [selected, setSelected] = useState<string | null>(null);
  const [booked, setBooked] = useState("");
  const [drop, setDrop] = useState<unknown>(null);
  const query = new URLSearchParams(location.search);
  const view = query.get("mode") === "view";
  const intrinsic = query.get("layout") === "intrinsic";
  const library = query.has("library");
  const pending = query.has("pending");
  function addCatalogue(id: string, position = { x: 2400, y: 1200 }) {
    if (pending) return;
    const preset = NODE_PRESETS.find((node) => node.id === id);
    if (!preset) return;
    setGraph((graph) => {
      const count = graph.nodes.filter((node) => node.kind === preset.kind).length;
      if (count >= (preset.kind === "round" ? MAX_ROUND_NODES : MAX_INFO_NODES)) return graph;
      return { ...graph, nodes: [...graph.nodes, newCatalogueNode(id, position)] };
    });
  }
  return <main style={{ padding: "60px 70px" }}>
    {!view && <HudZoomOff />}
    <input aria-label="Inspector name" value={graph.nodes.find((n) => n.id === "a")?.name ?? ""}
      onChange={(e) => setGraph((g) => ({ ...g, nodes: g.nodes.map((n) => n.id === "a" ? { ...n, name: e.target.value } : n) }))} />
    <select aria-label="Inspector difficulty"><option>Medium</option></select>
    <textarea aria-label="Inspector instructions" />
    <div role="textbox" aria-label="Inspector contenteditable" contentEditable suppressContentEditableWarning tabIndex={0}>Notes</div>
    <button draggable onDragStart={(e) => { e.dataTransfer.setData(PALETTE_MIME, "round:dsa"); }}>Palette round</button>
    <div style={{ display: "flex", width: intrinsic ? "320px" : library ? "1100px" : "900px", height: intrinsic ? undefined : library ? "540px" : "440px" }}>
      {library && <div style={{ width: "290px", flexShrink: 0, display: "flex" }}><NodePalette onAdd={addCatalogue} disabled={pending}
        roundCount={graph.nodes.filter((node) => node.kind === "round").length} infoCount={graph.nodes.filter((node) => node.kind === "info").length} /></div>}
      <FlowCanvas graph={graph} mode={view ? "view" : "edit"} className="h-full" selectedId={selected}
        onGraphChange={setGraph} onSelect={setSelected} nodeStates={{ a: "available", b: "locked" }}
        onBookNode={setBooked} onDropPreset={(payload, position) => {
          setDrop({ payload, position });
          if (payload.startsWith("catalogue:")) addCatalogue(payload.slice(10), position);
          else if (payload === "round:dsa") setGraph((graph) => ({ ...graph, nodes: [...graph.nodes, newRoundNode("dsa", position)] }));
        }} />
    </div>
    <output data-testid="graph">{JSON.stringify(graph)}</output>
    <output data-testid="booked">{booked}</output>
    <output data-testid="drop">{JSON.stringify(drop)}</output>
  </main>;
}

createRoot(document.getElementById("root")!).render(<Fixture />);
