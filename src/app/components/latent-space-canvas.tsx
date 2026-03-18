import { useRef, useEffect, useState, useCallback, useMemo } from "react";
import { generateLatentSpace3D, type Node3D, type Edge3D, type NodeFormatting } from "./latent-space-data";

// ── 3D Math ──
interface Vec3 { x: number; y: number; z: number }

function rotateY(p: Vec3, a: number): Vec3 {
  const c = Math.cos(a), s = Math.sin(a);
  return { x: p.x * c + p.z * s, y: p.y, z: -p.x * s + p.z * c };
}
function rotateX(p: Vec3, a: number): Vec3 {
  const c = Math.cos(a), s = Math.sin(a);
  return { x: p.x, y: p.y * c - p.z * s, z: p.y * s + p.z * c };
}
function project(p: Vec3, w: number, h: number, fov: number, camZ: number, zoom = 1, pan = { x: 0, y: 0 }) {
  const zp = { x: p.x * zoom, y: p.y * zoom, z: p.z * zoom };
  const z = zp.z + camZ;
  const scale = fov / (fov + z);
  return { sx: zp.x * scale + w / 2 + pan.x, sy: zp.y * scale + h / 2 + pan.y, scale: Math.max(0.05, scale * zoom), depth: z };
}
function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  return [parseInt(h.substring(0, 2), 16), parseInt(h.substring(2, 4), 16), parseInt(h.substring(4, 6), 16)];
}

// ── Component ──
interface HoveredInfo { node: Node3D; sx: number; sy: number }

// Zoom: multiplier 1x..500x. Stored as the multiplier value directly.
const ZOOM_MIN = 1;
const ZOOM_MAX = 500;
const PERSPECTIVE_FOV = 750; // Fixed perspective field-of-view
const BASE_CAM_Z = 600;     // Camera distance at 1x zoom

function zoomToSlider(z: number): number {
  return Math.log(z / ZOOM_MIN) / Math.log(ZOOM_MAX / ZOOM_MIN);
}
function sliderToZoom(s: number): number {
  return ZOOM_MIN * Math.pow(ZOOM_MAX / ZOOM_MIN, s);
}

