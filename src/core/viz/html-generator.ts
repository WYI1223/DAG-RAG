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
  language?: string;
  group: string;
  status?: string;
  exports?: string[];
}

interface VizEdge {
  source: string;
  target: string;
  kind: string;
  certainty: string;
  reason?: string;
}

function getGroup(node: GraphNode): string {
  if (node.kind === "adr") return "(adr)";
  if (node.kind === "concept") return "(concept)";
  if (node.kind === "module" && node.language === "external") return "(external)";
  // extract directory from label: "src/api/controllers/Foo.ts" → "src/api/controllers"
  const parts = node.label.split("/");
  return parts.length > 1 ? parts.slice(0, -1).join("/") : "(root)";
}

function prepareGraphData(dag: SemanticDAG): { nodes: VizNode[]; edges: VizEdge[] } {
  const nodes: VizNode[] = Object.values(dag.nodes).map((n) => {
    const base: VizNode = { id: n.id, label: n.label, kind: n.kind, group: getGroup(n) };
    if (n.kind === "adr") base.status = n.status;
    if (n.kind === "module") {
      base.exports = n.exports;
      base.language = n.language;
    }
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
      ...(e.certainty === "inferred" && e.metadata?.reason ? { reason: e.metadata.reason as string } : {}),
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
  #controls hr { border: none; border-top: 1px solid #30363d; margin: 8px 0; }
</style>
</head>
<body>

<div id="legend">
  <h3>adr-graph</h3>
  <div class="legend-item"><div class="legend-dot" style="background:#f78166"></div> ADR</div>
  <div class="legend-item"><div class="legend-dot" style="background:#7ee787"></div> Module</div>
  <div class="legend-item"><div class="legend-dot" style="background:#79c0ff"></div> External package</div>
  <div class="legend-item"><div class="legend-dot" style="background:#d2a8ff"></div> Concept</div>
  <div style="margin-top:8px">
    <div class="legend-item"><div class="legend-line" style="background:#8b949e"></div> depends_on</div>
    <div class="legend-item"><div class="legend-line" style="background:#f78166"></div> implements</div>
    <div class="legend-item"><div class="legend-line" style="background:#d29922; border-top:2px dashed #d29922; height:0"></div> supersedes</div>
    <div class="legend-item"><div class="legend-line" style="background:#d2a8ff"></div> affects / belongs_to</div>
    <div class="legend-item"><div class="legend-line" style="background:#8b949e; border-top:2px dashed #8b949e; height:0"></div> inferred (LLM)</div>
  </div>
  <div style="margin-top:8px; font-size:11px; color:#8b949e">
    Click node to inspect<br>
    Hover edge for details<br>
    <span style="color:#7ee787">→</span> outgoing &nbsp; <span style="color:#ffa657">→</span> incoming
  </div>
</div>

<div id="controls">
  <h3>Filter edges</h3>
  <label><input type="checkbox" data-edge="depends_on" checked> depends_on</label>
  <label><input type="checkbox" data-edge="implements" checked> implements</label>
  <label><input type="checkbox" data-edge="supersedes" checked> supersedes</label>
  <label><input type="checkbox" data-edge="affects" checked> affects</label>
  <label><input type="checkbox" data-edge="belongs_to" checked> belongs_to</label>
  <label><input type="checkbox" data-edge="conflicts" checked> conflicts</label>
  <hr>
  <h3>View mode</h3>
  <label><input type="checkbox" id="dir-layout-mode"> Dir layout</label>
  <label><input type="checkbox" id="dir-label-mode"> Dir labels</label>
  <label><input type="checkbox" id="hide-externals"> Hide externals</label>
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

function getNodeColor(d) { return d.language === "external" ? "#79c0ff" : ({ adr: "#f78166", module: "#7ee787", concept: "#d2a8ff" }[d.kind] || "#8b949e"); }
function getNodeRadius(d) { return d.language === "external" ? 6 : ({ adr: 10, module: 7, concept: 8 }[d.kind] || 7); }
const edgeColor = { depends_on: "#8b949e", implements: "#f78166", supersedes: "#d29922", conflicts: "#f85149", affects: "#d2a8ff", belongs_to: "#d2a8ff" };

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

// group clustering
const groups = [...new Set(data.nodes.map(d => d.group))];
const groupColor = {};
const palette = ["#1f6feb33","#23863633","#8957e533","#f7816633","#d2992233","#f8514933","#79c0ff33","#3fb95033","#bc8cff33","#ffa65733"];
groups.forEach((g, i) => groupColor[g] = palette[i % palette.length]);

// clustering force: nudge nodes toward group centroid (skip externals)
function clusterForce(alpha) {
  const centroids = {};
  const counts = {};
  data.nodes.forEach(d => {
    if (d.language === "external") return;
    if (!centroids[d.group]) { centroids[d.group] = {x:0,y:0}; counts[d.group] = 0; }
    centroids[d.group].x += d.x || 0;
    centroids[d.group].y += d.y || 0;
    counts[d.group]++;
  });
  for (const g in centroids) { centroids[g].x /= counts[g]; centroids[g].y /= counts[g]; }
  const strength = alpha * 0.3;
  data.nodes.forEach(d => {
    if (d.language === "external") return;
    const c = centroids[d.group];
    if (!c) return;
    d.vx += (c.x - d.x) * strength;
    d.vy += (c.y - d.y) * strength;
  });
}

// directory treemap layout: nested rectangles based on directory hierarchy
let dirLayoutActive = false;
let dirLayoutPositions = {};
let cellBounds = {};

function computeDirLayout() {
  cellBounds = {};
  // build trie from directory groups (skip externals)
  const gm = {};
  data.nodes.forEach(d => {
    if (d.language === "external") return;
    if (!gm[d.group]) gm[d.group] = [];
    gm[d.group].push(d);
  });
  const trie = {};
  for (const gp of Object.keys(gm)) {
    const parts = gp.startsWith("(") ? [gp] : gp.split("/");
    let cur = trie;
    for (const p of parts) { if (!cur[p]) cur[p] = {}; cur = cur[p]; }
    cur._n = gm[gp];
  }
  function toH(t, nm, pp) {
    const fp = pp ? pp + "/" + nm : nm;
    const ks = Object.keys(t).filter(k => k !== "_n");
    const ns = t._n || [];
    if (!ks.length) return { name: nm, value: Math.max(ns.length, 1), _nodes: ns, _gp: fp };
    const ch = ks.map(k => toH(t[k], k, fp));
    if (ns.length) ch.push({ name: "·", value: ns.length, _nodes: ns, _gp: fp });
    return { name: nm, children: ch, _gp: fp };
  }
  const tks = Object.keys(trie);
  if (!tks.length) return {};
  const hierData = tks.length === 1
    ? toH(trie[tks[0]], tks[0], "")
    : { name: "project", children: tks.map(k => toH(trie[k], k, "")) };

  const pad = 50;
  const hasExt = data.nodes.some(d => d.language === "external");
  const extH = hasExt ? 60 : 0;
  const root = d3.hierarchy(hierData).sum(d => d.value || 0).sort((a, b) => b.value - a.value);
  d3.treemap().size([width - pad * 2, height - pad * 2 - extH]).padding(3).paddingTop(22).round(true)(root);
  const ox = pad, oy = pad;

  // draw treemap cells
  treemapG.selectAll("*").remove();
  treemapG.style("display", null);
  root.descendants().forEach(nd => {
    const x = nd.x0 + ox, y = nd.y0 + oy, w = nd.x1 - nd.x0, h = nd.y1 - nd.y0;
    if (w < 2 || h < 2) return;
    const leaf = !nd.children;
    const gc = nd.data._gp ? groupColor[nd.data._gp] : null;
    treemapG.append("rect")
      .attr("x", x).attr("y", y).attr("width", w).attr("height", h)
      .attr("fill", leaf ? (gc || "#ffffff22") : "#ffffff06")
      .attr("stroke", leaf ? (gc || "#ffffff22").replace("33","66") : "#30363d")
      .attr("stroke-width", leaf ? 0.5 : (nd.depth === 0 ? 1.5 : 1))
      .attr("rx", nd.depth === 0 ? 6 : 4);
    if (w > 30 && h > 16) {
      treemapG.append("text")
        .attr("x", x + 5).attr("y", y + 15)
        .attr("fill", leaf ? "#8b949e" : "#e6edf3")
        .attr("font-size", leaf ? "9px" : "11px")
        .attr("font-weight", leaf ? "normal" : "bold")
        .text(nd.data.name);
    }
  });

  // position graph nodes within leaf cells
  const pos = {};
  root.leaves().forEach(lf => {
    const nds = lf.data._nodes || [];
    const x = lf.x0 + ox, y = lf.y0 + oy + 20, w = lf.x1 - lf.x0, h = lf.y1 - lf.y0 - 20;
    if (w < 1 || h < 1 || !nds.length) return;
    const nc = Math.max(1, Math.ceil(Math.sqrt(nds.length)));
    const nr = Math.ceil(nds.length / nc);
    const sx = w / (nc + 1), sy = h / (nr + 1);
    nds.forEach((nd, i) => {
      pos[nd.id] = { x: x + (i % nc + 1) * sx, y: y + (Math.floor(i / nc) + 1) * sy };
      cellBounds[nd.id] = { x0: x, y0: y, x1: x + w, y1: y + h };
    });
  });

  // externals: bottom strip
  const exts = data.nodes.filter(d => d.language === "external");
  if (exts.length) {
    const ey = height - pad + 5, uw = width - pad * 2;
    const es = Math.min(uw / (exts.length + 1), 45);
    const sx = (width - es * (exts.length - 1)) / 2;
    treemapG.append("rect")
      .attr("x", ox).attr("y", ey - 20).attr("width", uw).attr("height", 38)
      .attr("fill", "#79c0ff11").attr("stroke", "#79c0ff33").attr("rx", 4);
    treemapG.append("text")
      .attr("x", ox + 5).attr("y", ey - 6)
      .attr("fill", "#79c0ff").attr("font-size", "10px").text("(external)");
    exts.forEach((d, i) => {
      pos[d.id] = { x: sx + i * es, y: ey };
      cellBounds[d.id] = { x0: ox, y0: ey - 15, x1: ox + uw, y1: ey + 15 };
    });
  }

  return pos;
}

// simulation
const simulation = d3.forceSimulation(data.nodes)
  .force("link", d3.forceLink(data.edges).id(d => d.id).distance(80))
  .force("charge", d3.forceManyBody().strength(-200))
  .force("center", d3.forceCenter(width / 2, height / 2))
  .force("collision", d3.forceCollide().radius(15))
  .force("cluster", clusterForce);

// adjacency index (directed)
const outEdges = {}, inEdges = {};
data.nodes.forEach(d => { outEdges[d.id] = new Set(); inEdges[d.id] = new Set(); });
data.edges.forEach(e => {
  outEdges[e.source.id].add(e.target.id);
  inEdges[e.target.id].add(e.source.id);
});

// cell containment force for treemap mode
function cellContainForce(alpha) {
  data.nodes.forEach(d => {
    if (d.fx != null) return;
    const b = cellBounds[d.id];
    if (!b) return;
    const cx = (b.x0 + b.x1) / 2, cy = (b.y0 + b.y1) / 2;
    d.vx += (cx - d.x) * alpha * 0.12;
    d.vy += (cy - d.y) * alpha * 0.12;
  });
}

let selectedNode = null;
let wasDragged = false;

// directional arrow markers for inspection
defs.append("marker").attr("id","arrow-out").attr("viewBox","0 -5 10 10")
  .attr("refX",20).attr("refY",0).attr("markerWidth",6).attr("markerHeight",6).attr("orient","auto")
  .append("path").attr("d","M0,-5L10,0L0,5").attr("fill","#7ee787");
defs.append("marker").attr("id","arrow-in").attr("viewBox","0 -5 10 10")
  .attr("refX",20).attr("refY",0).attr("markerWidth",6).attr("markerHeight",6).attr("orient","auto")
  .append("path").attr("d","M0,-5L10,0L0,5").attr("fill","#ffa657");

// treemap layer (behind everything, hidden by default)
const treemapG = g.append("g").attr("class", "treemap").style("display", "none");

// group hulls layer (drawn behind edges and nodes)
const hullG = g.append("g").attr("class", "hulls");

function updateHulls() {
  const grouped = {};
  data.nodes.forEach(d => {
    if (d.group === "(external)") return;
    if (!grouped[d.group]) grouped[d.group] = [];
    grouped[d.group].push([d.x, d.y]);
  });
  const hullData = [];
  for (const [name, points] of Object.entries(grouped)) {
    if (points.length < 3) continue;
    const hull = d3.polygonHull(points);
    if (hull) hullData.push({ name, hull });
  }
  const hulls = hullG.selectAll("path").data(hullData, d => d.name);
  hulls.enter().append("path")
    .attr("fill", d => groupColor[d.name] || "#ffffff11")
    .attr("stroke", d => (groupColor[d.name] || "#ffffff11").replace("33","66"))
    .attr("stroke-width", 1)
    .merge(hulls)
    .attr("d", d => "M" + d.hull.map(p => p.join(",")).join("L") + "Z");
  hulls.exit().remove();

  // group labels
  const dirMode = document.getElementById("dir-label-mode").checked;
  const labelData = Object.entries(grouped).map(([name, pts]) => {
    const cx = pts.reduce((s,p) => s+p[0], 0) / pts.length;
    const cy = pts.reduce((s,p) => s+p[1], 0) / pts.length;
    return { name, cx, cy, count: pts.length };
  });
  const labels = hullG.selectAll("text").data(labelData, d => d.name);
  labels.enter().append("text")
    .attr("text-anchor", "middle")
    .merge(labels)
    .attr("fill", dirMode ? "#f0f6fc" : "#8b949e")
    .attr("font-size", dirMode ? "14px" : "10px")
    .attr("font-weight", dirMode ? "bold" : "normal")
    .attr("x", d => d.cx).attr("y", d => d.cy - (dirMode ? 16 : 12))
    .text(d => dirMode ? d.name + " (" + d.count + ")" : d.name);
  labels.exit().remove();
}

// edges
const linkG = g.append("g");
// invisible wider hit-area lines for easier hover targeting
const linkHit = linkG.selectAll("line.hit").data(data.edges).join("line")
  .attr("class", "hit")
  .attr("stroke", "transparent")
  .attr("stroke-width", 12);
let link = linkG.selectAll("line.visible").data(data.edges).join("line")
  .attr("class", "visible")
  .attr("stroke", d => edgeColor[d.kind] || "#8b949e")
  .attr("stroke-width", d => d.kind === "depends_on" ? 1 : 2)
  .attr("stroke-dasharray", d => d.certainty === "inferred" ? "5,3" : d.kind === "supersedes" ? "8,4" : null)
  .attr("marker-end", d => "url(#arrow-" + d.kind + ")")
  .attr("stroke-opacity", 0.6);

// nodes
const node = g.append("g").selectAll("g").data(data.nodes).join("g")
  .call(d3.drag()
    .on("start", (e, d) => { wasDragged = false; if (!e.active) simulation.alphaTarget(0.3).restart(); d.fx = d.x; d.fy = d.y; })
    .on("drag", (e, d) => {
      wasDragged = true;
      if (dirLayoutActive) {
        const b = cellBounds[d.id];
        if (b) { d.fx = Math.max(b.x0+10,Math.min(b.x1-10,e.x)); d.fy = Math.max(b.y0+10,Math.min(b.y1-10,e.y)); }
        else { d.fx = e.x; d.fy = e.y; }
      } else { d.fx = e.x; d.fy = e.y; }
    })
    .on("end", (e, d) => {
      if (!e.active) simulation.alphaTarget(0);
      if (!dirLayoutActive) { d.fx = null; d.fy = null; }
      // treemap mode: keep fx/fy → node pinned at dragged position
    })
  );

node.append("circle")
  .attr("r", d => getNodeRadius(d))
  .attr("fill", d => getNodeColor(d))
  .attr("stroke", "#0d1117").attr("stroke-width", 1.5);

node.append("text")
  .attr("class", "node-label")
  .text(d => d.kind === "adr" ? d.id : d.label.split("/").pop())
  .attr("dx", 14).attr("dy", 4)
  .attr("fill", "#c9d1d9").attr("font-size", "11px");

// tooltip
const tooltip = document.getElementById("tooltip");
node.on("mouseenter", (e, d) => {
  document.getElementById("tip-label").textContent = d.label;
  document.getElementById("tip-kind").textContent = d.kind + (d.status ? " [" + d.status + "]" : "") + " — " + d.group;
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

// edge tooltip (hover on hit-area lines to show kind, certainty, reason)
linkHit.style("cursor", "pointer")
  .on("mouseenter", (e, d) => {
    const srcLabel = d.source.label || d.source;
    const tgtLabel = d.target.label || d.target;
    document.getElementById("tip-label").textContent = srcLabel + " → " + tgtLabel;
    const certLabel = d.certainty === "inferred" ? "inferred (LLM)" : d.certainty;
    document.getElementById("tip-kind").textContent = d.kind + " — " + certLabel;
    document.getElementById("tip-detail").textContent = d.reason || "";
    tooltip.style.display = "block";
    tooltip.style.left = (e.clientX + 16) + "px";
    tooltip.style.top = (e.clientY + 16) + "px";
    // highlight the matching visible line
    const idx = data.edges.indexOf(d);
    link.filter((_, i) => i === idx).attr("stroke-width", 4).attr("stroke-opacity", 1);
  })
  .on("mousemove", (e) => {
    tooltip.style.left = (e.clientX + 16) + "px";
    tooltip.style.top = (e.clientY + 16) + "px";
  })
  .on("mouseleave", (e, d) => {
    tooltip.style.display = "none";
    const idx = data.edges.indexOf(d);
    link.filter((_, i) => i === idx)
      .attr("stroke-width", d.kind === "depends_on" ? 1 : 2)
      .attr("stroke-opacity", 0.6);
  });

// sync hit-area visibility with visible edges
function syncHitVisibility() {
  link.each(function(d, i) {
    linkHit.filter((_, j) => j === i).attr("display", d3.select(this).attr("display"));
  });
}

// click to inspect connections
function clearSelection() {
  selectedNode = null;
  link.attr("stroke", d => edgeColor[d.kind] || "#8b949e")
      .attr("stroke-width", d => d.kind === "depends_on" ? 1 : 2)
      .attr("stroke-opacity", 0.6)
      .attr("marker-end", d => "url(#arrow-" + d.kind + ")");
  node.attr("opacity", 1);
  if (dirLayoutActive) {
    link.attr("display", "none");
  } else {
    const visible = new Set();
    document.querySelectorAll("#controls input[data-edge]:checked").forEach(c => visible.add(c.dataset.edge));
    link.attr("display", d => visible.has(d.kind) ? null : "none");
  }
  syncHitVisibility();
}

node.on("click", (e, d) => {
  if (wasDragged) return;
  e.stopPropagation();
  if (selectedNode === d.id) { clearSelection(); return; }
  selectedNode = d.id;
  const myOut = outEdges[d.id] || new Set();
  const myIn = inEdges[d.id] || new Set();
  const connected = new Set([...myOut, ...myIn]);
  link
    .attr("display", l => (l.source.id === d.id || l.target.id === d.id) ? null : "none")
    .attr("stroke", l => l.source.id === d.id ? "#7ee787" : l.target.id === d.id ? "#ffa657" : edgeColor[l.kind])
    .attr("stroke-width", 2.5)
    .attr("stroke-opacity", 0.9)
    .attr("marker-end", l => l.source.id === d.id ? "url(#arrow-out)" : l.target.id === d.id ? "url(#arrow-in)" : "url(#arrow-" + l.kind + ")");
  node.attr("opacity", n => (n.id === d.id || connected.has(n.id)) ? 1 : 0.15);
  syncHitVisibility();
});

node.on("dblclick", (e, d) => {
  if (dirLayoutActive) {
    const p = dirLayoutPositions[d.id];
    if (p) { d.fx = p.x; d.fy = p.y; simulation.alpha(0.1).restart(); }
  }
});

svg.on("click", () => { if (selectedNode) clearSelection(); });

// tick
simulation.on("tick", () => {
  // clamp free nodes to cell bounds in treemap mode
  if (dirLayoutActive) {
    data.nodes.forEach(d => {
      if (d.fx != null) return;
      const b = cellBounds[d.id];
      if (!b) return;
      d.x = Math.max(b.x0 + 10, Math.min(b.x1 - 10, d.x));
      d.y = Math.max(b.y0 + 10, Math.min(b.y1 - 10, d.y));
    });
  }
  link.attr("x1", d => d.source.x).attr("y1", d => d.source.y)
      .attr("x2", d => d.target.x).attr("y2", d => d.target.y);
  linkHit.attr("x1", d => d.source.x).attr("y1", d => d.source.y)
      .attr("x2", d => d.target.x).attr("y2", d => d.target.y);
  node.attr("transform", d => "translate(" + d.x + "," + d.y + ")");
  if (!dirLayoutActive) updateHulls();
});

// edge filter controls
document.querySelectorAll("#controls input[data-edge]").forEach(cb => {
  cb.addEventListener("change", () => {
    const visible = new Set();
    document.querySelectorAll("#controls input[data-edge]:checked").forEach(c => visible.add(c.dataset.edge));
    link.attr("display", d => visible.has(d.kind) ? null : "none");
    syncHitVisibility();
  });
});

// directory layout mode toggle
document.getElementById("dir-layout-mode").addEventListener("change", (e) => {
  dirLayoutActive = e.target.checked;
  if (selectedNode) clearSelection();
  if (dirLayoutActive) {
    dirLayoutPositions = computeDirLayout();
    hullG.style("display", "none");
    link.attr("display", "none");
    syncHitVisibility();
    // pin all nodes at uniform grid positions
    data.nodes.forEach(d => {
      const p = dirLayoutPositions[d.id];
      if (p) { d.fx = p.x; d.fy = p.y; }
    });
    simulation.alpha(0.3).restart();
  } else {
    treemapG.style("display", "none");
    treemapG.selectAll("*").remove();
    hullG.style("display", null);
    cellBounds = {};
    data.nodes.forEach(d => { d.fx = null; d.fy = null; });
    // restore edges per filter
    const visible = new Set();
    document.querySelectorAll("#controls input[data-edge]:checked").forEach(c => visible.add(c.dataset.edge));
    link.attr("display", d => visible.has(d.kind) ? null : "none");
    syncHitVisibility();
    node.attr("opacity", 1);
    simulation.alpha(1).restart();
  }
});

// directory label mode toggle
document.getElementById("dir-label-mode").addEventListener("change", (e) => {
  const on = e.target.checked;
  // hide/show per-node labels
  g.selectAll(".node-label").attr("display", on ? "none" : null);
  // shrink node circles in dir mode for cleaner look
  node.selectAll("circle").transition().duration(300)
    .attr("r", d => on ? (d.language === "external" ? 3 : 4) : getNodeRadius(d));
  // force hull label refresh
  updateHulls();
});

// hide externals toggle
document.getElementById("hide-externals").addEventListener("change", (e) => {
  const hide = e.target.checked;
  const extIds = new Set(data.nodes.filter(d => d.language === "external").map(d => d.id));
  node.attr("display", d => (hide && extIds.has(d.id)) ? "none" : null);
  link.attr("display", d => {
    if (hide && (extIds.has(d.source.id || d.source) || extIds.has(d.target.id || d.target))) return "none";
    const visible = new Set();
    document.querySelectorAll("#controls input[data-edge]:checked").forEach(c => visible.add(c.dataset.edge));
    return visible.has(d.kind) ? null : "none";
  });
  syncHitVisibility();
});
</script>
</body>
</html>`;
}
