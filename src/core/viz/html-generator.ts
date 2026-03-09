/**
 * core/viz/html-generator.ts
 *
 * Generates a self-contained HTML file with an interactive DAG visualization.
 * Uses D3.js force-directed graph via CDN — no build step, no extra dependencies.
 */

import { SemanticDAG, GraphNode, GraphEdge } from "../../types/graph.js";

interface VizNode {
  id: string;
  label: string;
  kind: string;
  status?: string;
  exports?: string[];
}

interface VizEdge {
  source: string;
  target: string;
  kind: string;
  certainty: string;
}

function prepareGraphData(dag: SemanticDAG): { nodes: VizNode[]; edges: VizEdge[] } {
  const nodes: VizNode[] = Object.values(dag.nodes).map((n) => {
    const base: VizNode = { id: n.id, label: n.label, kind: n.kind };
    if (n.kind === "adr") base.status = n.status;
    if (n.kind === "module") base.exports = n.exports;
    return base;
  });

  const nodeIds = new Set(nodes.map((n) => n.id));

  const edges: VizEdge[] = Object.values(dag.edges)
    .filter((e) => nodeIds.has(e.from) && nodeIds.has(e.to))
    .map((e) => ({
      source: e.from,
      target: e.to,
      kind: e.kind,
      certainty: e.certainty,
    }));

  return { nodes, edges };
}