export function LatentSpaceCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef(0);
  const timeRef = useRef(0);

  const rotYRef = useRef(0.3);
  const rotXRef = useRef(0.15);
  const targetRotYRef = useRef(0.3);
  const targetRotXRef = useRef(0.15);
  const isDragging = useRef(false);
  const lastMouse = useRef({ x: 0, y: 0 });
  const autoRotate = useRef(true);
  const autoTimer = useRef<ReturnType<typeof setTimeout>>();

  const zoomRef = useRef(1);
  const targetZoomRef = useRef(1);

  // Pan offset (screen pixels)
  const panRef = useRef({ x: 0, y: 0 });
  const targetPanRef = useRef({ x: 0, y: 0 });
  const isPanning = useRef(false);

  // Node dragging (rearrange)
  const draggingNodeRef = useRef<string | null>(null);
  const didDragNode = useRef(false);

  const [hovered, setHovered] = useState<HoveredInfo | null>(null);
  const selectedClusterRef = useRef<string | null>(null);
  const [selectedCluster, setSelectedCluster] = useState<string | null>(null);

  // Edit/Add state
  const [editingNode, setEditingNode] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  const [showAddForm, setShowAddForm] = useState(false);
  const [newNodeLabel, setNewNodeLabel] = useState("");
  const [newNodeCluster, setNewNodeCluster] = useState("HumanLearning");

  // Interaction mode: null = normal, "picture" = click node to attach picture, "comment" = click node to add comment, "connect" = click two nodes to create edge
  const [interactionMode, setInteractionMode] = useState<"picture" | "comment" | "connect" | null>(null);
  const [connectSource, setConnectSource] = useState<string | null>(null);

  // Drag-to-connect state
  const dragConnectRef = useRef<{ sourceId: string; sx: number; sy: number } | null>(null);
  const dragConnectMouseRef = useRef<{ x: number; y: number } | null>(null);

  // Node pictures & comments — initialized from localStorage
  const [nodeImages, setNodeImages] = useState<Record<string, string>>(() => {
    try { const s = localStorage.getItem("latentSpace_images"); return s ? JSON.parse(s) : {}; }
    catch { return {}; }
  });
  const [nodeComments, setNodeComments] = useState<Record<string, string[]>>(() => {
    try { const s = localStorage.getItem("latentSpace_comments"); return s ? JSON.parse(s) : {}; }
    catch { return {}; }
  });

  // Picture/Comment dialog state
  const [pictureTarget, setPictureTarget] = useState<string | null>(null);
  const [pictureFullscreen, setPictureFullscreen] = useState(false);
  const [commentTarget, setCommentTarget] = useState<string | null>(null);
  const [commentFullscreen, setCommentFullscreen] = useState(false);
  const [commentText, setCommentText] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const loadFileInputRef = useRef<HTMLInputElement>(null);

  // Text formatting state (for edit modal)
  const [editFormatting, setEditFormatting] = useState<NodeFormatting>({});

  // Connection management popup (right-click on node in connect mode)
  const [connectionPopup, setConnectionPopup] = useState<{ nodeId: string; x: number; y: number } | null>(null);

  // Zoom display (synced from render loop)
  const [zoomMultiplier, setZoomMultiplier] = useState(1);
  const zoomDisplayFrameRef = useRef(0);

  // Mutable data
  const dataRef = useRef(generateLatentSpace3D());
  const data = dataRef.current;

  // Helper: add an edge between two nodes (no duplicates)
  const addEdge = useCallback((fromId: string, toId: string) => {
    const d = dataRef.current;
    const exists = d.edges.some(e =>
      (e.from === fromId && e.to === toId) || (e.from === toId && e.to === fromId)
    );
    if (exists) return;
    const fromNode = d.nodes.find(n => n.id === fromId);
    const toNode = d.nodes.find(n => n.id === toId);
    if (!fromNode || !toNode) return;
    const isCross = fromNode.cluster !== toNode.cluster;
    d.edges.push({ from: fromId, to: toId, strength: 0.6, isCross });
    if (!fromNode.connections.includes(toId)) fromNode.connections.push(toId);
    if (!toNode.connections.includes(fromId)) toNode.connections.push(fromId);
  }, []);

  // Helper: remove an edge between two nodes
  const removeEdge = useCallback((fromId: string, toId: string) => {
    const d = dataRef.current;
    d.edges = d.edges.filter(e =>
      !((e.from === fromId && e.to === toId) || (e.from === toId && e.to === fromId))
    );
    const fromNode = d.nodes.find(n => n.id === fromId);
    const toNode = d.nodes.find(n => n.id === toId);
    if (fromNode) fromNode.connections = fromNode.connections.filter(c => c !== toId);
    if (toNode) toNode.connections = toNode.connections.filter(c => c !== fromId);
  }, []);

  // Load node formatting from localStorage on mount
  useEffect(() => {
    try {
      const s = localStorage.getItem("latentSpace_formatting");
      if (s) {
        const fmtMap: Record<string, NodeFormatting> = JSON.parse(s);
        for (const node of data.nodes) {
          if (fmtMap[node.id]) node.formatting = fmtMap[node.id];
        }
      }
    } catch { /* ignore */ }
  }, [data.nodes]);

  // Keep refs in sync for render loop access
  const nodeImagesRef = useRef(nodeImages);
  nodeImagesRef.current = nodeImages;
  const nodeCommentsRef = useRef(nodeComments);
  nodeCommentsRef.current = nodeComments;

  // Auto-save to localStorage when data changes
  useEffect(() => {
    try { localStorage.setItem("latentSpace_images", JSON.stringify(nodeImages)); }
    catch { /* quota exceeded — ignore */ }
  }, [nodeImages]);

  useEffect(() => {
    try { localStorage.setItem("latentSpace_comments", JSON.stringify(nodeComments)); }
    catch { /* ignore */ }
  }, [nodeComments]);

  useEffect(() => { selectedClusterRef.current = selectedCluster; }, [selectedCluster]);

  // ── Escape key to cancel interaction mode ──
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setInteractionMode(null);
        setConnectSource(null);
        dragConnectRef.current = null;
        dragConnectMouseRef.current = null;
        setCommentTarget(null);
        setPictureTarget(null);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  // ── Native wheel handler (non-passive for preventDefault) ──
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      e.stopPropagation();
      // Multiplicative zoom: each scroll step scales by a factor
      const factor = e.deltaY > 0 ? 0.88 : 1.0 / 0.88;
      targetZoomRef.current = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, targetZoomRef.current * factor));
    };
    canvas.addEventListener("wheel", onWheel, { passive: false });
    return () => canvas.removeEventListener("wheel", onWheel);
  }, []);

  // ── Render loop ──
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d")!;

    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      canvas.width = canvas.clientWidth * dpr;
      canvas.height = canvas.clientHeight * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    window.addEventListener("resize", resize);

    const { nodes, edges, particles } = data;
    const nodeMap = new Map<string, Node3D>();
    nodes.forEach(n => nodeMap.set(n.id, n));

    const draw = () => {
      timeRef.current += 0.016;
      const t = timeRef.current;
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;

      if (autoRotate.current) targetRotYRef.current += 0.0012;
      rotYRef.current += (targetRotYRef.current - rotYRef.current) * 0.06;
      rotXRef.current += (targetRotXRef.current - rotXRef.current) * 0.06;
      zoomRef.current += (targetZoomRef.current - zoomRef.current) * 0.06;
      panRef.current.x += (targetPanRef.current.x - panRef.current.x) * 0.1;
      panRef.current.y += (targetPanRef.current.y - panRef.current.y) * 0.1;

      const rY = rotYRef.current;
      const rX = rotXRef.current;
      const zoom = zoomRef.current;
      const fov = PERSPECTIVE_FOV;
      const camZ = BASE_CAM_Z;
      const pan = panRef.current;
      const sel = selectedClusterRef.current;

      // ── Background ──
      ctx.clearRect(0, 0, w, h);
      const bg = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w * 0.85);
      bg.addColorStop(0, "#0d0d12");
      bg.addColorStop(0.5, "#09090f");
      bg.addColorStop(1, "#050508");
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, w, h);

      // ── Faint sphere wireframe ──
      const sphereCenter: Vec3 = { x: 0, y: 0, z: 0 };
      const sc = rotateY(sphereCenter, rY);
      const scr = rotateX(sc, rX);
      const sp = project(scr, w, h, fov, camZ, zoom, pan);
      const sphereScreenR = 320 * sp.scale;

      ctx.beginPath();
      ctx.arc(sp.sx, sp.sy, sphereScreenR, 0, Math.PI * 2);
      ctx.strokeStyle = "rgba(255,255,255,0.03)";
      ctx.lineWidth = 0.5;
      ctx.stroke();

      // Rings
      for (let ring = 0; ring < 3; ring++) {
        ctx.beginPath();
        for (let i = 0; i <= 80; i++) {
          const angle = (i / 80) * Math.PI * 2;
          let pt: Vec3;
          if (ring === 0) pt = { x: 320 * Math.cos(angle), y: 0, z: 320 * Math.sin(angle) };
          else if (ring === 1) pt = { x: 320 * Math.cos(angle), y: 320 * Math.sin(angle), z: 0 };
          else pt = { x: 0, y: 320 * Math.cos(angle), z: 320 * Math.sin(angle) };
          pt = rotateY(pt, rY); pt = rotateX(pt, rX);
          const pr = project(pt, w, h, fov, camZ, zoom, pan);
          if (i === 0) ctx.moveTo(pr.sx, pr.sy); else ctx.lineTo(pr.sx, pr.sy);
        }
        ctx.strokeStyle = "rgba(255,255,255,0.02)";
        ctx.lineWidth = 0.5;
        ctx.stroke();
      }

      // ── EMERGENT CENTRAL EFFECT for human-learning ──
      const centralNode = nodes.find(n => n.type === "central");
      if (centralNode) {
        let cpt: Vec3 = { x: centralNode.x, y: centralNode.y, z: centralNode.z };
        cpt = rotateY(cpt, rY); cpt = rotateX(cpt, rX);
        const cp = project(cpt, w, h, fov, camZ, zoom, pan);
        const cAlpha = Math.max(0.1, Math.min(1, 1 - cp.depth / 1200));

        // Pulsing concentric rings — "emerging pattern"
        for (let ring = 0; ring < 5; ring++) {
          const phase = t * 0.4 + ring * 1.2;
          const expand = (phase % (Math.PI * 2)) / (Math.PI * 2);
          const ringR = expand * 90 * cp.scale;
          const ringAlpha = (1 - expand) * 0.12 * cAlpha;
          if (ringAlpha > 0.005 && ringR > 1) {
            ctx.beginPath();
            ctx.arc(cp.sx, cp.sy, ringR, 0, Math.PI * 2);
            ctx.strokeStyle = `rgba(16,185,129,${ringAlpha})`;
            ctx.lineWidth = 1.2;
            ctx.stroke();
          }
        }

        // Radiating energy lines to each connected node
        const connectedNodeIds = centralNode.connections;
        for (const cid of connectedNodeIds) {
          const target = nodeMap.get(cid);
          if (!target) continue;
          let tpt: Vec3 = { x: target.x, y: target.y, z: target.z };
          tpt = rotateY(tpt, rY); tpt = rotateX(tpt, rX);
          const tp = project(tpt, w, h, fov, camZ, zoom, pan);

          const dx = tp.sx - cp.sx, dy = tp.sy - cp.sy;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < 2) continue;

          // Animated energy pulse traveling from center outward
          const pulsePhase = ((t * 0.3 + Math.abs(dx * 0.01 + dy * 0.01)) % 1);
          const px = cp.sx + dx * pulsePhase;
          const py = cp.sy + dy * pulsePhase;

          const tRgb = hexToRgb(target.color);
          const gradAlpha = 0.08 * cAlpha * (sel ? (sel === target.cluster || sel === "HumanLearning" ? 3 : 0.1) : 1);
          if (gradAlpha < 0.003) continue;

          const grad = ctx.createLinearGradient(cp.sx, cp.sy, tp.sx, tp.sy);
          grad.addColorStop(0, `rgba(16,185,129,${gradAlpha * 0.6})`);
          grad.addColorStop(0.5, `rgba(${tRgb[0]},${tRgb[1]},${tRgb[2]},${gradAlpha})`);
          grad.addColorStop(1, `rgba(${tRgb[0]},${tRgb[1]},${tRgb[2]},${gradAlpha * 0.3})`);

          ctx.beginPath();
          ctx.moveTo(cp.sx, cp.sy);
          const mx = (cp.sx + tp.sx) / 2 + Math.sin(t + dist) * 8;
          const my = (cp.sy + tp.sy) / 2 + Math.cos(t + dist) * 8;
          ctx.quadraticCurveTo(mx, my, tp.sx, tp.sy);
          ctx.strokeStyle = grad;
          ctx.lineWidth = 1.2;
          ctx.stroke();

          // Energy pulse dot
          ctx.beginPath();
          ctx.arc(px, py, 2 * cp.scale, 0, Math.PI * 2);
          ctx.fillStyle = `rgba(16,185,129,${(1 - pulsePhase) * 0.4 * cAlpha})`;
          ctx.fill();
        }

        // Large soft glow
        const bigGlow = ctx.createRadialGradient(cp.sx, cp.sy, 0, cp.sx, cp.sy, 80 * cp.scale);
        bigGlow.addColorStop(0, `rgba(16,185,129,${0.15 * cAlpha})`);
        bigGlow.addColorStop(0.3, `rgba(16,185,129,${0.05 * cAlpha})`);
        bigGlow.addColorStop(0.7, `rgba(16,185,129,${0.01 * cAlpha})`);
        bigGlow.addColorStop(1, "rgba(16,185,129,0)");
        ctx.beginPath();
        ctx.arc(cp.sx, cp.sy, 80 * cp.scale, 0, Math.PI * 2);
        ctx.fillStyle = bigGlow;
        ctx.fill();
      }

      // ── Update particles ──
      for (const p of particles) {
        p.orbitAngle += p.speed * 0.012;
        p.x = p.baseX + Math.cos(p.orbitAngle) * Math.cos(p.orbitTilt) * p.orbitRadius;
        p.y = p.baseY + Math.sin(p.orbitAngle) * Math.cos(p.orbitTilt) * p.orbitRadius;
        p.z = p.baseZ + Math.sin(p.orbitTilt + Math.sin(t * p.speed) * 0.15) * p.orbitRadius;
      }

      // ── Project ──
      type PP = { sx: number; sy: number; scale: number; depth: number; size: number; opacity: number; color: string };
      const projP: PP[] = [];
      for (const p of particles) {
        let pt: Vec3 = { x: p.x, y: p.y, z: p.z };
        pt = rotateY(pt, rY); pt = rotateX(pt, rX);
        const pr = project(pt, w, h, fov, camZ, zoom, pan);
        if (pr.sx > -40 && pr.sx < w + 40 && pr.sy > -40 && pr.sy < h + 40 && pr.depth > -fov + 50) {
          projP.push({ ...pr, size: p.size, opacity: p.opacity, color: p.color });
        }
      }

      type PN = { node: Node3D; sx: number; sy: number; scale: number; depth: number };
      const projN: PN[] = [];
      const projMap = new Map<string, PN>();
      for (const node of nodes) {
        let pt: Vec3 = { x: node.x, y: node.y, z: node.z };
        pt = rotateY(pt, rY); pt = rotateX(pt, rX);
        const pr = project(pt, w, h, fov, camZ, zoom, pan);
        const pn: PN = { node, ...pr };
        projN.push(pn);
        projMap.set(node.id, pn);
      }
      projP.sort((a, b) => b.depth - a.depth);
      projN.sort((a, b) => b.depth - a.depth);

      // ── Draw edges ──
      for (const edge of edges) {
        const fp = projMap.get(edge.from);
        const tp = projMap.get(edge.to);
        if (!fp || !tp) continue;
        const fn = fp.node, tn = tp.node;

        // Skip central node edges — drawn by emergent effect above
        if (fn.type === "central" || tn.type === "central") continue;

        const isRelevant = !sel || fn.cluster === sel || tn.cluster === sel;
        const isDimmed = sel && !isRelevant;
        const depthFade = Math.max(0.1, Math.min(1, 1 - (fp.depth + tp.depth) / 2 / 1200));

        const fromRgb = hexToRgb(fn.color);
        const toRgb = hexToRgb(tn.color);
        const eR = Math.round((fromRgb[0] + toRgb[0]) / 2);
        const eG = Math.round((fromRgb[1] + toRgb[1]) / 2);
        const eB = Math.round((fromRgb[2] + toRgb[2]) / 2);

        let alpha = (edge.isCross ? 0.1 : 0.18) * edge.strength * depthFade;
        if (isRelevant && sel) alpha *= 3.5;
        if (isDimmed) alpha *= 0.04;
        if (alpha < 0.004) continue;

        ctx.beginPath();
        ctx.moveTo(fp.sx, fp.sy);
        if (edge.isCross) {
          const mx = (fp.sx + tp.sx) / 2 * 0.85 + (w / 2) * 0.15;
          const my = (fp.sy + tp.sy) / 2 * 0.85 + (h / 2) * 0.15;
          ctx.quadraticCurveTo(mx, my, tp.sx, tp.sy);
        } else {
          ctx.lineTo(tp.sx, tp.sy);
        }
        ctx.strokeStyle = `rgba(${eR},${eG},${eB},${alpha})`;
        ctx.lineWidth = (isRelevant && sel) ? (edge.isCross ? 1.2 : 1.5) : (edge.isCross ? 0.7 : 1);
        ctx.stroke();
      }

      // ── Draw drag-to-connect line ──
      if (dragConnectRef.current && dragConnectMouseRef.current) {
        const src = projMap.get(dragConnectRef.current.sourceId);
        if (src) {
          const mPos = dragConnectMouseRef.current;
          ctx.beginPath();
          ctx.moveTo(src.sx, src.sy);
          ctx.lineTo(mPos.x, mPos.y);
          ctx.strokeStyle = "rgba(16,185,129,0.6)";
          ctx.lineWidth = 2;
          ctx.setLineDash([6, 4]);
          ctx.stroke();
          ctx.setLineDash([]);
          // Draw small circle at cursor
          ctx.beginPath();
          ctx.arc(mPos.x, mPos.y, 5, 0, Math.PI * 2);
          ctx.fillStyle = "rgba(16,185,129,0.4)";
          ctx.fill();
        }
      }

      // ── Draw particles ──
      for (const pp of projP) {
        const depthFade = Math.max(0.05, Math.min(1, 1 - pp.depth / 1200));
        let alpha = pp.opacity * depthFade;
        if (sel) alpha *= 0.25;
        if (alpha < 0.008) continue;
        const sz = pp.size * pp.scale;
        if (sz < 0.08) continue;
        ctx.beginPath();
        ctx.arc(pp.sx, pp.sy, sz, 0, Math.PI * 2);
        ctx.fillStyle = pp.color;
        ctx.globalAlpha = alpha;
        ctx.fill();
        ctx.globalAlpha = 1;
      }

      // ── Draw nodes ──
      for (const pn of projN) {
        const { node, sx, sy, scale, depth } = pn;
        const depthFade = Math.max(0.12, Math.min(1, 1 - depth / 1200));
        const isClusterSel = sel === node.cluster;
        const isDimmed = sel && !isClusterSel;

        let nodeAlpha = depthFade;
        if (isDimmed) nodeAlpha *= 0.06;
        if (isClusterSel) nodeAlpha = Math.min(1, nodeAlpha * 1.5);
        if (nodeAlpha < 0.02) continue;

        const breath = Math.sin(t * 0.8 + node.x * 0.01 + node.y * 0.01) * 0.06 + 1;
        const size = node.size * scale * breath;
        const rgb = hexToRgb(node.color);

        if (node.type === "central") {
          // Central emergent core
          const pulse = Math.sin(t * 1.5) * 0.15 + 1;
          const coreR = Math.max(4, size * 0.5 * pulse);

          // Core orb
          const coreGrad = ctx.createRadialGradient(sx, sy, 0, sx, sy, coreR);
          coreGrad.addColorStop(0, `rgba(255,255,255,${nodeAlpha * 0.9})`);
          coreGrad.addColorStop(0.3, `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${nodeAlpha * 0.8})`);
          coreGrad.addColorStop(0.7, `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${nodeAlpha * 0.3})`);
          coreGrad.addColorStop(1, `rgba(${rgb[0]},${rgb[1]},${rgb[2]},0)`);
          ctx.beginPath();
          ctx.arc(sx, sy, coreR, 0, Math.PI * 2);
          ctx.fillStyle = coreGrad;
          ctx.fill();

          // Spinning halo
          ctx.beginPath();
          ctx.arc(sx, sy, coreR * 1.6, 0, Math.PI * 2);
          ctx.strokeStyle = `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${nodeAlpha * 0.25})`;
          ctx.lineWidth = 1;
          ctx.stroke();

          ctx.beginPath();
          ctx.arc(sx, sy, coreR * 2.2, 0, Math.PI * 2);
          ctx.strokeStyle = `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${nodeAlpha * 0.12})`;
          ctx.lineWidth = 0.6;
          ctx.stroke();

          // Label
          if (scale > 0.15) {
            const fontSize = Math.max(10, 22 * scale);
            ctx.font = `700 ${fontSize}px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`;
            ctx.textAlign = "center";
            ctx.textBaseline = "top";
            ctx.fillStyle = `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${nodeAlpha * 0.95})`;
            ctx.fillText(node.label, sx, sy + coreR + 6);
          }
          continue;
        }

        // ── Normal node glow ──
        const glowR = size * 3.5;
        const glow = ctx.createRadialGradient(sx, sy, 0, sx, sy, glowR);
        glow.addColorStop(0, `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${0.22 * nodeAlpha})`);
        glow.addColorStop(0.4, `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${0.05 * nodeAlpha})`);
        glow.addColorStop(1, `rgba(${rgb[0]},${rgb[1]},${rgb[2]},0)`);
        ctx.beginPath();
        ctx.arc(sx, sy, glowR, 0, Math.PI * 2);
        ctx.fillStyle = glow;
        ctx.fill();

        // Core
        if (node.type !== "question" && node.type !== "item") {
          const coreR = Math.max(1.5, size * 0.45);
          ctx.beginPath();
          ctx.arc(sx, sy, coreR, 0, Math.PI * 2);
          ctx.fillStyle = `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${nodeAlpha * 0.85})`;
          ctx.fill();
          if (coreR > 2) {
            ctx.beginPath();
            ctx.arc(sx, sy, coreR * 0.35, 0, Math.PI * 2);
            ctx.fillStyle = `rgba(255,255,255,${nodeAlpha * 0.3})`;
            ctx.fill();
          }
          if (node.type === "author") {
            ctx.beginPath();
            ctx.arc(sx, sy, coreR + 1.5, 0, Math.PI * 2);
            ctx.strokeStyle = `rgba(255,255,255,${nodeAlpha * 0.25})`;
            ctx.lineWidth = 0.6;
            ctx.stroke();
          }
        }

        // ── Label ──
        if (scale < 0.18 || nodeAlpha < 0.07) continue;
        const labelAlpha = Math.min(1, (scale - 0.18) * 3.5) * nodeAlpha;
        if (labelAlpha < 0.04) continue;

        const lines = node.label.split("\n");
        let fontSize: number;
        let fontWeight: number;
        let isItalic = false;
        let fillColor: string;
        const textY = sy + size + 4;
        const fmt = node.formatting;

        switch (node.type) {
          case "header":
            fontSize = Math.max(7, 13 * scale);
            fontWeight = 800;
            fillColor = `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${labelAlpha * 0.95})`;
            break;
          case "subtitle":
            fontSize = Math.max(6, 10 * scale);
            fontWeight = 500; isItalic = true;
            fillColor = `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${labelAlpha * 0.7})`;
            break;
          case "quote":
            fontSize = Math.max(7, 12 * scale);
            fontWeight = 700;
            fillColor = `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${labelAlpha * 0.9})`;
            break;
          case "author":
            fontSize = Math.max(5, 8.5 * scale);
            fontWeight = 400; isItalic = true;
            fillColor = `rgba(255,255,255,${labelAlpha * 0.55})`;
            break;
          case "work":
            fontSize = Math.max(5.5, 9 * scale);
            fontWeight = 500; isItalic = true;
            fillColor = `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${labelAlpha * 0.75})`;
            break;
          case "question":
            fontSize = Math.max(4.5, 6 * scale);
            fontWeight = 400;
            fillColor = `rgba(255,255,255,${labelAlpha * 0.35})`;
            break;
          case "item":
            fontSize = Math.max(5, 7.5 * scale);
            fontWeight = 400;
            fillColor = `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${labelAlpha * 0.6})`;
            break;
          default:
            fontSize = Math.max(6, 9.5 * scale);
            fontWeight = 500;
            fillColor = `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${labelAlpha * 0.8})`;
        }

        // Apply custom formatting overrides
        if (fmt) {
          if (fmt.fontSize) fontSize *= fmt.fontSize;
          if (fmt.bold) fontWeight = Math.max(fontWeight, 700);
          if (fmt.italic !== undefined) isItalic = fmt.italic;
          if (fmt.color) {
            const cRgb = hexToRgb(fmt.color);
            fillColor = `rgba(${cRgb[0]},${cRgb[1]},${cRgb[2]},${labelAlpha * 0.95})`;
          }
        }

        const fontStyle = `${isItalic ? "italic " : ""}${fontWeight} ${fontSize}px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`;
        ctx.font = fontStyle;
        ctx.textAlign = "center";
        ctx.textBaseline = "top";
        ctx.fillStyle = fillColor;

        // Draw underline helper
        const drawUnderline = fmt?.underline === true;

        if (lines.length === 1) {
          ctx.fillText(lines[0], sx, textY);
          if (drawUnderline) {
            const tw = ctx.measureText(lines[0]).width;
            ctx.beginPath();
            ctx.moveTo(sx - tw / 2, textY + fontSize + 1);
            ctx.lineTo(sx + tw / 2, textY + fontSize + 1);
            ctx.strokeStyle = fillColor;
            ctx.lineWidth = Math.max(0.5, fontSize * 0.06);
            ctx.stroke();
          }
        } else {
          const lineH = fontSize * 1.25;
          for (let li = 0; li < lines.length; li++) {
            const ly = textY + li * lineH;
            ctx.fillText(lines[li], sx, ly);
            if (drawUnderline) {
              const tw = ctx.measureText(lines[li]).width;
              ctx.beginPath();
              ctx.moveTo(sx - tw / 2, ly + fontSize + 1);
              ctx.lineTo(sx + tw / 2, ly + fontSize + 1);
              ctx.strokeStyle = fillColor;
              ctx.lineWidth = Math.max(0.5, fontSize * 0.06);
              ctx.stroke();
            }
          }
        }

        // Draw small indicator dots for picture/comment attachments
        const hasImg = nodeImagesRef.current[node.id];
        const hasCmt = nodeCommentsRef.current[node.id];
        if (hasImg || hasCmt) {
          const indicatorY = textY + (lines.length) * (fontSize * 1.25) + 4;
          let indicatorX = sx - (hasImg && hasCmt ? 5 : 0);
          if (hasImg) {
            ctx.beginPath();
            ctx.arc(indicatorX, indicatorY, 2.5 * scale + 1, 0, Math.PI * 2);
            ctx.fillStyle = `rgba(59,130,246,${labelAlpha * 0.8})`;
            ctx.fill();
            indicatorX += 10 * scale + 3;
          }
          if (hasCmt) {
            ctx.beginPath();
            ctx.arc(indicatorX, indicatorY, 2.5 * scale + 1, 0, Math.PI * 2);
            ctx.fillStyle = `rgba(245,158,11,${labelAlpha * 0.8})`;
            ctx.fill();
          }
        }
      }

      animRef.current = requestAnimationFrame(draw);

      // Update zoom display
      if (zoomDisplayFrameRef.current % 10 === 0) {
        setZoomMultiplier(zoomRef.current);
      }
      zoomDisplayFrameRef.current++;
    };

    draw();
    return () => { cancelAnimationFrame(animRef.current); window.removeEventListener("resize", resize); };
  }, [data]);

  // ── Mouse handlers ──
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    // In connect mode, start drag-to-connect if clicking on a node
    if (interactionMode === "connect") {
      const canvas = canvasRef.current;
      if (canvas) {
        const rect = canvas.getBoundingClientRect();
        const mx = e.clientX - rect.left, my = e.clientY - rect.top;
        const w = canvas.clientWidth, h = canvas.clientHeight;
        const fov = PERSPECTIVE_FOV, camZ = BASE_CAM_Z, zoom = zoomRef.current, pan = panRef.current;
        for (const node of dataRef.current.nodes) {
          let pt: Vec3 = { x: node.x, y: node.y, z: node.z };
          pt = rotateY(pt, rotYRef.current); pt = rotateX(pt, rotXRef.current);
          const pr = project(pt, w, h, fov, camZ, zoom, pan);
          const dx = mx - pr.sx, dy = my - pr.sy;
          const hitR = Math.max(14, node.size * pr.scale * 2.5);
          if (dx * dx + dy * dy < hitR * hitR) {
            dragConnectRef.current = { sourceId: node.id, sx: pr.sx, sy: pr.sy };
            dragConnectMouseRef.current = { x: mx, y: my };
            return; // Don't start drag-rotate
          }
        }
      }
    }
    if (e.shiftKey) {
      isPanning.current = true;
    } else if (!interactionMode) {
      // Check if clicking on a node to drag it
      const canvas = canvasRef.current;
      if (canvas) {
        const rect = canvas.getBoundingClientRect();
        const mx = e.clientX - rect.left, my = e.clientY - rect.top;
        const w = canvas.clientWidth, h = canvas.clientHeight;
        const fov = PERSPECTIVE_FOV, camZ = BASE_CAM_Z, zoom = zoomRef.current, pan = panRef.current;
        for (const node of dataRef.current.nodes) {
          let pt: Vec3 = { x: node.x, y: node.y, z: node.z };
          pt = rotateY(pt, rotYRef.current); pt = rotateX(pt, rotXRef.current);
          const pr = project(pt, w, h, fov, camZ, zoom, pan);
          const dx = mx - pr.sx, dy = my - pr.sy;
          const hitR = Math.max(14, node.size * pr.scale * 2.5);
          if (dx * dx + dy * dy < hitR * hitR) {
            draggingNodeRef.current = node.id;
            didDragNode.current = false;
            lastMouse.current = { x: e.clientX, y: e.clientY };
            autoRotate.current = false;
            if (autoTimer.current) clearTimeout(autoTimer.current);
            return;
          }
        }
      }
      isDragging.current = true;
    } else {
      isDragging.current = true;
    }
    lastMouse.current = { x: e.clientX, y: e.clientY };
    autoRotate.current = false;
    if (autoTimer.current) clearTimeout(autoTimer.current);
  }, [interactionMode]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    // Node dragging: move node in 3D space based on screen delta
    if (draggingNodeRef.current) {
      const node = dataRef.current.nodes.find(n => n.id === draggingNodeRef.current);
      if (node) {
        const dx = e.clientX - lastMouse.current.x;
        const dy = e.clientY - lastMouse.current.y;
        if (Math.abs(dx) > 2 || Math.abs(dy) > 2) didDragNode.current = true;
        const zoom = zoomRef.current;
        const fov = PERSPECTIVE_FOV;
        // Convert screen delta to world-space delta (inverse projection + inverse rotation)
        // Approximate: at the node's depth, how much world movement equals the screen delta
        let pt: Vec3 = { x: node.x, y: node.y, z: node.z };
        pt = rotateY(pt, rotYRef.current); pt = rotateX(pt, rotXRef.current);
        const zDepth = pt.z * zoom + BASE_CAM_Z;
        const screenScale = fov / (fov + zDepth) * zoom;
        const worldDx = dx / screenScale;
        const worldDy = dy / screenScale;
        // The delta is in rotated camera space — inverse-rotate back to world space
        let delta: Vec3 = { x: worldDx, y: worldDy, z: 0 };
        delta = rotateX(delta, -rotXRef.current);
        delta = rotateY(delta, -rotYRef.current);
        node.x += delta.x;
        node.y += delta.y;
        node.z += delta.z;
      }
      lastMouse.current = { x: e.clientX, y: e.clientY };
      canvas.style.cursor = "grabbing";
      setHovered(null);
      return;
    }

    // Drag-to-connect: update mouse position for the live line
    if (dragConnectRef.current) {
      const rect = canvas.getBoundingClientRect();
      dragConnectMouseRef.current = { x: e.clientX - rect.left, y: e.clientY - rect.top };
      canvas.style.cursor = "crosshair";
      return;
    }

    if (isPanning.current) {
      const dx = e.clientX - lastMouse.current.x;
      const dy = e.clientY - lastMouse.current.y;
      targetPanRef.current = { x: targetPanRef.current.x + dx, y: targetPanRef.current.y + dy };
      lastMouse.current = { x: e.clientX, y: e.clientY };
      setHovered(null);
      return;
    }

    if (isDragging.current) {
      const dx = e.clientX - lastMouse.current.x;
      const dy = e.clientY - lastMouse.current.y;
      targetRotYRef.current += dx * 0.005;
      targetRotXRef.current += dy * 0.005;
      targetRotXRef.current = Math.max(-Math.PI / 2.5, Math.min(Math.PI / 2.5, targetRotXRef.current));
      lastMouse.current = { x: e.clientX, y: e.clientY };
      setHovered(null);
      return;
    }

    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left, my = e.clientY - rect.top;
    const w = canvas.clientWidth, h = canvas.clientHeight;
    const fov = PERSPECTIVE_FOV, camZ = BASE_CAM_Z, zoom = zoomRef.current, pan = panRef.current;

    let closest: { node: Node3D; dist: number; sx: number; sy: number } | null = null;
    for (const node of data.nodes) {
      let pt: Vec3 = { x: node.x, y: node.y, z: node.z };
      pt = rotateY(pt, rotYRef.current); pt = rotateX(pt, rotXRef.current);
      const pr = project(pt, w, h, fov, camZ, zoom, pan);
      const dx = mx - pr.sx, dy = my - pr.sy;
      const hitR = Math.max(14, node.size * pr.scale * 2.5);
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < hitR && (!closest || dist < closest.dist)) {
        closest = { node, dist, sx: pr.sx, sy: pr.sy };
      }
    }
    if (closest) {
      setHovered({ node: closest.node, sx: closest.sx, sy: closest.sy });
      canvas.style.cursor = "pointer";
    } else {
      setHovered(null);
      canvas.style.cursor = "grab";
    }
  }, [data.nodes]);

  const handleMouseUp = useCallback((e: React.MouseEvent) => {
    // Complete drag-to-connect
    if (dragConnectRef.current && canvasRef.current) {
      const rect = canvasRef.current.getBoundingClientRect();
      const mx = e.clientX - rect.left, my = e.clientY - rect.top;
      const w = canvasRef.current.clientWidth, h = canvasRef.current.clientHeight;
      const fov = PERSPECTIVE_FOV, camZ = BASE_CAM_Z, zoom = zoomRef.current, pan = panRef.current;
      const sourceId = dragConnectRef.current.sourceId;
      for (const node of dataRef.current.nodes) {
        if (node.id === sourceId) continue;
        let pt: Vec3 = { x: node.x, y: node.y, z: node.z };
        pt = rotateY(pt, rotYRef.current); pt = rotateX(pt, rotXRef.current);
        const pr = project(pt, w, h, fov, camZ, zoom, pan);
        const dx = mx - pr.sx, dy = my - pr.sy;
        const hitR = Math.max(14, node.size * pr.scale * 2.5);
        if (dx * dx + dy * dy < hitR * hitR) {
          addEdge(sourceId, node.id);
          break;
        }
      }
      dragConnectRef.current = null;
      dragConnectMouseRef.current = null;
      return;
    }
    const wasDraggingNode = draggingNodeRef.current !== null;
    draggingNodeRef.current = null;
    isDragging.current = false;
    isPanning.current = false;
    if (canvasRef.current) canvasRef.current.style.cursor = interactionMode === "connect" ? "crosshair" : "grab";
    if (autoTimer.current) clearTimeout(autoTimer.current);
    if (!wasDraggingNode) {
      autoTimer.current = setTimeout(() => { autoRotate.current = true; }, 4500);
    }
  }, [addEdge, interactionMode]);

  const handleClick = useCallback((e: React.MouseEvent) => {
    // Skip click if we just finished dragging a node
    if (didDragNode.current) { didDragNode.current = false; return; }
    if (!canvasRef.current) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const mx = e.clientX - rect.left, my = e.clientY - rect.top;
    const w = canvasRef.current.clientWidth, h = canvasRef.current.clientHeight;
    const fov = PERSPECTIVE_FOV, camZ = BASE_CAM_Z, zoom = zoomRef.current, pan = panRef.current;

    for (const node of data.nodes) {
      let pt: Vec3 = { x: node.x, y: node.y, z: node.z };
      pt = rotateY(pt, rotYRef.current); pt = rotateX(pt, rotXRef.current);
      const pr = project(pt, w, h, fov, camZ, zoom, pan);
      const dx = mx - pr.sx, dy = my - pr.sy;
      const hitR = Math.max(14, node.size * pr.scale * 2.5);
      if (dx * dx + dy * dy < hitR * hitR) {
        // Handle interaction modes
        if (interactionMode === "picture") {
          setPictureTarget(node.id);
          setInteractionMode(null);
          // Trigger file input
          setTimeout(() => fileInputRef.current?.click(), 50);
          return;
        }
        if (interactionMode === "comment") {
          setCommentTarget(node.id);
          setCommentText("");
          setInteractionMode(null);
          return;
        }
        if (interactionMode === "connect") {
          if (!connectSource) {
            setConnectSource(node.id);
          } else if (connectSource !== node.id) {
            // Create edge between connectSource and node.id
            addEdge(connectSource, node.id);
            setConnectSource(null);
            setInteractionMode(null);
          }
          return;
        }
        setSelectedCluster(prev => prev === node.cluster ? null : node.cluster);
        return;
      }
    }
    if (interactionMode) {
      setConnectSource(null);
      setInteractionMode(null);
      return;
    }
    setSelectedCluster(null);
    setConnectionPopup(null);
  }, [data.nodes, interactionMode, connectSource]);

  const handleDoubleClick = useCallback((e: React.MouseEvent) => {
    if (!canvasRef.current) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const mx = e.clientX - rect.left, my = e.clientY - rect.top;
    const w = canvasRef.current.clientWidth, h = canvasRef.current.clientHeight;
    const fov = PERSPECTIVE_FOV, camZ = BASE_CAM_Z, zoom = zoomRef.current, pan = panRef.current;

    for (const node of data.nodes) {
      let pt: Vec3 = { x: node.x, y: node.y, z: node.z };
      pt = rotateY(pt, rotYRef.current); pt = rotateX(pt, rotXRef.current);
      const pr = project(pt, w, h, fov, camZ, zoom, pan);
      const dx = mx - pr.sx, dy = my - pr.sy;
      const hitR = Math.max(18, node.size * pr.scale * 3);
      if (dx * dx + dy * dy < hitR * hitR) {
        setEditingNode(node.id);
        setEditText(node.label);
        setEditFormatting(node.formatting || {});
        return;
      }
    }
  }, [data.nodes]);

  // Right-click: open connection manager for a node
  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    if (!canvasRef.current) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const mx = e.clientX - rect.left, my = e.clientY - rect.top;
    const w = canvasRef.current.clientWidth, h = canvasRef.current.clientHeight;
    const fov = PERSPECTIVE_FOV, camZ = BASE_CAM_Z, zoom = zoomRef.current, pan = panRef.current;

    for (const node of data.nodes) {
      let pt: Vec3 = { x: node.x, y: node.y, z: node.z };
      pt = rotateY(pt, rotYRef.current); pt = rotateX(pt, rotXRef.current);
      const pr = project(pt, w, h, fov, camZ, zoom, pan);
      const dx = mx - pr.sx, dy = my - pr.sy;
      const hitR = Math.max(14, node.size * pr.scale * 2.5);
      if (dx * dx + dy * dy < hitR * hitR) {
        setConnectionPopup({ nodeId: node.id, x: e.clientX - rect.left, y: e.clientY - rect.top });
        return;
      }
    }
    setConnectionPopup(null);
  }, [data.nodes]);

  // Touch
  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    if (e.touches.length === 1) {
      isDragging.current = true;
      lastMouse.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
      autoRotate.current = false;
      if (autoTimer.current) clearTimeout(autoTimer.current);
    }
  }, []);
  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (isDragging.current && e.touches.length === 1) {
      const dx = e.touches[0].clientX - lastMouse.current.x;
      const dy = e.touches[0].clientY - lastMouse.current.y;
      targetRotYRef.current += dx * 0.005;
      targetRotXRef.current += dy * 0.005;
      targetRotXRef.current = Math.max(-Math.PI / 2.5, Math.min(Math.PI / 2.5, targetRotXRef.current));
      lastMouse.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
    }
  }, []);
  const handleTouchEnd = useCallback(() => {
    isDragging.current = false;
    if (autoTimer.current) clearTimeout(autoTimer.current);
    autoTimer.current = setTimeout(() => { autoRotate.current = true; }, 4500);
  }, []);

  // Save formatting to localStorage (called after saveEdit)
  const persistFormatting = useCallback(() => {
    const fmtMap: Record<string, NodeFormatting> = {};
    for (const node of data.nodes) {
      if (node.formatting && Object.keys(node.formatting).length > 0) {
        fmtMap[node.id] = node.formatting;
      }
    }
    try { localStorage.setItem("latentSpace_formatting", JSON.stringify(fmtMap)); }
    catch { /* ignore */ }
  }, [data.nodes]);

  // Edit save
  const saveEdit = useCallback(() => {
    if (!editingNode) return;
    const node = data.nodes.find(n => n.id === editingNode);
    if (node && editText.trim()) {
      node.label = editText.trim();
      node.formatting = { ...editFormatting };
    }
    setEditingNode(null);
    setEditText("");
    setEditFormatting({});
    // Persist formatting to localStorage
    setTimeout(() => persistFormatting(), 0);
  }, [editingNode, editText, editFormatting, data.nodes, persistFormatting]);

  // Add node
  const addNode = useCallback(() => {
    if (!newNodeLabel.trim()) return;
    // Place near a random position on the sphere
    const theta = Math.random() * Math.PI * 2;
    const phi = (Math.random() - 0.5) * Math.PI;
    const r = 320;
    const x = r * Math.cos(phi) * Math.cos(theta);
    const y = r * Math.sin(phi);
    const z = r * Math.cos(phi) * Math.sin(theta);

    const clusterColors: Record<string, string> = {
      Methodology: "#ef4444", ErrorGlitch: "#f97316", Praxis: "#f59e0b", CriticalPlay: "#eab308",
      Epistemology: "#22c55e", HumanLearning: "#10b981", MachineLearning: "#3b82f6",
      PerformanceStudies: "#8b5cf6", Ontology: "#a855f7", Axiology: "#ec4899",
      Noise: "#64748b", CyberneticPerformances: "#14b8a6", PerformaAutomata: "#06b6d4", Audience: "#f43f5e",
    };

    data.nodes.push({
      id: newNodeLabel.trim(),
      label: newNodeLabel.trim(),
      x, y, z,
      cluster: newNodeCluster,
      color: clusterColors[newNodeCluster] || "#10b981",
      size: 4,
      type: "concept",
      particleCount: 0,
      connections: [],
    });

    // Connect to human-learning
    const centralNode = data.nodes.find(n => n.type === "central");
    if (centralNode) {
      data.edges.push({ from: "human-learning", to: newNodeLabel.trim(), strength: 0.3, isCross: true });
      centralNode.connections.push(newNodeLabel.trim());
      data.nodes[data.nodes.length - 1].connections.push("human-learning");
    }

    setNewNodeLabel("");
    setShowAddForm(false);
  }, [newNodeLabel, newNodeCluster, data]);

  // Handle file selection for picture attachment
  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !pictureTarget) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const dataUrl = ev.target?.result as string;
      setNodeImages(prev => ({ ...prev, [pictureTarget!]: dataUrl }));
      setPictureTarget(null);
    };
    reader.readAsDataURL(file);
    e.target.value = "";
  }, [pictureTarget]);

  // Save comment
  const saveComment = useCallback(() => {
    if (!commentTarget || !commentText.trim()) return;
    setNodeComments(prev => ({
      ...prev,
      [commentTarget]: [...(prev[commentTarget] || []), commentText.trim()],
    }));
    setCommentText("");
    setCommentTarget(null);
  }, [commentTarget, commentText]);

  // Delete comment
  const deleteComment = useCallback((nodeId: string, index: number) => {
    setNodeComments(prev => {
      const arr = [...(prev[nodeId] || [])];
      arr.splice(index, 1);
      if (arr.length === 0) {
        const next = { ...prev };
        delete next[nodeId];
        return next;
      }
      return { ...prev, [nodeId]: arr };
    });
  }, []);

  // Remove picture
  const removePicture = useCallback((nodeId: string) => {
    setNodeImages(prev => {
      const next = { ...prev };
      delete next[nodeId];
      return next;
    });
  }, []);

  // Save all data to a JSON file for download
  const saveToFile = useCallback(() => {
    // Collect formatting from nodes
    const formatting: Record<string, NodeFormatting> = {};
    for (const node of data.nodes) {
      if (node.formatting && Object.keys(node.formatting).length > 0) {
        formatting[node.id] = node.formatting;
      }
    }

    const saveData = {
      version: 1,
      savedAt: new Date().toISOString(),
      images: nodeImages,
      comments: nodeComments,
      formatting,
    };

    const json = JSON.stringify(saveData, null, 2);
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "latent-space-save.json";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [nodeImages, nodeComments, data.nodes]);

  // Load data from a JSON file
  const loadFromFile = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const saveData = JSON.parse(ev.target?.result as string);
        if (saveData.images) setNodeImages(saveData.images);
        if (saveData.comments) setNodeComments(saveData.comments);
        if (saveData.formatting) {
          for (const node of data.nodes) {
            if (saveData.formatting[node.id]) {
              node.formatting = saveData.formatting[node.id];
            }
          }
          // Persist to localStorage too
          localStorage.setItem("latentSpace_formatting", JSON.stringify(saveData.formatting));
        }
      } catch { /* invalid file */ }
    };
    reader.readAsText(file);
    e.target.value = "";
  }, [data.nodes]);

  const clusterMeta: Record<string, { name: string; color: string }> = {
    Methodology: { name: "Methodology", color: "#ef4444" },
    ErrorGlitch: { name: '"Error" / "Glitch"', color: "#f97316" },
    Praxis: { name: "Praxis", color: "#f59e0b" },
    CriticalPlay: { name: "Critical Play", color: "#eab308" },
    Epistemology: { name: "Epistemology", color: "#22c55e" },
    HumanLearning: { name: "human-learning", color: "#10b981" },
    MachineLearning: { name: "ML / AI", color: "#3b82f6" },
    PerformanceStudies: { name: "Performance Studies", color: "#8b5cf6" },
    Ontology: { name: "Ontology", color: "#a855f7" },
    Axiology: { name: "Axiology", color: "#ec4899" },
    Noise: { name: '"Noise"', color: "#64748b" },
    CyberneticPerformances: { name: "Cybernetic Perf.", color: "#14b8a6" },
    PerformaAutomata: { name: "Performa Automata", color: "#06b6d4" },
    Audience: { name: "The Audience", color: "#f43f5e" },
  };

  const clusterList = useMemo(() => {
    const seen = new Set<string>();
    const list: string[] = [];
    data.nodes.forEach(n => { if (!seen.has(n.cluster)) { seen.add(n.cluster); list.push(n.cluster); } });
    return list;
  }, [data.nodes]);

  const panelStyle = {
    background: "rgba(10,10,18,0.88)",
    backdropFilter: "blur(12px)",
    border: "1px solid rgba(255,255,255,0.06)",
  };
  const inputStyle = {
    background: "rgba(255,255,255,0.06)",
    border: "1px solid rgba(255,255,255,0.1)",
    color: "rgba(255,255,255,0.9)",
    borderRadius: 6,
    padding: "6px 10px",
    fontSize: "0.7rem",
    outline: "none",
    width: "100%",
  };

  return (
    <div className="relative w-full h-full overflow-hidden" style={{ background: "#0a0a0f" }}>
      <canvas
        ref={canvasRef}
        className="w-full h-full"
        style={{ cursor: "grab" }}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onClick={handleClick}
        onDoubleClick={handleDoubleClick}
        onContextMenu={handleContextMenu}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
      />

      {/* Title */}
      <div className="absolute top-4 left-1/2 -translate-x-1/2 pointer-events-none text-center">
        <h1 style={{ fontSize: "1.1rem", fontWeight: 700, color: "rgba(255,255,255,0.85)", letterSpacing: "0.06em", textTransform: "uppercase" }}>
          Cartography of the Lit. Review
        </h1>
        <p style={{ fontSize: "0.5rem", color: "rgba(255,255,255,0.18)", marginTop: 1, letterSpacing: "0.15em" }}>
          3D SPHERICAL LATENT SPACE
        </p>
      </div>

      {/* Hidden file inputs */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        style={{ display: "none" }}
        onChange={handleFileSelect}
      />
      <input
        ref={loadFileInputRef}
        type="file"
        accept=".json"
        style={{ display: "none" }}
        onChange={loadFromFile}
      />

      {/* Top toolbar */}
      <div className="absolute top-4 left-4 flex gap-2 flex-wrap" style={{ maxWidth: "calc(100vw - 200px)" }}>
        <button
          className="px-3 py-1.5 rounded-lg transition-all hover:brightness-125"
          style={{ ...panelStyle, fontSize: "0.65rem", color: "rgba(255,255,255,0.6)", cursor: "pointer" }}
          onClick={() => setShowAddForm(!showAddForm)}
        >
          + Add Node
        </button>
        <button
          className="px-3 py-1.5 rounded-lg transition-all hover:brightness-125"
          style={{
            ...panelStyle,
            fontSize: "0.65rem",
            color: interactionMode === "picture" ? "#10b981" : "rgba(255,255,255,0.6)",
            cursor: "pointer",
            borderColor: interactionMode === "picture" ? "rgba(16,185,129,0.4)" : "rgba(255,255,255,0.06)",
          }}
          onClick={() => setInteractionMode(prev => prev === "picture" ? null : "picture")}
        >
          Attach Picture
        </button>
        <button
          className="px-3 py-1.5 rounded-lg transition-all hover:brightness-125"
          style={{
            ...panelStyle,
            fontSize: "0.65rem",
            color: interactionMode === "comment" ? "#10b981" : "rgba(255,255,255,0.6)",
            cursor: "pointer",
            borderColor: interactionMode === "comment" ? "rgba(16,185,129,0.4)" : "rgba(255,255,255,0.06)",
          }}
          onClick={() => setInteractionMode(prev => prev === "comment" ? null : "comment")}
        >
          Add Comment
        </button>
        <button
          className="px-3 py-1.5 rounded-lg transition-all hover:brightness-125"
          style={{
            ...panelStyle,
            fontSize: "0.65rem",
            color: interactionMode === "connect" ? "#10b981" : "rgba(255,255,255,0.6)",
            cursor: "pointer",
            borderColor: interactionMode === "connect" ? "rgba(16,185,129,0.4)" : "rgba(255,255,255,0.06)",
          }}
          onClick={() => { setInteractionMode(prev => prev === "connect" ? null : "connect"); setConnectSource(null); }}
        >
          Connect Nodes
        </button>

        <span style={{ width: 1, height: 24, background: "rgba(255,255,255,0.08)", alignSelf: "center" }} />

        <button
          className="px-3 py-1.5 rounded-lg transition-all hover:brightness-125"
          style={{ ...panelStyle, fontSize: "0.65rem", color: "#3b82f6", cursor: "pointer", borderColor: "rgba(59,130,246,0.2)" }}
          onClick={saveToFile}
          title="Save pictures, comments & formatting to a JSON file"
        >
          Save to File
        </button>
        <button
          className="px-3 py-1.5 rounded-lg transition-all hover:brightness-125"
          style={{ ...panelStyle, fontSize: "0.65rem", color: "rgba(255,255,255,0.5)", cursor: "pointer" }}
          onClick={() => loadFileInputRef.current?.click()}
          title="Load from a previously saved JSON file"
        >
          Load
        </button>
      </div>

      {/* Mode indicator */}
      {interactionMode && (
        <div
          className="absolute top-14 left-1/2 -translate-x-1/2 px-4 py-2 rounded-lg pointer-events-none"
          style={{ ...panelStyle, borderColor: "rgba(16,185,129,0.3)" }}
        >
          <p style={{ fontSize: "0.7rem", color: "#10b981", textAlign: "center" }}>
            {interactionMode === "picture" ? "Click a node to attach a picture"
              : interactionMode === "comment" ? "Click a node to add a comment"
              : connectSource ? `Now click a second node to connect to "${connectSource}"`
              : "Click a node to start, then click another to connect — or drag from one node to another"}
          </p>
          <p style={{ fontSize: "0.5rem", color: "rgba(255,255,255,0.3)", textAlign: "center", marginTop: 2 }}>
            Click empty space or press Esc to cancel
          </p>
        </div>
      )}

      {/* Connection management popup (right-click on node) */}
      {connectionPopup && (() => {
        const node = data.nodes.find(n => n.id === connectionPopup.nodeId);
        if (!node) return null;
        const conns = node.connections;
        return (
          <div
            className="absolute z-50 p-3 rounded-xl flex flex-col gap-1"
            style={{
              ...panelStyle,
              left: connectionPopup.x,
              top: connectionPopup.y,
              minWidth: 220,
              maxHeight: 300,
              overflowY: "auto",
              borderColor: "rgba(16,185,129,0.3)",
            }}
            onClick={e => e.stopPropagation()}
          >
            <p style={{ fontSize: "0.6rem", fontWeight: 700, color: "rgba(255,255,255,0.5)", letterSpacing: "0.08em", marginBottom: 4 }}>
              Connections: {node.label.split("\n")[0]}
            </p>
            {conns.length === 0 && (
              <p style={{ fontSize: "0.55rem", color: "rgba(255,255,255,0.25)" }}>No connections</p>
            )}
            {conns.map(cid => (
              <div key={cid} className="flex items-center justify-between gap-2" style={{ padding: "2px 0" }}>
                <span style={{ fontSize: "0.55rem", color: "rgba(255,255,255,0.6)", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {cid.split("\n")[0]}
                </span>
                <button
                  style={{
                    fontSize: "0.5rem",
                    color: "#ef4444",
                    background: "rgba(239,68,68,0.1)",
                    border: "1px solid rgba(239,68,68,0.2)",
                    borderRadius: 4,
                    padding: "1px 6px",
                    cursor: "pointer",
                  }}
                  onClick={() => {
                    removeEdge(connectionPopup.nodeId, cid);
                    // Force re-render of popup by resetting it
                    setConnectionPopup({ ...connectionPopup });
                  }}
                >
                  Remove
                </button>
              </div>
            ))}
            <button
              style={{
                fontSize: "0.5rem",
                color: "rgba(255,255,255,0.4)",
                background: "rgba(255,255,255,0.05)",
                border: "1px solid rgba(255,255,255,0.1)",
                borderRadius: 4,
                padding: "3px 8px",
                cursor: "pointer",
                marginTop: 4,
                alignSelf: "flex-end",
              }}
              onClick={() => setConnectionPopup(null)}
            >
              Close
            </button>
          </div>
        );
      })()}

      {/* Add Form */}
      {showAddForm && (
        <div className="absolute top-16 left-4 p-3 rounded-xl w-56 flex flex-col gap-2 z-30" style={panelStyle}>
          <p style={{ fontSize: "0.55rem", fontWeight: 700, color: "rgba(255,255,255,0.3)", letterSpacing: "0.1em", textTransform: "uppercase" }}>
            New Node
          </p>
          <input
            style={inputStyle}
            placeholder="Label..."
            value={newNodeLabel}
            onChange={e => setNewNodeLabel(e.target.value)}
            onKeyDown={e => e.key === "Enter" && addNode()}
            autoFocus
          />
          <select
            style={{ ...inputStyle, cursor: "pointer" }}
            value={newNodeCluster}
            onChange={e => setNewNodeCluster(e.target.value)}
          >
            {clusterList.map(k => (
              <option key={k} value={k} style={{ background: "#1a1a2e", color: "#fff" }}>
                {clusterMeta[k]?.name || k}
              </option>
            ))}
          </select>
          <div className="flex gap-2">
            <button
              className="flex-1 py-1 rounded-md transition-all hover:brightness-125"
              style={{ background: "rgba(16,185,129,0.2)", color: "#10b981", fontSize: "0.6rem", border: "none", cursor: "pointer" }}
              onClick={addNode}
            >
              Add
            </button>
            <button
              className="flex-1 py-1 rounded-md transition-all hover:brightness-125"
              style={{ background: "rgba(255,255,255,0.04)", color: "rgba(255,255,255,0.4)", fontSize: "0.6rem", border: "none", cursor: "pointer" }}
              onClick={() => setShowAddForm(false)}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Edit Modal with Formatting Toolbar */}
      {editingNode && (
        <div className="absolute inset-0 flex items-center justify-center z-50" style={{ background: "rgba(0,0,0,0.5)" }}>
          <div className="p-5 rounded-xl w-[420px] flex flex-col gap-3" style={panelStyle}>
            <p style={{ fontSize: "0.7rem", fontWeight: 700, color: "rgba(255,255,255,0.4)", letterSpacing: "0.1em", textTransform: "uppercase" }}>
              Edit Label
            </p>

            {/* Formatting toolbar */}
            <div className="flex items-center gap-1 flex-wrap" style={{ borderBottom: "1px solid rgba(255,255,255,0.08)", paddingBottom: 8 }}>
              {/* Bold */}
              <button
                className="px-2.5 py-1 rounded transition-all hover:brightness-150"
                style={{
                  background: editFormatting.bold ? "rgba(16,185,129,0.25)" : "rgba(255,255,255,0.06)",
                  color: editFormatting.bold ? "#10b981" : "rgba(255,255,255,0.6)",
                  border: "none", cursor: "pointer", fontSize: "0.75rem", fontWeight: 700,
                }}
                onClick={() => setEditFormatting(f => ({ ...f, bold: !f.bold }))}
                title="Bold"
              >
                B
              </button>
              {/* Italic */}
              <button
                className="px-2.5 py-1 rounded transition-all hover:brightness-150"
                style={{
                  background: editFormatting.italic ? "rgba(16,185,129,0.25)" : "rgba(255,255,255,0.06)",
                  color: editFormatting.italic ? "#10b981" : "rgba(255,255,255,0.6)",
                  border: "none", cursor: "pointer", fontSize: "0.75rem", fontStyle: "italic",
                }}
                onClick={() => setEditFormatting(f => ({ ...f, italic: !f.italic }))}
                title="Italic"
              >
                I
              </button>
              {/* Underline */}
              <button
                className="px-2.5 py-1 rounded transition-all hover:brightness-150"
                style={{
                  background: editFormatting.underline ? "rgba(16,185,129,0.25)" : "rgba(255,255,255,0.06)",
                  color: editFormatting.underline ? "#10b981" : "rgba(255,255,255,0.6)",
                  border: "none", cursor: "pointer", fontSize: "0.75rem", textDecoration: "underline",
                }}
                onClick={() => setEditFormatting(f => ({ ...f, underline: !f.underline }))}
                title="Underline"
              >
                U
              </button>

              <span style={{ width: 1, height: 18, background: "rgba(255,255,255,0.1)", margin: "0 4px" }} />

              {/* Font size */}
              <span style={{ fontSize: "0.55rem", color: "rgba(255,255,255,0.35)", marginRight: 2 }}>Size:</span>
              {[0.5, 0.75, 1, 1.5, 2, 3].map(s => (
                <button
                  key={s}
                  className="px-1.5 py-0.5 rounded transition-all hover:brightness-150"
                  style={{
                    background: (editFormatting.fontSize || 1) === s ? "rgba(16,185,129,0.25)" : "rgba(255,255,255,0.04)",
                    color: (editFormatting.fontSize || 1) === s ? "#10b981" : "rgba(255,255,255,0.5)",
                    border: "none", cursor: "pointer", fontSize: "0.6rem",
                  }}
                  onClick={() => setEditFormatting(f => ({ ...f, fontSize: s }))}
                >
                  {s}x
                </button>
              ))}

              <span style={{ width: 1, height: 18, background: "rgba(255,255,255,0.1)", margin: "0 4px" }} />

              {/* Color picker */}
              <span style={{ fontSize: "0.55rem", color: "rgba(255,255,255,0.35)", marginRight: 2 }}>Color:</span>
              {["", "#ef4444", "#f97316", "#f59e0b", "#22c55e", "#10b981", "#3b82f6", "#8b5cf6", "#ec4899", "#ffffff"].map(c => (
                <button
                  key={c || "default"}
                  className="rounded-full transition-all hover:brightness-150"
                  style={{
                    width: 16, height: 16,
                    background: c || (data.nodes.find(n => n.id === editingNode)?.color || "#888"),
                    border: (editFormatting.color || "") === c ? "2px solid #10b981" : "1px solid rgba(255,255,255,0.15)",
                    cursor: "pointer",
                  }}
                  onClick={() => setEditFormatting(f => ({ ...f, color: c || undefined }))}
                  title={c || "Default (cluster color)"}
                />
              ))}
            </div>

            {/* Text preview */}
            <div className="px-3 py-2 rounded-md" style={{ background: "rgba(255,255,255,0.03)", minHeight: 30 }}>
              <p style={{
                fontSize: `${0.85 * (editFormatting.fontSize || 1)}rem`,
                fontWeight: editFormatting.bold ? 700 : 400,
                fontStyle: editFormatting.italic ? "italic" : "normal",
                textDecoration: editFormatting.underline ? "underline" : "none",
                color: editFormatting.color || (data.nodes.find(n => n.id === editingNode)?.color || "#fff"),
                whiteSpace: "pre-wrap",
              }}>
                {editText || "Preview..."}
              </p>
            </div>

            <textarea
              style={{ ...inputStyle, minHeight: 70, resize: "vertical", fontFamily: "inherit", fontSize: "0.85rem" }}
              value={editText}
              onChange={e => setEditText(e.target.value)}
              autoFocus
            />
            <div className="flex gap-2">
              <button
                className="flex-1 py-1.5 rounded-md transition-all hover:brightness-125"
                style={{ background: "rgba(16,185,129,0.2)", color: "#10b981", fontSize: "0.75rem", border: "none", cursor: "pointer" }}
                onClick={saveEdit}
              >
                Save
              </button>
              <button
                className="flex-1 py-1.5 rounded-md transition-all hover:brightness-125"
                style={{ background: "rgba(255,255,255,0.04)", color: "rgba(255,255,255,0.4)", fontSize: "0.75rem", border: "none", cursor: "pointer" }}
                onClick={() => { setEditingNode(null); setEditText(""); setEditFormatting({}); }}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Comment Dialog — 3x larger + fullscreen toggle */}
      {commentTarget && (
        <div className="absolute inset-0 flex items-center justify-center z-50" style={{ background: "rgba(0,0,0,0.6)" }}>
          <div
            className="p-6 rounded-xl flex flex-col gap-4"
            style={{
              ...panelStyle,
              width: commentFullscreen ? "95vw" : 560,
              maxWidth: commentFullscreen ? "95vw" : 560,
              maxHeight: commentFullscreen ? "95vh" : "80vh",
              transition: "all 0.2s ease",
            }}
          >
            <div className="flex items-center justify-between">
              <p style={{ fontSize: "0.9rem", fontWeight: 700, color: "rgba(255,255,255,0.5)", letterSpacing: "0.1em", textTransform: "uppercase" }}>
                Comments: <span style={{ color: data.nodes.find(n => n.id === commentTarget)?.color || "#fff" }}>{commentTarget}</span>
              </p>
              <button
                className="px-2 py-1 rounded transition-all hover:brightness-150"
                style={{ background: "rgba(255,255,255,0.06)", color: "rgba(255,255,255,0.5)", border: "none", cursor: "pointer", fontSize: "0.7rem" }}
                onClick={() => setCommentFullscreen(f => !f)}
                title={commentFullscreen ? "Exit fullscreen" : "Fullscreen"}
              >
                {commentFullscreen ? "Exit Fullscreen" : "Fullscreen"}
              </button>
            </div>
            {/* Existing comments */}
            {(nodeComments[commentTarget] || []).length > 0 && (
              <div className="flex flex-col gap-2 overflow-y-auto" style={{ scrollbarWidth: "thin", maxHeight: commentFullscreen ? "60vh" : 300 }}>
                {(nodeComments[commentTarget] || []).map((c, i) => (
                  <div key={i} className="flex items-start gap-3 px-4 py-3 rounded-lg" style={{ background: "rgba(255,255,255,0.04)" }}>
                    <p style={{ fontSize: "0.9rem", color: "rgba(255,255,255,0.75)", flex: 1, lineHeight: 1.5 }}>{c}</p>
                    <button
                      style={{ fontSize: "0.75rem", color: "rgba(255,255,255,0.3)", background: "none", border: "none", cursor: "pointer", flexShrink: 0, padding: "2px 6px" }}
                      onClick={() => deleteComment(commentTarget, i)}
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>
            )}
            <textarea
              style={{ ...inputStyle, minHeight: 100, resize: "vertical", fontFamily: "inherit", fontSize: "0.9rem", padding: "10px 14px" }}
              placeholder="Write a comment..."
              value={commentText}
              onChange={e => setCommentText(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); saveComment(); } }}
              autoFocus
            />
            <div className="flex gap-3">
              <button
                className="flex-1 py-2 rounded-md transition-all hover:brightness-125"
                style={{ background: "rgba(16,185,129,0.2)", color: "#10b981", fontSize: "0.85rem", border: "none", cursor: "pointer" }}
                onClick={saveComment}
              >
                Add Comment
              </button>
              <button
                className="flex-1 py-2 rounded-md transition-all hover:brightness-125"
                style={{ background: "rgba(255,255,255,0.04)", color: "rgba(255,255,255,0.4)", fontSize: "0.85rem", border: "none", cursor: "pointer" }}
                onClick={() => { setCommentTarget(null); setCommentText(""); setCommentFullscreen(false); }}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Picture Preview Dialog — 3x larger + fullscreen toggle */}
      {pictureTarget && nodeImages[pictureTarget] && (
        <div className="absolute inset-0 flex items-center justify-center z-50" style={{ background: "rgba(0,0,0,0.6)" }}
          onClick={() => { setPictureTarget(null); setPictureFullscreen(false); }}
        >
          <div
            className="p-6 rounded-xl flex flex-col gap-4"
            style={{
              ...panelStyle,
              width: pictureFullscreen ? "95vw" : "auto",
              maxWidth: pictureFullscreen ? "95vw" : 900,
              maxHeight: pictureFullscreen ? "95vh" : "85vh",
              transition: "all 0.2s ease",
            }}
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <p style={{ fontSize: "0.9rem", fontWeight: 700, color: "rgba(255,255,255,0.5)", letterSpacing: "0.1em", textTransform: "uppercase" }}>
                Picture: <span style={{ color: data.nodes.find(n => n.id === pictureTarget)?.color || "#fff" }}>{pictureTarget}</span>
              </p>
              <button
                className="px-2 py-1 rounded transition-all hover:brightness-150"
                style={{ background: "rgba(255,255,255,0.06)", color: "rgba(255,255,255,0.5)", border: "none", cursor: "pointer", fontSize: "0.7rem" }}
                onClick={() => setPictureFullscreen(f => !f)}
                title={pictureFullscreen ? "Exit fullscreen" : "Fullscreen"}
              >
                {pictureFullscreen ? "Exit Fullscreen" : "Fullscreen"}
              </button>
            </div>
            <div className="flex items-center justify-center overflow-auto" style={{ maxHeight: pictureFullscreen ? "80vh" : 700 }}>
              <img
                src={nodeImages[pictureTarget]}
                alt=""
                style={{
                  maxHeight: pictureFullscreen ? "80vh" : 700,
                  maxWidth: "100%",
                  borderRadius: 8,
                  objectFit: "contain",
                }}
              />
            </div>
            <div className="flex gap-3">
              <button
                className="flex-1 py-2 rounded-md transition-all hover:brightness-125"
                style={{ background: "rgba(59,130,246,0.15)", color: "#3b82f6", fontSize: "0.85rem", border: "none", cursor: "pointer" }}
                onClick={() => {
                  setInteractionMode("picture");
                  setPictureTarget(null);
                  setPictureFullscreen(false);
                  // Re-target the same node for replacement
                  const nodeId = pictureTarget;
                  setPictureTarget(nodeId);
                  setTimeout(() => fileInputRef.current?.click(), 50);
                }}
              >
                Replace Picture
              </button>
              <button
                className="flex-1 py-2 rounded-md transition-all hover:brightness-125"
                style={{ background: "rgba(239,68,68,0.15)", color: "#ef4444", fontSize: "0.85rem", border: "none", cursor: "pointer" }}
                onClick={() => { removePicture(pictureTarget); setPictureTarget(null); setPictureFullscreen(false); }}
              >
                Remove Picture
              </button>
              <button
                className="flex-1 py-2 rounded-md transition-all hover:brightness-125"
                style={{ background: "rgba(255,255,255,0.04)", color: "rgba(255,255,255,0.4)", fontSize: "0.85rem", border: "none", cursor: "pointer" }}
                onClick={() => { setPictureTarget(null); setPictureFullscreen(false); }}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Legend */}
      <div className="absolute top-14 right-3 p-3 rounded-xl max-h-[calc(100vh-100px)] overflow-y-auto" style={{ ...panelStyle, scrollbarWidth: "thin" }}>
        <p style={{ fontSize: "0.5rem", fontWeight: 700, letterSpacing: "0.14em", color: "rgba(255,255,255,0.25)", marginBottom: 6, textTransform: "uppercase" }}>
          Clusters
        </p>
        <div className="flex flex-col gap-0.5">
          {clusterList.map(key => {
            const meta = clusterMeta[key] || { name: key, color: "#666" };
            return (
              <button
                key={key}
                className="flex items-center gap-2 px-2 py-1 rounded-md transition-all text-left"
                style={{
                  opacity: selectedCluster && selectedCluster !== key ? 0.2 : 1,
                  background: selectedCluster === key ? "rgba(255,255,255,0.06)" : "transparent",
                }}
                onClick={() => setSelectedCluster(prev => prev === key ? null : key)}
              >
                <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: meta.color, boxShadow: `0 0 6px ${meta.color}40` }} />
                <span style={{ fontSize: "0.6rem", color: "rgba(255,255,255,0.6)" }}>{meta.name}</span>
              </button>
            );
          })}
        </div>
        {selectedCluster && (
          <button
            className="mt-2 w-full text-center py-1 rounded-md"
            style={{ fontSize: "0.5rem", color: "rgba(255,255,255,0.3)", background: "rgba(255,255,255,0.03)", border: "none", cursor: "pointer" }}
            onClick={() => setSelectedCluster(null)}
          >
            Clear filter
          </button>
        )}
      </div>

      {/* Zoom Slider */}
      <div
        className="absolute left-4 flex flex-col items-center gap-1.5"
        style={{ top: "50%", transform: "translateY(-50%)" }}
      >
        <button
          className="w-6 h-6 rounded flex items-center justify-center transition-all hover:brightness-150"
          style={{ background: "rgba(255,255,255,0.06)", color: "rgba(255,255,255,0.5)", border: "none", cursor: "pointer", fontSize: "0.8rem" }}
          onClick={() => { targetZoomRef.current = Math.min(ZOOM_MAX, targetZoomRef.current * 1.5); }}
        >
          +
        </button>
        <div
          className="relative rounded-full"
          style={{ width: 4, height: 180, background: "rgba(255,255,255,0.06)" }}
        >
          {/* Track fill */}
          <div
            className="absolute bottom-0 left-0 w-full rounded-full"
            style={{
              height: `${zoomToSlider(Math.max(ZOOM_MIN, zoomMultiplier)) * 100}%`,
              background: "rgba(16,185,129,0.3)",
            }}
          />
          {/* Thumb */}
          <div
            className="absolute left-1/2 -translate-x-1/2 w-3 h-3 rounded-full"
            style={{
              bottom: `calc(${zoomToSlider(Math.max(ZOOM_MIN, zoomMultiplier)) * 100}% - 6px)`,
              background: "#10b981",
              boxShadow: "0 0 8px rgba(16,185,129,0.5)",
              cursor: "pointer",
            }}
          />
          {/* Invisible input for dragging */}
          <input
            type="range"
            min="0"
            max="1000"
            value={Math.round(zoomToSlider(Math.max(ZOOM_MIN, zoomMultiplier)) * 1000)}
            onChange={e => { targetZoomRef.current = sliderToZoom(Number(e.target.value) / 1000); }}
            className="absolute left-1/2 -translate-x-1/2"
            style={{
              width: 180,
              height: 4,
              transform: "translateX(-50%) rotate(-90deg)",
              transformOrigin: "0 0",
              top: 0,
              left: "50%",
              opacity: 0,
              cursor: "pointer",
              margin: 0,
            }}
          />
        </div>
        <button
          className="w-6 h-6 rounded flex items-center justify-center transition-all hover:brightness-150"
          style={{ background: "rgba(255,255,255,0.06)", color: "rgba(255,255,255,0.5)", border: "none", cursor: "pointer", fontSize: "0.8rem" }}
          onClick={() => { targetZoomRef.current = Math.max(ZOOM_MIN, targetZoomRef.current / 1.5); }}
        >
          -
        </button>
        <span style={{ fontSize: "0.5rem", color: "rgba(255,255,255,0.3)", marginTop: 2 }}>
          {zoomMultiplier < 10 ? zoomMultiplier.toFixed(1) : Math.round(zoomMultiplier)}x
        </span>
      </div>

      {/* Controls */}
      <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex gap-3 pointer-events-none flex-wrap justify-center">
        <span style={{ fontSize: "0.55rem", color: "rgba(255,255,255,0.15)" }}>Drag to rotate</span>
        <span style={{ fontSize: "0.55rem", color: "rgba(255,255,255,0.06)" }}>·</span>
        <span style={{ fontSize: "0.55rem", color: "rgba(255,255,255,0.15)" }}>Shift+drag to pan</span>
        <span style={{ fontSize: "0.55rem", color: "rgba(255,255,255,0.06)" }}>·</span>
        <span style={{ fontSize: "0.55rem", color: "rgba(255,255,255,0.15)" }}>Scroll to zoom (500x max)</span>
        <span style={{ fontSize: "0.55rem", color: "rgba(255,255,255,0.06)" }}>·</span>
        <span style={{ fontSize: "0.55rem", color: "rgba(255,255,255,0.15)" }}>Click to filter</span>
        <span style={{ fontSize: "0.55rem", color: "rgba(255,255,255,0.06)" }}>·</span>
        <span style={{ fontSize: "0.55rem", color: "rgba(255,255,255,0.15)" }}>Double-click to edit</span>
      </div>

      {/* Tooltip */}
      {hovered && !editingNode && !commentTarget && (
        <div
          className="absolute z-40 px-3 py-2.5 rounded-xl"
          style={{
            left: Math.min(hovered.sx + 18, (canvasRef.current?.clientWidth || 800) - 280),
            top: hovered.sy - 14,
            background: "rgba(10,10,18,0.92)",
            backdropFilter: "blur(14px)",
            border: `1px solid ${hovered.node.color}30`,
            boxShadow: `0 4px 24px rgba(0,0,0,0.4), 0 0 12px ${hovered.node.color}15`,
            maxWidth: 300,
            pointerEvents: (nodeImages[hovered.node.id] || nodeComments[hovered.node.id]) ? "auto" : "none",
          }}
        >
          <div className="flex items-center gap-2 mb-1">
            <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: hovered.node.color, boxShadow: `0 0 8px ${hovered.node.color}60` }} />
            <span style={{ fontSize: "0.75rem", fontWeight: 600, color: "rgba(255,255,255,0.9)" }}>
              {hovered.node.label.split("\n")[0]}
            </span>
            {/* Indicators */}
            {nodeImages[hovered.node.id] && (
              <span
                style={{ fontSize: "0.55rem", color: "#3b82f6", cursor: "pointer" }}
                onClick={(e) => { e.stopPropagation(); setPictureTarget(hovered.node.id); }}
              >
                [pic]
              </span>
            )}
            {nodeComments[hovered.node.id] && (
              <span
                style={{ fontSize: "0.55rem", color: "#f59e0b", cursor: "pointer" }}
                onClick={(e) => { e.stopPropagation(); setCommentTarget(hovered.node.id); setCommentText(""); }}
              >
                [{nodeComments[hovered.node.id].length}]
              </span>
            )}
          </div>
          <p style={{ fontSize: "0.6rem", color: hovered.node.color, opacity: 0.7 }}>
            {clusterMeta[hovered.node.cluster]?.name || hovered.node.cluster}
          </p>
          <p style={{ fontSize: "0.5rem", color: "rgba(255,255,255,0.3)", marginTop: 3 }}>
            {hovered.node.type} · {hovered.node.connections.length} connection{hovered.node.connections.length !== 1 ? "s" : ""}
          </p>
          {/* Thumbnail preview */}
          {nodeImages[hovered.node.id] && (
            <img
              src={nodeImages[hovered.node.id]}
              alt=""
              style={{ marginTop: 6, maxHeight: 60, borderRadius: 4, objectFit: "cover", cursor: "pointer", opacity: 0.85 }}
              onClick={(e) => { e.stopPropagation(); setPictureTarget(hovered.node.id); }}
            />
          )}
          {/* Comment preview */}
          {nodeComments[hovered.node.id] && (
            <div style={{ marginTop: 4 }}>
              {nodeComments[hovered.node.id].slice(0, 2).map((c, i) => (
                <p key={i} style={{ fontSize: "0.5rem", color: "rgba(255,255,255,0.45)", fontStyle: "italic" }}>
                  "{c.length > 50 ? c.slice(0, 50) + "…" : c}"
                </p>
              ))}
              {nodeComments[hovered.node.id].length > 2 && (
                <p style={{ fontSize: "0.45rem", color: "rgba(255,255,255,0.25)" }}>+{nodeComments[hovered.node.id].length - 2} more</p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}