export function generateHTML(dag: SemanticDAG): string {
  const data = prepareGraphData(dag);
  const jsonData = JSON.stringify(data);

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>adr-graph — Semantic DAG</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #0d1117; color: #c9d1d9; overflow: hidden; }
  #graph { width: 100vw; height: 100vh; }

  /* Legend */
  #legend { position: fixed; top: 16px; left: 16px; background: #161b22; border: 1px solid #30363d; border-radius: 8px; padding: 12px 16px; font-size: 13px; z-index: 10; }
  #legend h3 { font-size: 14px; margin-bottom: 8px; color: #f0f6fc; }
  .legend-item { display: flex; align-items: center; gap: 8px; margin: 4px 0; }
  .legend-dot { width: 12px; height: 12px; border-radius: 50%; }
  .legend-line { width: 24px; height: 2px; }

  /* Tooltip */
  #tooltip { position: fixed; display: none; background: #161b22; border: 1px solid #30363d; border-radius: 8px; padding: 12px; font-size: 13px; max-width: 320px; z-index: 20; pointer-events: none; }
  #tooltip h4 { color: #f0f6fc; margin-bottom: 4px; }
  #tooltip .kind { color: #8b949e; font-size: 12px; margin-bottom: 6px; }
  #tooltip .detail { color: #c9d1d9; font-size: 12px; }

  /* Controls */
  #controls { position: fixed; top: 16px; right: 16px; background: #161b22; border: 1px solid #30363d; border-radius: 8px; padding: 12px 16px; font-size: 13px; z-index: 10; }
  #controls label { display: block; margin: 4px 0; cursor: pointer; }
  #controls h3 { font-size: 14px; margin-bottom: 8px; color: #f0f6fc; }
</style>
</head>
<body>

<div id="legend">
  <h3>adr-graph</h3>
  <div class="legend-item"><div class="legend-dot" style="background:#f78166"></div> ADR</div>
  <div class="legend-item"><div class="legend-dot" style="background:#7ee787"></div> Module</div>
  <div class="legend-item"><div class="legend-dot" style="background:#d2a8ff"></div> Concept</div>
  <div style="margin-top:8px">
    <div class="legend-item"><div class="legend-line" style="background:#8b949e"></div> depends_on</div>
    <div class="legend-item"><div class="legend-line" style="background:#f78166"></div> implements</div>
    <div class="legend-item"><div class="legend-line" style="background:#d29922; border-top:2px dashed #d29922; height:0"></div> supersedes</div>
  </div>
</div>

<div id="controls">
  <h3>Filter edges</h3>
  <label><input type="checkbox" data-edge="depends_on" checked> depends_on</label>
  <label><input type="checkbox" data-edge="implements" checked> implements</label>
  <label><input type="checkbox" data-edge="supersedes" checked> supersedes</label>
  <label><input type="checkbox" data-edge="conflicts" checked> conflicts</label>
</div>

<div id="tooltip">
  <h4 id="tip-label"></h4>
  <div class="kind" id="tip-kind"></div>
  <div class="detail" id="tip-detail"></div>
</div>

<svg id="graph"></svg>

<script src="https://d3js.org/d3.v7.min.js"></script>
<script>
const data = ${jsonData};

const nodeColor = { adr: "#f78166", module: "#7ee787", concept: "#d2a8ff" };
const edgeColor = { depends_on: "#8b949e", implements: "#f78166", supersedes: "#d29922", conflicts: "#f85149", affects: "#d2a8ff", belongs_to: "#d2a8ff" };
const nodeRadius = { adr: 10, module: 7, concept: 8 };

const width = window.innerWidth;
const height = window.innerHeight;

const svg = d3.select("#graph").attr("width", width).attr("height", height);
const g = svg.append("g");

// zoom
svg.call(d3.zoom().scaleExtent([0.1, 4]).on("zoom", (e) => g.attr("transform", e.transform)));

// arrow markers
const defs = svg.append("defs");
for (const [kind, color] of Object.entries(edgeColor)) {
  defs.append("marker")
    .attr("id", "arrow-" + kind)
    .attr("viewBox", "0 -5 10 10")
    .attr("refX", 20).attr("refY", 0)
    .attr("markerWidth", 6).attr("markerHeight", 6)
    .attr("orient", "auto")
    .append("path").attr("d", "M0,-5L10,0L0,5").attr("fill", color);
}

// simulation
const simulation = d3.forceSimulation(data.nodes)
  .force("link", d3.forceLink(data.edges).id(d => d.id).distance(100))
  .force("charge", d3.forceManyBody().strength(-300))
  .force("center", d3.forceCenter(width / 2, height / 2))
  .force("collision", d3.forceCollide().radius(20));

// edges
const linkG = g.append("g");
let link = linkG.selectAll("line").data(data.edges).join("line")
  .attr("stroke", d => edgeColor[d.kind] || "#8b949e")
  .attr("stroke-width", d => d.kind === "depends_on" ? 1 : 2)
  .attr("stroke-dasharray", d => d.certainty === "inferred" ? "5,3" : d.kind === "supersedes" ? "8,4" : null)
  .attr("marker-end", d => "url(#arrow-" + d.kind + ")")
  .attr("stroke-opacity", 0.6);

// nodes
const node = g.append("g").selectAll("g").data(data.nodes).join("g")
  .call(d3.drag()
    .on("start", (e, d) => { if (!e.active) simulation.alphaTarget(0.3).restart(); d.fx = d.x; d.fy = d.y; })
    .on("drag", (e, d) => { d.fx = e.x; d.fy = e.y; })
    .on("end", (e, d) => { if (!e.active) simulation.alphaTarget(0); d.fx = null; d.fy = null; })
  );

node.append("circle")
  .attr("r", d => nodeRadius[d.kind] || 7)
  .attr("fill", d => nodeColor[d.kind] || "#8b949e")
  .attr("stroke", "#0d1117").attr("stroke-width", 1.5);

node.append("text")
  .text(d => d.kind === "adr" ? d.id : d.label.split("/").pop())
  .attr("dx", 14).attr("dy", 4)
  .attr("fill", "#c9d1d9").attr("font-size", "11px");

// tooltip
const tooltip = document.getElementById("tooltip");
node.on("mouseenter", (e, d) => {
  document.getElementById("tip-label").textContent = d.label;
  document.getElementById("tip-kind").textContent = d.kind + (d.status ? " [" + d.status + "]" : "");
  let detail = "";
  if (d.exports && d.exports.length) detail = "Exports: " + d.exports.join(", ");
  document.getElementById("tip-detail").textContent = detail;
  tooltip.style.display = "block";
  tooltip.style.left = (e.clientX + 16) + "px";
  tooltip.style.top = (e.clientY + 16) + "px";
}).on("mousemove", (e) => {
  tooltip.style.left = (e.clientX + 16) + "px";
  tooltip.style.top = (e.clientY + 16) + "px";
}).on("mouseleave", () => {
  tooltip.style.display = "none";
});

// tick
simulation.on("tick", () => {
  link.attr("x1", d => d.source.x).attr("y1", d => d.source.y)
      .attr("x2", d => d.target.x).attr("y2", d => d.target.y);
  node.attr("transform", d => "translate(" + d.x + "," + d.y + ")");
});

// edge filter controls
document.querySelectorAll("#controls input[data-edge]").forEach(cb => {
  cb.addEventListener("change", () => {
    const visible = new Set();
    document.querySelectorAll("#controls input[data-edge]:checked").forEach(c => visible.add(c.dataset.edge));
    link.attr("display", d => visible.has(d.kind) ? null : "none");
  });
});
</script>
</body>
</html>`;
}
