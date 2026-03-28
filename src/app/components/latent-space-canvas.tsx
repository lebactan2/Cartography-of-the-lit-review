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

  // Interaction mode: null = normal, "picture" = click node to attach picture, "comment" = click node to add comment, "connect" = click two nodes to create edge, "video" = click node to attach video
  const [interactionMode, setInteractionMode] = useState<"picture" | "comment" | "connect" | "video" | null>(null);
  const [connectSource, setConnectSource] = useState<string | null>(null);

  // Drag-to-connect state
  const dragConnectRef = useRef<{ sourceId: string; sx: number; sy: number } | null>(null);
  const dragConnectMouseRef = useRef<{ x: number; y: number } | null>(null);

  // Node pictures & comments — initialized from localStorage (prefer fullSave)
  const [nodeImages, setNodeImages] = useState<Record<string, string | string[]>>(() => {
    try {
      const full = localStorage.getItem("latentSpace_fullSave");
      if (full) { const d = JSON.parse(full); return d.images || {}; }
      const s = localStorage.getItem("latentSpace_images"); return s ? JSON.parse(s) : {};
    } catch { return {}; }
  });
  const [nodeComments, setNodeComments] = useState<Record<string, string[]>>(() => {
    try {
      const full = localStorage.getItem("latentSpace_fullSave");
      if (full) { const d = JSON.parse(full); return d.comments || {}; }
      const s = localStorage.getItem("latentSpace_comments"); return s ? JSON.parse(s) : {};
    } catch { return {}; }
  });

  // Node videos (Feature 5)
  const [nodeVideos, setNodeVideos] = useState<Record<string, { url: string; thumbnail: string }>>(() => {
    try {
      const full = localStorage.getItem("latentSpace_fullSave");
      if (full) { const d = JSON.parse(full); return d.videos || {}; }
      return {};
    } catch { return {}; }
  });
  const [videoTarget, setVideoTarget] = useState<string | null>(null);
  const [videoUrl, setVideoUrl] = useState("");
  const [videoPlayerNode, setVideoPlayerNode] = useState<string | null>(null);

  // UI scale (Feature 3)
  const [uiScale, setUiScale] = useState(() => {
    try { const s = localStorage.getItem("latentSpace_uiScale"); const v = s ? Number(s) : 1.5; return isNaN(v) ? 1.5 : v; } catch { return 1.5; }
  });
  const [viewMenuOpen, setViewMenuOpen] = useState(false);

  // Background mode (Feature 4)
  const [bgMode, setBgMode] = useState<"normal" | "normalmap" | "white" | "black" | "custom">(() => {
    try { const s = localStorage.getItem("latentSpace_bgMode"); return (s as "normal" | "normalmap" | "white" | "black" | "custom") || "normal"; } catch { return "normal"; }
  });
  const [bgImage, setBgImage] = useState<string>(() => {
    try { return localStorage.getItem("latentSpace_bgImage") || ""; } catch { return ""; }
  });
  const bgImageEl = useRef<HTMLImageElement | null>(null);
  const bgImageElRef = useRef<HTMLImageElement | null>(null);
  const bgModeRef = useRef(bgMode);
  const bgFileInputRef = useRef<HTMLInputElement>(null);

  // Image element cache for canvas thumbnails (Feature 1)
  const imageElCache = useRef<Record<string, HTMLImageElement>>({});

  // Normal map background cache
  const normalMapCache = useRef<HTMLCanvasElement | null>(null);

  // ── Spread animation system ──
  // Tracks which nodes are "open" (visible). Only open nodes are drawn.
  // Double-click a node → expand its connections (animate from parent).
  // Double-click an already-expanded node → collapse its children.
  // Page starts with only central node visible.
  const openNodes = useRef<Set<string>>(new Set());
  const [openNodesVersion, setOpenNodesVersion] = useState(0); // bumped to re-render tree when openNodes changes
  const bumpOpenNodes = useCallback(() => setOpenNodesVersion(v => v + 1), []);
  const expandedNodes = useRef<Set<string>>(new Set()); // nodes whose children have been spread
  // Per-node animation: { from: Vec3, progress: number (0→1), startTime: number, delay: number }
  const nodeAnims = useRef<Record<string, { fromX: number; fromY: number; fromZ: number; startTime: number; delay: number; duration: number; expanding: boolean }>>({});
  // Collapse animation: nodes fading out animate toward their parent
  const collapsingNodes = useRef<Set<string>>(new Set());
  const openNodesInitialized = useRef(false);
  // Double-right-click detection
  const lastRightClickTime = useRef(0);
  const lastRightClickNode = useRef<string | null>(null);

  // Picture/Comment dialog state
  const [pictureTarget, setPictureTarget] = useState<string | null>(null);
  const [pictureFullscreen, setPictureFullscreen] = useState(false);
  const [pictureViewIdx, setPictureViewIdx] = useState(0);
  const [commentTarget, setCommentTarget] = useState<string | null>(null);
  const [commentFullscreen, setCommentFullscreen] = useState(false);
  const [commentText, setCommentText] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const loadFileInputRef = useRef<HTMLInputElement>(null);

  // Text formatting state (for edit modal)
  const [editFormatting, setEditFormatting] = useState<NodeFormatting>({});

  // Edit modal: media state
  const [editVideoUrl, setEditVideoUrl] = useState("");
  const [editCommentText, setEditCommentText] = useState("");
  const editPicInputRef = useRef<HTMLInputElement>(null);
  const [editFullPicIdx, setEditFullPicIdx] = useState<number | null>(null); // full-screen picture index in edit modal
  const editPicDragRef = useRef<number | null>(null); // drag source index for picture reorder

  // Connection management popup (right-click on node in connect mode)
  const [connectionPopup, setConnectionPopup] = useState<{ nodeId: string; x: number; y: number } | null>(null);

  // Toolbar dropdown
  const [menuOpen, setMenuOpen] = useState(false);

  // Tree hierarchy view
  interface TreeCluster { rootId: string; subs: Array<{ nodeId: string; children: string[] }>; ungrouped: string[] }
  const [treeData, setTreeData] = useState<Record<string, TreeCluster>>({});
  const [treeCollapsed, setTreeCollapsed] = useState<Record<string, boolean>>({});
  const treeDragRef = useRef<string | null>(null);
  const [treeDragOver, setTreeDragOver] = useState<string | null>(null);

  // Zoom display (synced from render loop)
  const [zoomMultiplier, setZoomMultiplier] = useState(1);
  const zoomDisplayFrameRef = useRef(0);

  // Mutable data
  const dataRef = useRef(generateLatentSpace3D());
  const data = dataRef.current;

  // Undo/Redo system (up to 3 steps each)
  type Snapshot = { nodes: Array<{ id: string; x: number; y: number; z: number; label: string; connections: string[]; formatting?: NodeFormatting }>; edges: Edge3D[] };
  const undoStack = useRef<Snapshot[]>([]);
  const redoStack = useRef<Snapshot[]>([]);
  const MAX_HISTORY = 3;

  const takeSnapshot = useCallback((): Snapshot => {
    const d = dataRef.current;
    return {
      nodes: d.nodes.map(n => ({ id: n.id, x: n.x, y: n.y, z: n.z, label: n.label, connections: [...n.connections], formatting: n.formatting ? { ...n.formatting } : undefined })),
      edges: d.edges.map(e => ({ ...e })),
    };
  }, []);

  const applySnapshot = useCallback((snap: Snapshot) => {
    const d = dataRef.current;
    for (const sn of snap.nodes) {
      const node = d.nodes.find(n => n.id === sn.id);
      if (node) {
        node.x = sn.x; node.y = sn.y; node.z = sn.z;
        node.label = sn.label;
        node.connections = sn.connections;
        node.formatting = sn.formatting ? { ...sn.formatting } : undefined;
      }
    }
    d.edges.length = 0;
    d.edges.push(...snap.edges);
  }, []);

  const pushUndo = useCallback(() => {
    undoStack.current.push(takeSnapshot());
    if (undoStack.current.length > MAX_HISTORY) undoStack.current.shift();
    redoStack.current = []; // clear redo on new action
  }, [takeSnapshot]);

  const popUndo = useCallback(() => {
    const snap = undoStack.current.pop();
    if (!snap) return;
    redoStack.current.push(takeSnapshot()); // save current state for redo
    if (redoStack.current.length > MAX_HISTORY) redoStack.current.shift();
    applySnapshot(snap);
  }, [takeSnapshot, applySnapshot]);

  const popRedo = useCallback(() => {
    const snap = redoStack.current.pop();
    if (!snap) return;
    undoStack.current.push(takeSnapshot()); // save current state for undo
    if (undoStack.current.length > MAX_HISTORY) undoStack.current.shift();
    applySnapshot(snap);
  }, [takeSnapshot, applySnapshot]);

  // Helper: add an edge between two nodes (no duplicates)
  const addEdge = useCallback((fromId: string, toId: string) => {
    const d = dataRef.current;
    const exists = d.edges.some(e =>
      (e.from === fromId && e.to === toId) || (e.from === toId && e.to === fromId)
    );
    if (exists) return;
    pushUndo();
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
    pushUndo();
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
  const nodeVideosRef = useRef(nodeVideos);
  nodeVideosRef.current = nodeVideos;

  // Sync bgMode ref for render loop
  useEffect(() => { bgModeRef.current = bgMode; }, [bgMode]);

  // Persist bgMode/bgImage/uiScale to localStorage
  useEffect(() => { try { localStorage.setItem("latentSpace_bgMode", bgMode); } catch {} }, [bgMode]);
  useEffect(() => {
    try {
      // Skip localStorage persistence for large images (>2MB) to avoid quota errors
      if (bgImage && bgImage.length > 2 * 1024 * 1024) {
        console.warn("Background image too large for localStorage (>2MB). It will only persist for this session.");
        return;
      }
      localStorage.setItem("latentSpace_bgImage", bgImage);
    } catch (e) {
      console.warn("Failed to persist background image to localStorage:", e);
    }
  }, [bgImage]);
  useEffect(() => { try { localStorage.setItem("latentSpace_uiScale", String(uiScale)); } catch {} }, [uiScale]);

  // Preload background image element
  useEffect(() => {
    if (bgImage && bgMode === "custom") {
      const img = new Image();
      img.onload = () => { bgImageEl.current = img; bgImageElRef.current = img; };
      img.src = bgImage;
    } else {
      bgImageEl.current = null;
      bgImageElRef.current = null;
    }
  }, [bgImage, bgMode]);

  // Preload images from nodeImages and nodeVideos into imageElCache (Feature 1)
  useEffect(() => {
    const cache = imageElCache.current;
    // Preload node images (use first image for thumbnail if array)
    for (const [id, imgVal] of Object.entries(nodeImages)) {
      const firstImg = Array.isArray(imgVal) ? imgVal[0] : imgVal;
      if (firstImg && (!cache[id] || cache[id].src !== firstImg)) {
        const img = new Image();
        img.src = firstImg;
        cache[id] = img;
      }
    }
    // Preload video thumbnails
    for (const [id, vid] of Object.entries(nodeVideos)) {
      const key = `video_${id}`;
      if (vid.thumbnail && (!cache[key] || cache[key].src !== vid.thumbnail)) {
        const img = new Image();
        img.crossOrigin = "anonymous";
        img.src = vid.thumbnail;
        cache[key] = img;
      }
    }
    // Clean removed entries
    for (const key of Object.keys(cache)) {
      if (key.startsWith("video_")) {
        const nodeId = key.slice(6);
        if (!nodeVideos[nodeId]) delete cache[key];
      } else {
        if (!nodeImages[key]) delete cache[key];
      }
    }
  }, [nodeImages, nodeVideos]);

  useEffect(() => { selectedClusterRef.current = selectedCluster; }, [selectedCluster]);

  // ── Keyboard shortcuts ──
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setInteractionMode(null);
        setConnectSource(null);
        dragConnectRef.current = null;
        dragConnectMouseRef.current = null;
        setCommentTarget(null);
        setPictureTarget(null);
        setPictureViewIdx(0);
        setVideoTarget(null);
        setVideoPlayerNode(null);
        setViewMenuOpen(false);
      }
      // Ctrl+Z / Cmd+Z = Undo
      if ((e.ctrlKey || e.metaKey) && e.key === "z" && !e.shiftKey) {
        e.preventDefault();
        popUndo();
      }
      // Ctrl+Shift+Z / Ctrl+Y = Redo
      if ((e.ctrlKey || e.metaKey) && (e.key === "y" || (e.key === "z" && e.shiftKey))) {
        e.preventDefault();
        popRedo();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [popUndo, popRedo]);

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

    const { nodes, edges } = data;
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
      const currentBgMode = bgModeRef.current;
      if (currentBgMode === "white") {
        ctx.fillStyle = "#f5f5f5";
        ctx.fillRect(0, 0, w, h);
      } else if (currentBgMode === "black") {
        ctx.fillStyle = "#000000";
        ctx.fillRect(0, 0, w, h);
      } else if (currentBgMode === "normalmap") {
        // Normal-map color gradient applied to full background
        // Uses the characteristic blue/purple/green normal-map palette
        // Horizontal gradient: purple-ish (left, nx=-1) → blue center (nx=0) → green-ish (right, nx=1)
        // Vertical gradient overlay: green-ish (top, ny=-1) → blue center → pinkish (bottom, ny=1)
        const bgH = ctx.createLinearGradient(0, 0, w, 0);
        bgH.addColorStop(0, "rgb(60, 60, 180)");     // left: purplish-blue
        bgH.addColorStop(0.25, "rgb(80, 100, 220)");
        bgH.addColorStop(0.5, "rgb(128, 128, 255)");  // center: normal-map blue
        bgH.addColorStop(0.75, "rgb(160, 180, 220)");
        bgH.addColorStop(1, "rgb(180, 200, 160)");    // right: greenish
        ctx.fillStyle = bgH;
        ctx.fillRect(0, 0, w, h);
        // Overlay vertical gradient with transparency
        const bgV = ctx.createLinearGradient(0, 0, 0, h);
        bgV.addColorStop(0, "rgba(100, 180, 100, 0.35)");   // top: greenish
        bgV.addColorStop(0.3, "rgba(110, 110, 220, 0.2)");
        bgV.addColorStop(0.5, "rgba(128, 128, 255, 0.15)"); // center: blue
        bgV.addColorStop(0.7, "rgba(180, 100, 180, 0.2)");
        bgV.addColorStop(1, "rgba(200, 100, 140, 0.35)");   // bottom: pinkish
        ctx.fillStyle = bgV;
        ctx.fillRect(0, 0, w, h);
        // Subtle dark vignette overlay
        const vig = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w * 0.7);
        vig.addColorStop(0, "rgba(0,0,0,0)");
        vig.addColorStop(0.7, "rgba(0,0,0,0.1)");
        vig.addColorStop(1, "rgba(0,0,0,0.4)");
        ctx.fillStyle = vig;
        ctx.fillRect(0, 0, w, h);
      } else if (currentBgMode === "custom" && bgImageElRef.current && bgImageElRef.current.complete) {
        ctx.drawImage(bgImageElRef.current, 0, 0, w, h);
      } else {
        const bg = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w * 0.85);
        bg.addColorStop(0, "#0d0d12");
        bg.addColorStop(0.5, "#09090f");
        bg.addColorStop(1, "#050508");
        ctx.fillStyle = bg;
        ctx.fillRect(0, 0, w, h);
      }

      // Adjust wireframe alpha for white background
      const wireAlpha = currentBgMode === "white" ? 0.15 : (currentBgMode === "normalmap" ? 0.06 : 0.03);
      const isBright = currentBgMode === "white" || currentBgMode === "normalmap";

      // ── Faint sphere wireframe ──
      const sphereCenter: Vec3 = { x: 0, y: 0, z: 0 };
      const sc = rotateY(sphereCenter, rY);
      const scr = rotateX(sc, rX);
      const sp = project(scr, w, h, fov, camZ, zoom, pan);
      const sphereScreenR = 320 * sp.scale;

      ctx.beginPath();
      ctx.arc(sp.sx, sp.sy, sphereScreenR, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(${currentBgMode === "white" ? "0,0,0" : "255,255,255"},${wireAlpha})`;
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
        ctx.strokeStyle = `rgba(${currentBgMode === "white" ? "0,0,0" : "255,255,255"},${wireAlpha * 0.67})`;
        ctx.lineWidth = 0.5;
        ctx.stroke();
      }

      // ── EMERGENT CENTRAL EFFECT for human-learning ──
      const centralNode = nodes.find(n => n.type === "central");
      if (centralNode && openNodes.current.has(centralNode.id)) {
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
            ctx.strokeStyle = isBright ? `rgba(0,120,80,${ringAlpha * 2})` : `rgba(16,185,129,${ringAlpha})`;
            ctx.lineWidth = 1.2;
            ctx.stroke();
          }
        }

        // Radiating energy lines to each connected open node
        const connectedNodeIds = centralNode.connections;
        for (const cid of connectedNodeIds) {
          if (!openNodes.current.has(cid) && !collapsingNodes.current.has(cid)) continue;
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

      // ── Open/close node animation system ──
      // Initialize: only central node visible on first frame
      if (!openNodesInitialized.current) {
        openNodesInitialized.current = true;
        const central = nodes.find(n => n.type === "central");
        if (central) openNodes.current.add(central.id);
      }

      // Update per-node animations
      const animFinished: string[] = [];
      for (const [nid, anim] of Object.entries(nodeAnims.current)) {
        const elapsed = t - anim.startTime;
        const nodeElapsed = Math.max(0, elapsed - anim.delay);
        const progress = Math.min(1, nodeElapsed / anim.duration);
        if (progress >= 1) animFinished.push(nid);
      }
      // Clean up finished collapse animations (remove from collapsingNodes)
      for (const nid of animFinished) {
        if (collapsingNodes.current.has(nid)) {
          collapsingNodes.current.delete(nid);
        }
        delete nodeAnims.current[nid];
      }

      type PN = { node: Node3D; sx: number; sy: number; scale: number; depth: number; animAlpha: number };
      const projN: PN[] = [];
      const projMap = new Map<string, PN>();
      for (const node of nodes) {
        const isOpen = openNodes.current.has(node.id);
        const isCollapsing = collapsingNodes.current.has(node.id);
        if (!isOpen && !isCollapsing) continue; // skip invisible nodes

        const anim = nodeAnims.current[node.id];
        let animAlpha = 1;
        let px = node.x, py = node.y, pz = node.z;

        if (anim) {
          const elapsed = t - anim.startTime;
          const nodeElapsed = Math.max(0, elapsed - anim.delay);
          const progress = Math.min(1, nodeElapsed / anim.duration);
          const ease = 1 - Math.pow(1 - progress, 3); // ease-out cubic

          if (anim.expanding) {
            // Animate from parent position to real position
            px = anim.fromX + (node.x - anim.fromX) * ease;
            py = anim.fromY + (node.y - anim.fromY) * ease;
            pz = anim.fromZ + (node.z - anim.fromZ) * ease;
            animAlpha = ease;
          } else {
            // Collapsing: animate from real position to parent position
            px = node.x + (anim.fromX - node.x) * ease;
            py = node.y + (anim.fromY - node.y) * ease;
            pz = node.z + (anim.fromZ - node.z) * ease;
            animAlpha = 1 - ease;
          }
        }

        let pt: Vec3 = { x: px, y: py, z: pz };
        pt = rotateY(pt, rY); pt = rotateX(pt, rX);
        const pr = project(pt, w, h, fov, camZ, zoom, pan);
        const pn: PN = { node, ...pr, animAlpha };
        projN.push(pn);
        projMap.set(node.id, pn);
      }
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

        // Use custom color if node has formatting override, otherwise cluster color
        const fromRgb = hexToRgb(fn.formatting?.color || fn.color);
        const toRgb = hexToRgb(tn.formatting?.color || tn.color);

        let alpha = (edge.isCross ? 0.1 : 0.18) * edge.strength * depthFade * (isBright ? 3 : 1);
        if (isRelevant && sel) alpha *= 3.5;
        if (isDimmed) alpha *= 0.04;
        // Multiply by animation alpha of both nodes
        alpha *= fp.animAlpha * tp.animAlpha;
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
        // Gradient line: from-color to to-color
        const edgeGrad = ctx.createLinearGradient(fp.sx, fp.sy, tp.sx, tp.sy);
        edgeGrad.addColorStop(0, `rgba(${fromRgb[0]},${fromRgb[1]},${fromRgb[2]},${alpha})`);
        edgeGrad.addColorStop(1, `rgba(${toRgb[0]},${toRgb[1]},${toRgb[2]},${alpha})`);
        ctx.strokeStyle = edgeGrad;
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

      // ── Draw nodes ──
      for (const pn of projN) {
        const { node, sx, sy, scale, depth, animAlpha } = pn;
        const depthFade = Math.max(0.12, Math.min(1, 1 - depth / 1200));
        const isClusterSel = sel === node.cluster;
        const isDimmed = sel && !isClusterSel;

        let nodeAlpha = depthFade * animAlpha;
        if (isDimmed) nodeAlpha *= 0.06;
        if (isClusterSel) nodeAlpha = Math.min(1, nodeAlpha * 1.5);
        if (nodeAlpha < 0.02) continue;

        const breath = Math.sin(t * 0.8 + node.x * 0.01 + node.y * 0.01) * 0.06 + 1;
        const size = node.size * scale * breath;
        const rgb = hexToRgb(node.color);

        if (node.type === "central") {
          // Use custom color if set via formatting
          const cFmt = node.formatting;
          const cRgb = (cFmt?.color) ? hexToRgb(cFmt.color) : rgb;

          // Check for thumbnail on central node
          const centralImgData = nodeImagesRef.current[node.id];
          const centralThumbSrc = centralImgData ? (Array.isArray(centralImgData) ? centralImgData[0] : centralImgData) : undefined;
          const centralVidThumb = nodeVideosRef.current[node.id]?.thumbnail;
          const centralCachedImg = centralThumbSrc ? imageElCache.current[node.id] : (centralVidThumb ? imageElCache.current[`video_${node.id}`] : null);
          const centralHasThumb = centralCachedImg && centralCachedImg.complete && centralCachedImg.naturalWidth > 0;

          // Define coreR before if/else so label code can use it
          const pulse = Math.sin(t * 1.5) * 0.15 + 1;
          const coreR = Math.max(4, size * 0.5 * pulse);

          if (centralHasThumb) {
            const thumbR = Math.max(12, size * 0.6);
            const borderColor = cFmt?.color ? cFmt.color : node.color;
            ctx.save();
            ctx.beginPath();
            ctx.arc(sx, sy, thumbR, 0, Math.PI * 2);
            ctx.clip();
            ctx.globalAlpha = nodeAlpha;
            ctx.drawImage(centralCachedImg, sx - thumbR, sy - thumbR, thumbR * 2, thumbR * 2);
            ctx.restore();
            ctx.beginPath();
            ctx.arc(sx, sy, thumbR + 2, 0, Math.PI * 2);
            ctx.strokeStyle = borderColor;
            ctx.lineWidth = 2.5;
            ctx.globalAlpha = nodeAlpha;
            ctx.stroke();
            ctx.globalAlpha = 1;
          } else {
          // Central emergent core

          // Core orb
          const coreGrad = ctx.createRadialGradient(sx, sy, 0, sx, sy, coreR);
          coreGrad.addColorStop(0, `rgba(255,255,255,${nodeAlpha * 0.9})`);
          coreGrad.addColorStop(0.3, `rgba(${cRgb[0]},${cRgb[1]},${cRgb[2]},${nodeAlpha * 0.8})`);
          coreGrad.addColorStop(0.7, `rgba(${cRgb[0]},${cRgb[1]},${cRgb[2]},${nodeAlpha * 0.3})`);
          coreGrad.addColorStop(1, `rgba(${cRgb[0]},${cRgb[1]},${cRgb[2]},0)`);
          ctx.beginPath();
          ctx.arc(sx, sy, coreR, 0, Math.PI * 2);
          ctx.fillStyle = coreGrad;
          ctx.fill();

          // Spinning halo
          ctx.beginPath();
          ctx.arc(sx, sy, coreR * 1.6, 0, Math.PI * 2);
          ctx.strokeStyle = `rgba(${cRgb[0]},${cRgb[1]},${cRgb[2]},${nodeAlpha * 0.25})`;
          ctx.lineWidth = 1;
          ctx.stroke();

          ctx.beginPath();
          ctx.arc(sx, sy, coreR * 2.2, 0, Math.PI * 2);
          ctx.strokeStyle = `rgba(${cRgb[0]},${cRgb[1]},${cRgb[2]},${nodeAlpha * 0.12})`;
          ctx.lineWidth = 0.6;
          ctx.stroke();
          } // end else (no central thumbnail)

          // Label — respect formatting overrides
          if (scale > 0.15) {
            let cFontSize = Math.max(10, 22 * scale);
            let cFontWeight = 700;
            let cIsItalic = false;
            if (cFmt) {
              if (cFmt.fontSize) cFontSize *= cFmt.fontSize;
              if (cFmt.bold !== undefined) cFontWeight = cFmt.bold ? 700 : 400;
              if (cFmt.italic) cIsItalic = true;
            }
            ctx.font = `${cIsItalic ? "italic " : ""}${cFontWeight} ${cFontSize}px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`;
            ctx.textAlign = "center";
            ctx.textBaseline = "top";
            if (isBright && !cFmt?.color) {
              ctx.fillStyle = `rgba(${Math.floor(cRgb[0]*0.5)},${Math.floor(cRgb[1]*0.5)},${Math.floor(cRgb[2]*0.5)},${nodeAlpha * 0.95})`;
            } else {
              ctx.fillStyle = `rgba(${cRgb[0]},${cRgb[1]},${cRgb[2]},${nodeAlpha * 0.95})`;
            }
            ctx.fillText(node.label, sx, sy + coreR + 6);
            if (cFmt?.underline) {
              const tw = ctx.measureText(node.label).width;
              const ulY = sy + coreR + 6 + cFontSize + 1;
              ctx.beginPath();
              ctx.moveTo(sx - tw / 2, ulY);
              ctx.lineTo(sx + tw / 2, ulY);
              ctx.strokeStyle = ctx.fillStyle;
              ctx.lineWidth = 1;
              ctx.stroke();
            }
          }
          continue;
        }

        // ── Image thumbnail on node (Feature 1) ──
        const imgData = nodeImagesRef.current[node.id];
        const thumbSrc = imgData ? (Array.isArray(imgData) ? imgData[0] : imgData) : undefined;
        const videoThumbSrc = nodeVideosRef.current[node.id]?.thumbnail;
        const cachedImg = thumbSrc ? imageElCache.current[node.id] : (videoThumbSrc ? imageElCache.current[`video_${node.id}`] : null);
        if (cachedImg && cachedImg.complete && cachedImg.naturalWidth > 0) {
          const thumbR = Math.max(10, size * 2.5);
          const borderColor = node.formatting?.color || node.color;
          // Draw circular clipped image
          ctx.save();
          ctx.beginPath();
          ctx.arc(sx, sy, thumbR, 0, Math.PI * 2);
          ctx.clip();
          ctx.drawImage(cachedImg, sx - thumbR, sy - thumbR, thumbR * 2, thumbR * 2);
          ctx.restore();
          // Colored border
          ctx.beginPath();
          ctx.arc(sx, sy, thumbR + 1.5, 0, Math.PI * 2);
          ctx.strokeStyle = borderColor;
          ctx.lineWidth = 2;
          ctx.globalAlpha = nodeAlpha;
          ctx.stroke();
          ctx.globalAlpha = 1;
        } else {
        // ── Normal node glow ──
        // Use custom color for dot if set
        const dotRgb = (node.formatting?.color) ? hexToRgb(node.formatting.color) : rgb;
        const glowR = size * 3.5;
        const glow = ctx.createRadialGradient(sx, sy, 0, sx, sy, glowR);
        glow.addColorStop(0, `rgba(${dotRgb[0]},${dotRgb[1]},${dotRgb[2]},${(isBright ? 0.35 : 0.22) * nodeAlpha})`);
        glow.addColorStop(0.4, `rgba(${dotRgb[0]},${dotRgb[1]},${dotRgb[2]},${0.05 * nodeAlpha})`);
        glow.addColorStop(1, `rgba(${dotRgb[0]},${dotRgb[1]},${dotRgb[2]},0)`);
        ctx.beginPath();
        ctx.arc(sx, sy, glowR, 0, Math.PI * 2);
        ctx.fillStyle = glow;
        ctx.fill();

        // Core
        if (node.type !== "question" && node.type !== "item") {
          const coreR = Math.max(1.5, size * 0.45);
          ctx.beginPath();
          ctx.arc(sx, sy, coreR, 0, Math.PI * 2);
          ctx.fillStyle = `rgba(${dotRgb[0]},${dotRgb[1]},${dotRgb[2]},${nodeAlpha * 0.85})`;
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
        } // end else (no image thumbnail)

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

        // High contrast for bright backgrounds
        if (isBright && !fmt?.color) {
          const bRgb = hexToRgb(node.color);
          // Darken color for readability on bright backgrounds
          fillColor = `rgba(${Math.floor(bRgb[0]*0.5)},${Math.floor(bRgb[1]*0.5)},${Math.floor(bRgb[2]*0.5)},${labelAlpha * 0.95})`;
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

        // Draw small indicator dots for picture/comment/video attachments
        const hasImg = nodeImagesRef.current[node.id];
        const hasCmt = nodeCommentsRef.current[node.id];
        const hasVid = nodeVideosRef.current[node.id];
        if (hasImg || hasCmt || hasVid) {
          const indicatorY = textY + (lines.length) * (fontSize * 1.25) + 4;
          const totalIndicators = (hasImg ? 1 : 0) + (hasCmt ? 1 : 0) + (hasVid ? 1 : 0);
          let indicatorX = sx - (totalIndicators > 1 ? (totalIndicators - 1) * 5 : 0);
          if (hasImg) {
            ctx.beginPath();
            ctx.arc(indicatorX, indicatorY, 2.5 * scale + 1, 0, Math.PI * 2);
            ctx.fillStyle = `rgba(59,130,246,${labelAlpha * 0.8})`;
            ctx.fill();
            indicatorX += 10 * scale + 3;
          }
          if (hasVid) {
            ctx.beginPath();
            ctx.arc(indicatorX, indicatorY, 2.5 * scale + 1, 0, Math.PI * 2);
            ctx.fillStyle = `rgba(168,85,247,${labelAlpha * 0.8})`;
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
          if (!openNodes.current.has(node.id)) continue;
          let pt: Vec3 = { x: node.x, y: node.y, z: node.z };
          pt = rotateY(pt, rotYRef.current); pt = rotateX(pt, rotXRef.current);
          const pr = project(pt, w, h, fov, camZ, zoom, pan);
          const dx = mx - pr.sx, dy = my - pr.sy;
          const hitR = Math.max(14, node.size * pr.scale * 2.5);
          if (dx * dx + dy * dy < hitR * hitR) {
            dragConnectRef.current = { sourceId: node.id, sx: pr.sx, sy: pr.sy };
            dragConnectMouseRef.current = { x: mx, y: my };
            return;
          }
        }
      }
    }
    // Alt+Click on a node: start drag-to-connect (works without connect mode)
    if (e.altKey && !e.shiftKey && !e.ctrlKey && !e.metaKey) {
      const canvas = canvasRef.current;
      if (canvas) {
        const rect = canvas.getBoundingClientRect();
        const mx = e.clientX - rect.left, my = e.clientY - rect.top;
        const w = canvas.clientWidth, h = canvas.clientHeight;
        const fov = PERSPECTIVE_FOV, camZ = BASE_CAM_Z, zoom = zoomRef.current, pan = panRef.current;
        for (const node of dataRef.current.nodes) {
          if (!openNodes.current.has(node.id)) continue;
          let pt: Vec3 = { x: node.x, y: node.y, z: node.z };
          pt = rotateY(pt, rotYRef.current); pt = rotateX(pt, rotXRef.current);
          const pr = project(pt, w, h, fov, camZ, zoom, pan);
          const dx = mx - pr.sx, dy = my - pr.sy;
          const hitR = Math.max(14, node.size * pr.scale * 2.5);
          if (dx * dx + dy * dy < hitR * hitR) {
            dragConnectRef.current = { sourceId: node.id, sx: pr.sx, sy: pr.sy };
            dragConnectMouseRef.current = { x: mx, y: my };
            return;
          }
        }
      }
    }
    if (e.shiftKey) {
      isPanning.current = true;
    } else if (!interactionMode) {
      // Ctrl+Click (or Cmd+Click): drag a node
      if (e.ctrlKey || e.metaKey) {
        const canvas = canvasRef.current;
        if (canvas) {
          const rect = canvas.getBoundingClientRect();
          const mx = e.clientX - rect.left, my = e.clientY - rect.top;
          const w = canvas.clientWidth, h = canvas.clientHeight;
          const fov = PERSPECTIVE_FOV, camZ = BASE_CAM_Z, zoom = zoomRef.current, pan = panRef.current;
          for (const node of dataRef.current.nodes) {
            if (!openNodes.current.has(node.id)) continue;
            let pt: Vec3 = { x: node.x, y: node.y, z: node.z };
            pt = rotateY(pt, rotYRef.current); pt = rotateX(pt, rotXRef.current);
            const pr = project(pt, w, h, fov, camZ, zoom, pan);
            const dx = mx - pr.sx, dy = my - pr.sy;
            const hitR = Math.max(14, node.size * pr.scale * 2.5);
            if (dx * dx + dy * dy < hitR * hitR) {
              pushUndo();
              draggingNodeRef.current = node.id;
              didDragNode.current = false;
              lastMouse.current = { x: e.clientX, y: e.clientY };
              autoRotate.current = false;
              if (autoTimer.current) clearTimeout(autoTimer.current);
              return;
            }
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
      if (!openNodes.current.has(node.id)) continue;
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
        if (!openNodes.current.has(node.id)) continue;
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
      if (!openNodes.current.has(node.id)) continue; // only interact with visible nodes
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
        if (interactionMode === "video") {
          setVideoTarget(node.id);
          setVideoUrl("");
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
    setMenuOpen(false);
  }, [data.nodes, interactionMode, connectSource]);

  const handleDoubleClick = useCallback((e: React.MouseEvent) => {
    if (!canvasRef.current) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const mx = e.clientX - rect.left, my = e.clientY - rect.top;
    const w = canvasRef.current.clientWidth, h = canvasRef.current.clientHeight;
    const fov = PERSPECTIVE_FOV, camZ = BASE_CAM_Z, zoom = zoomRef.current, pan = panRef.current;

    for (const node of data.nodes) {
      if (!openNodes.current.has(node.id)) continue; // only hit-test visible nodes
      let pt: Vec3 = { x: node.x, y: node.y, z: node.z };
      pt = rotateY(pt, rotYRef.current); pt = rotateX(pt, rotXRef.current);
      const pr = project(pt, w, h, fov, camZ, zoom, pan);
      const dx = mx - pr.sx, dy = my - pr.sy;
      const hitR = Math.max(18, node.size * pr.scale * 3);
      if (dx * dx + dy * dy < hitR * hitR) {
        if (expandedNodes.current.has(node.id)) {
          // Already expanded → collapse: hide all children that were expanded from this node
          const toCollapse: string[] = [];
          const collectChildren = (parentId: string) => {
            const parent = data.nodes.find(n => n.id === parentId);
            if (!parent) return;
            for (const connId of parent.connections) {
              if (connId === node.id) continue; // don't collapse back to the clicked node
              if (openNodes.current.has(connId) && connId !== node.id) {
                // Only collapse if this node was a child (not a separately opened root)
                toCollapse.push(connId);
                // Also collapse children of children recursively
                if (expandedNodes.current.has(connId)) {
                  expandedNodes.current.delete(connId);
                  collectChildren(connId);
                }
              }
            }
          };
          collectChildren(node.id);
          expandedNodes.current.delete(node.id);
          const t = timeRef.current;
          for (const cid of toCollapse) {
            openNodes.current.delete(cid);
            expandedNodes.current.delete(cid);
            collapsingNodes.current.add(cid);
            nodeAnims.current[cid] = {
              fromX: node.x, fromY: node.y, fromZ: node.z,
              startTime: t, delay: 0, duration: 0.6, expanding: false,
            };
          }
          bumpOpenNodes();
        } else {
          // Not expanded → expand: show connected nodes with animation
          expandedNodes.current.add(node.id);
          const t = timeRef.current;
          let delayIdx = 0;
          for (const connId of node.connections) {
            if (openNodes.current.has(connId)) continue; // already visible
            openNodes.current.add(connId);
            nodeAnims.current[connId] = {
              fromX: node.x, fromY: node.y, fromZ: node.z,
              startTime: t, delay: delayIdx * 0.08, duration: 1.0, expanding: true,
            };
            delayIdx++;
          }
          bumpOpenNodes();
        }
        return;
      }
    }
    // Double-click empty space → do nothing
  }, [data.nodes, bumpOpenNodes]);

  // Right-click: single = context menu, double = edit dialog
  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    if (!canvasRef.current) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const mx = e.clientX - rect.left, my = e.clientY - rect.top;
    const w = canvasRef.current.clientWidth, h = canvasRef.current.clientHeight;
    const fov = PERSPECTIVE_FOV, camZ = BASE_CAM_Z, zoom = zoomRef.current, pan = panRef.current;
    const now = Date.now();

    for (const node of data.nodes) {
      if (!openNodes.current.has(node.id)) continue;
      let pt: Vec3 = { x: node.x, y: node.y, z: node.z };
      pt = rotateY(pt, rotYRef.current); pt = rotateX(pt, rotXRef.current);
      const pr = project(pt, w, h, fov, camZ, zoom, pan);
      const dx = mx - pr.sx, dy = my - pr.sy;
      const hitR = Math.max(14, node.size * pr.scale * 2.5);
      if (dx * dx + dy * dy < hitR * hitR) {
        // Check for double-right-click (within 400ms on same node)
        if (lastRightClickNode.current === node.id && now - lastRightClickTime.current < 400) {
          // Double-right-click → open edit dialog
          lastRightClickTime.current = 0;
          lastRightClickNode.current = null;
          setConnectionPopup(null);
          setEditingNode(node.id);
          setEditText(node.label);
          setEditFormatting(node.formatting || {});
          setEditVideoUrl("");
          setEditCommentText("");
        } else {
          // Single right-click → context menu
          lastRightClickTime.current = now;
          lastRightClickNode.current = node.id;
          setConnectionPopup({ nodeId: node.id, x: e.clientX - rect.left, y: e.clientY - rect.top });
        }
        return;
      }
    }
    lastRightClickTime.current = 0;
    lastRightClickNode.current = null;
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
    pushUndo();
    const node = data.nodes.find(n => n.id === editingNode);
    if (node && editText.trim()) {
      node.label = editText.trim();
      node.formatting = { ...editFormatting };
    }
    setEditingNode(null);
    setEditText("");
    setEditFormatting({});
    setEditVideoUrl("");
    setEditCommentText("");
    setEditFullPicIdx(null);
    // Persist formatting to localStorage
    setTimeout(() => persistFormatting(), 0);
  }, [editingNode, editText, editFormatting, data.nodes, persistFormatting]);

  // Add node
  const addNode = useCallback(() => {
    if (!newNodeLabel.trim()) return;
    pushUndo();
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

  const deleteNode = useCallback((nodeId: string) => {
    pushUndo();
    const d = dataRef.current;
    // Remove all edges involving this node
    d.edges = d.edges.filter(e => e.from !== nodeId && e.to !== nodeId);
    // Remove from other nodes' connections
    for (const n of d.nodes) {
      n.connections = n.connections.filter(c => c !== nodeId);
    }
    // Remove the node itself
    const idx = d.nodes.findIndex(n => n.id === nodeId);
    if (idx !== -1) d.nodes.splice(idx, 1);
    // Remove from images, comments, videos
    setNodeImages(prev => { const next = { ...prev }; delete next[nodeId]; return next; });
    setNodeComments(prev => { const next = { ...prev }; delete next[nodeId]; return next; });
    setNodeVideos(prev => { const next = { ...prev }; delete next[nodeId]; return next; });
    // Remove from tree
    setTreeData(prev => {
      const next: Record<string, any> = JSON.parse(JSON.stringify(prev));
      for (const [ck, cl] of Object.entries(next) as any) {
        if (cl.rootId === nodeId) { delete next[ck]; continue; }
        cl.ungrouped = cl.ungrouped.filter((id: string) => id !== nodeId);
        for (const sub of cl.subs) {
          sub.children = sub.children.filter((id: string) => id !== nodeId);
        }
        cl.subs = cl.subs.filter((s: any) => s.nodeId !== nodeId);
      }
      return next;
    });
  }, [pushUndo]);

  // Helper: upload a file to local server (saves to public/uploads/) and return URL
  // Falls back to data URL if server is not available
  const uploadFile = useCallback(async (file: File): Promise<string> => {
    try {
      const dataUrl = await new Promise<string>((resolve) => {
        const reader = new FileReader();
        reader.onload = (ev) => resolve(ev.target?.result as string);
        reader.readAsDataURL(file);
      });
      const resp = await fetch("/api/upload", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dataUrl, filename: file.name }),
      });
      if (resp.ok) {
        const { url } = await resp.json();
        return url; // e.g. "/uploads/image_123456.png"
      }
      return dataUrl; // fallback
    } catch {
      // Fallback to data URL if server endpoint not available
      return new Promise<string>((resolve) => {
        const reader = new FileReader();
        reader.onload = (ev) => resolve(ev.target?.result as string);
        reader.readAsDataURL(file);
      });
    }
  }, []);

  // Handle file selection for picture attachment
  const handleFileSelect = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !pictureTarget) return;
    const url = await uploadFile(file);
    setNodeImages(prev => {
      const existing = prev[pictureTarget!];
      const arr = existing ? (Array.isArray(existing) ? [...existing] : [existing]) : [];
      arr.push(url);
      return { ...prev, [pictureTarget!]: arr };
    });
    setPictureTarget(null);
    e.target.value = "";
  }, [pictureTarget, uploadFile]);

  // Handle file selection for edit modal picture upload
  const handleEditPicSelect = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !editingNode) return;
    const url = await uploadFile(file);
    setNodeImages(prev => {
      const existing = prev[editingNode!];
      const arr = existing ? (Array.isArray(existing) ? [...existing] : [existing]) : [];
      arr.push(url);
      return { ...prev, [editingNode!]: arr };
    });
    e.target.value = "";
  }, [editingNode, uploadFile]);

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
  // Save full state to localStorage
  const saveState = useCallback(() => {
    const formatting: Record<string, NodeFormatting> = {};
    const positions: Record<string, { x: number; y: number; z: number }> = {};
    for (const node of data.nodes) {
      if (node.formatting && Object.keys(node.formatting).length > 0) {
        formatting[node.id] = node.formatting;
      }
      positions[node.id] = { x: node.x, y: node.y, z: node.z };
    }
    const saveData = {
      version: 5,
      savedAt: new Date().toISOString(),
      images: nodeImages,
      comments: nodeComments,
      videos: nodeVideos,
      formatting,
      positions,
      edges: data.edges.map(e => ({ from: e.from, to: e.to, strength: e.strength, isCross: e.isCross })),
      tree: treeData,
      openNodeIds: Array.from(openNodes.current),
      expandedNodeIds: Array.from(expandedNodes.current),
    };
    localStorage.setItem("latentSpace_fullSave", JSON.stringify(saveData));
  }, [nodeImages, nodeComments, nodeVideos, data.nodes, data.edges, treeData]);

  // Export full state to a downloadable JSON file
  const saveAsFile = useCallback(() => {
    const formatting: Record<string, NodeFormatting> = {};
    const positions: Record<string, { x: number; y: number; z: number }> = {};
    for (const node of data.nodes) {
      if (node.formatting && Object.keys(node.formatting).length > 0) formatting[node.id] = node.formatting;
      positions[node.id] = { x: node.x, y: node.y, z: node.z };
    }
    const saveData = {
      version: 5,
      savedAt: new Date().toISOString(),
      images: nodeImages,
      comments: nodeComments,
      videos: nodeVideos,
      formatting,
      positions,
      edges: data.edges.map(e => ({ from: e.from, to: e.to, strength: e.strength, isCross: e.isCross })),
      tree: treeData,
      openNodeIds: Array.from(openNodes.current),
      expandedNodeIds: Array.from(expandedNodes.current),
    };
    const blob = new Blob([JSON.stringify(saveData, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `latent-space-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [nodeImages, nodeComments, nodeVideos, data.nodes, data.edges, treeData]);

  // Debounced auto-save whenever significant data changes (Feature 2)
  useEffect(() => {
    const timer = setTimeout(() => { saveState(); }, 2000);
    return () => clearTimeout(timer);
  }, [nodeImages, nodeComments, nodeVideos, treeData, saveState]);

  // Load full state from localStorage on mount
  useEffect(() => {
    try {
      const raw = localStorage.getItem("latentSpace_fullSave");
      if (!raw) return;
      const saveData = JSON.parse(raw);
      if (saveData.images) setNodeImages(saveData.images);
      if (saveData.comments) setNodeComments(saveData.comments);
      if (saveData.videos) setNodeVideos(saveData.videos);
      if (saveData.formatting) {
        for (const node of data.nodes) {
          if (saveData.formatting[node.id]) node.formatting = saveData.formatting[node.id];
        }
      }
      if (saveData.positions) {
        for (const node of data.nodes) {
          const pos = saveData.positions[node.id];
          if (pos) { node.x = pos.x; node.y = pos.y; node.z = pos.z; }
        }
      }
      if (saveData.edges) {
        data.edges.length = 0;
        for (const e of saveData.edges) {
          data.edges.push(e);
        }
        // Rebuild connections arrays
        for (const node of data.nodes) node.connections = [];
        for (const e of data.edges) {
          const fn = data.nodes.find(n => n.id === e.from);
          const tn = data.nodes.find(n => n.id === e.to);
          if (fn && !fn.connections.includes(e.to)) fn.connections.push(e.to);
          if (tn && !tn.connections.includes(e.from)) tn.connections.push(e.from);
        }
      }
      if (saveData.tree && Object.keys(saveData.tree).length > 0) {
        setTreeData(saveData.tree);
      }
      // Restore open/expanded node state
      if (saveData.openNodeIds && Array.isArray(saveData.openNodeIds)) {
        openNodes.current = new Set(saveData.openNodeIds);
        openNodesInitialized.current = true;
        bumpOpenNodes();
      }
      if (saveData.expandedNodeIds && Array.isArray(saveData.expandedNodeIds)) {
        expandedNodes.current = new Set(saveData.expandedNodeIds);
      }
    } catch { /* ignore corrupt data */ }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Load data from a JSON file (import)
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
            if (saveData.formatting[node.id]) node.formatting = saveData.formatting[node.id];
          }
        }
        if (saveData.positions) {
          for (const node of data.nodes) {
            const pos = saveData.positions[node.id];
            if (pos) { node.x = pos.x; node.y = pos.y; node.z = pos.z; }
          }
        }
        if (saveData.edges) {
          data.edges.length = 0;
          for (const e of saveData.edges) data.edges.push(e);
          for (const node of data.nodes) node.connections = [];
          for (const e of data.edges) {
            const fn = data.nodes.find(n => n.id === e.from);
            const tn = data.nodes.find(n => n.id === e.to);
            if (fn && !fn.connections.includes(e.to)) fn.connections.push(e.to);
            if (tn && !tn.connections.includes(e.from)) tn.connections.push(e.from);
          }
        }
      } catch { /* invalid file */ }
    };
    reader.readAsText(file);
    e.target.value = "";
  }, [data.nodes, data.edges]);

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

  // Build tree hierarchy from data
  const buildTree = useCallback((): Record<string, TreeCluster> => {
    const tree: Record<string, TreeCluster> = {};
    const nodesByCluster: Record<string, Node3D[]> = {};
    for (const node of data.nodes) {
      if (!nodesByCluster[node.cluster]) nodesByCluster[node.cluster] = [];
      nodesByCluster[node.cluster].push(node);
    }
    for (const [ck, nodes] of Object.entries(nodesByCluster)) {
      const root = nodes.find(n => n.type === "header" || n.type === "central")
        || nodes.reduce((a, b) => a.connections.length >= b.connections.length ? a : b);
      const assigned = new Set([root.id]);
      const subs: Array<{ nodeId: string; children: string[] }> = [];
      // Direct children of root within cluster = subs
      const subCandidates = nodes.filter(n => !assigned.has(n.id) && root.connections.includes(n.id));
      for (const sub of subCandidates) {
        assigned.add(sub.id);
        const children = nodes
          .filter(n => !assigned.has(n.id) && sub.connections.includes(n.id))
          .map(n => { assigned.add(n.id); return n.id; });
        subs.push({ nodeId: sub.id, children });
      }
      const ungrouped = nodes.filter(n => !assigned.has(n.id)).map(n => n.id);
      tree[ck] = { rootId: root.id, subs, ungrouped };
    }
    return tree;
  }, [data.nodes]);

  // Initialize tree on mount
  useEffect(() => {
    // Try loading saved tree from localStorage
    try {
      const raw = localStorage.getItem("latentSpace_tree");
      if (raw) {
        const saved = JSON.parse(raw) as Record<string, TreeCluster>;
        // Validate that saved tree has valid node IDs
        const allIds = new Set(data.nodes.map(n => n.id));
        let valid = true;
        for (const cl of Object.values(saved)) {
          if (!allIds.has(cl.rootId)) { valid = false; break; }
          for (const sub of cl.subs) {
            if (!allIds.has(sub.nodeId)) { valid = false; break; }
            for (const cid of sub.children) { if (!allIds.has(cid)) { valid = false; break; } }
          }
          for (const uid of cl.ungrouped) { if (!allIds.has(uid)) { valid = false; break; } }
        }
        if (valid && Object.keys(saved).length > 0) { setTreeData(saved); return; }
      }
    } catch { /* ignore */ }
    setTreeData(buildTree());
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Save tree to localStorage whenever it changes
  useEffect(() => {
    if (Object.keys(treeData).length === 0) return;
    try { localStorage.setItem("latentSpace_tree", JSON.stringify(treeData)); }
    catch { /* ignore */ }
  }, [treeData]);

  // Tree drag-drop handlers
  const handleTreeDragStart = useCallback((e: React.DragEvent, nodeId: string) => {
    treeDragRef.current = nodeId;
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", nodeId);
  }, []);

  const handleTreeDragOverFn = useCallback((e: React.DragEvent, targetId: string) => {
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = "move";
    setTreeDragOver(targetId);
  }, []);

  const handleTreeDragLeave = useCallback(() => {
    setTreeDragOver(null);
  }, []);

  // Drop: move dragged node into target's scope
  // dropLevel: "cluster" = add as sub of that cluster, "sub" = add as child of that sub, "sibling" = add as sibling child
  const handleTreeDrop = useCallback((e: React.DragEvent, targetId: string, dropLevel: "cluster" | "sub" | "sibling", targetCluster: string, parentSubId?: string) => {
    e.preventDefault();
    e.stopPropagation();
    setTreeDragOver(null);
    const draggedId = treeDragRef.current;
    treeDragRef.current = null;
    if (!draggedId || draggedId === targetId) return;

    pushUndo();

    setTreeData(prev => {
      const next: Record<string, TreeCluster> = JSON.parse(JSON.stringify(prev));

      // Check if dragged node is a cluster root
      let sourceClusterKey: string | null = null;
      let sourceClusterData: TreeCluster | null = null;
      for (const [ck, cl] of Object.entries(next)) {
        if (cl.rootId === draggedId) {
          sourceClusterKey = ck;
          sourceClusterData = cl;
          break;
        }
      }

      if (sourceClusterKey && sourceClusterData && sourceClusterKey !== targetCluster) {
        // Merge entire source cluster into target as a sub
        const tc = next[targetCluster];
        if (!tc) return prev;
        // Collect all children from the source cluster
        const allChildren: string[] = [];
        for (const sub of sourceClusterData.subs) {
          allChildren.push(sub.nodeId);
          allChildren.push(...sub.children);
        }
        allChildren.push(...sourceClusterData.ungrouped);
        tc.subs.push({ nodeId: draggedId, children: allChildren });
        // Remove source cluster
        delete next[sourceClusterKey];
        // Update node colors/clusters
        const targetMeta = clusterMeta[targetCluster];
        const targetColor = targetMeta?.color || "#666";
        const allNodeIds = [draggedId, ...allChildren];
        for (const nid of allNodeIds) {
          const node = data.nodes.find(n => n.id === nid);
          if (node) {
            node.cluster = targetCluster;
            node.color = targetColor;
            node.formatting = { ...node.formatting, color: targetColor };
          }
        }
        return next;
      }

      // Remove dragged node from its current position
      let removedChildren: string[] = [];
      for (const cluster of Object.values(next)) {
        cluster.ungrouped = cluster.ungrouped.filter(id => id !== draggedId);
        for (const sub of cluster.subs) {
          sub.children = sub.children.filter(id => id !== draggedId);
        }
        // If dragged node was a sub, collect its children and move them to ungrouped
        const subIdx = cluster.subs.findIndex(s => s.nodeId === draggedId);
        if (subIdx !== -1) {
          removedChildren = cluster.subs[subIdx].children;
          cluster.subs.splice(subIdx, 1);
          cluster.ungrouped.push(...removedChildren);
        }
      }

      const tc = next[targetCluster];
      if (!tc) return prev;

      if (dropLevel === "cluster") {
        // Add as a new sub of this cluster
        tc.subs.push({ nodeId: draggedId, children: [] });
        // Apply underline formatting
        const node = data.nodes.find(n => n.id === draggedId);
        if (node) node.formatting = { ...node.formatting, underline: true, bold: false };
      } else if (dropLevel === "sub") {
        // Add as child of the target sub
        const sub = tc.subs.find(s => s.nodeId === targetId);
        if (sub) sub.children.push(draggedId);
        // Normal formatting
        const node = data.nodes.find(n => n.id === draggedId);
        if (node) node.formatting = { ...node.formatting, underline: false, bold: false };
      } else if (dropLevel === "sibling" && parentSubId) {
        // Add as sibling: child of the same parent sub
        const sub = tc.subs.find(s => s.nodeId === parentSubId);
        if (sub) {
          const idx = sub.children.indexOf(targetId);
          if (idx !== -1) sub.children.splice(idx + 1, 0, draggedId);
          else sub.children.push(draggedId);
        }
        const node = data.nodes.find(n => n.id === draggedId);
        if (node) node.formatting = { ...node.formatting, underline: false, bold: false };
      }

      return next;
    });
    // Persist formatting
    setTimeout(() => persistFormatting(), 0);
  }, [data.nodes, pushUndo, persistFormatting, clusterMeta]);

  // Find cluster key for a node
  const findNodeCluster = useCallback((nodeId: string): string => {
    for (const [ck, cluster] of Object.entries(treeData)) {
      if (cluster.rootId === nodeId) return ck;
      for (const sub of cluster.subs) {
        if (sub.nodeId === nodeId) return ck;
        if (sub.children.includes(nodeId)) return ck;
      }
      if (cluster.ungrouped.includes(nodeId)) return ck;
    }
    const node = data.nodes.find(n => n.id === nodeId);
    return node?.cluster || "";
  }, [treeData, data.nodes]);

  // UI scale helper (Feature 3)
  const uiFs = (base: number) => base * uiScale + "rem";

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
        <h1 style={{ fontSize: uiFs(1.1), fontWeight: 700, color: "rgba(255,255,255,0.85)", letterSpacing: "0.06em", textTransform: "uppercase" }}>
          Cartography of the Lit. Review
        </h1>
        <p style={{ fontSize: uiFs(0.5), color: "rgba(255,255,255,0.18)", marginTop: 1, letterSpacing: "0.15em" }}>
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
      <input
        ref={editPicInputRef}
        type="file"
        accept="image/*"
        style={{ display: "none" }}
        onChange={handleEditPicSelect}
      />
      <input
        ref={bgFileInputRef}
        type="file"
        accept="image/*"
        style={{ display: "none" }}
        onChange={async (e) => {
          const file = e.target.files?.[0];
          if (!file) return;
          const url = await uploadFile(file);
          setBgImage(url);
          setBgMode("custom");
          e.target.value = "";
        }}
      />

      {/* Top-left menu */}
      <div className="absolute top-4 left-4 z-40">
        <div className="flex gap-1.5">
        <button
          className="px-3 py-1.5 rounded-lg transition-all hover:brightness-125 flex items-center gap-1.5"
          style={{ ...panelStyle, fontSize: uiFs(0.7), color: "rgba(255,255,255,0.7)", cursor: "pointer" }}
          onClick={() => { setMenuOpen(v => !v); setViewMenuOpen(false); }}
        >
          <span style={{ fontSize: uiFs(0.85) }}>{menuOpen ? "✕" : "☰"}</span> Menu
        </button>
        <button
          className="px-3 py-1.5 rounded-lg transition-all hover:brightness-125 flex items-center gap-1.5"
          style={{ ...panelStyle, fontSize: uiFs(0.7), color: viewMenuOpen ? "#10b981" : "rgba(255,255,255,0.7)", cursor: "pointer" }}
          onClick={() => { setViewMenuOpen(v => !v); setMenuOpen(false); }}
        >
          View
        </button>
        </div>
        {menuOpen && (
          <div
            className="mt-1 rounded-xl py-1 flex flex-col"
            style={{ ...panelStyle, minWidth: 180, borderColor: "rgba(255,255,255,0.1)" }}
          >
            {([
              { label: "+ Add Node", action: () => { setShowAddForm(!showAddForm); setMenuOpen(false); }, color: "rgba(255,255,255,0.6)" },
              { label: "Attach Picture", action: () => { setInteractionMode(prev => prev === "picture" ? null : "picture"); setMenuOpen(false); }, color: interactionMode === "picture" ? "#10b981" : "rgba(255,255,255,0.6)" },
              { label: "Add Comment", action: () => { setInteractionMode(prev => prev === "comment" ? null : "comment"); setMenuOpen(false); }, color: interactionMode === "comment" ? "#10b981" : "rgba(255,255,255,0.6)" },
              { label: "Attach Video", action: () => { setInteractionMode(prev => prev === "video" ? null : "video"); setMenuOpen(false); }, color: interactionMode === "video" ? "#10b981" : "rgba(255,255,255,0.6)" },
              { label: "Connect Nodes", action: () => { setInteractionMode(prev => prev === "connect" ? null : "connect"); setConnectSource(null); setMenuOpen(false); }, color: interactionMode === "connect" ? "#10b981" : "rgba(255,255,255,0.6)" },
              null, // separator
              { label: "Save", action: () => { saveState(); setMenuOpen(false); }, color: "#3b82f6" },
              { label: "Save As…", action: () => { saveAsFile(); setMenuOpen(false); }, color: "#3b82f6" },
              { label: "Import from File", action: () => { loadFileInputRef.current?.click(); setMenuOpen(false); }, color: "rgba(255,255,255,0.5)" },
              null,
              { label: "Undo  (Ctrl+Z)", action: () => { popUndo(); setMenuOpen(false); }, color: "rgba(255,255,255,0.5)" },
              { label: "Redo  (Ctrl+Y)", action: () => { popRedo(); setMenuOpen(false); }, color: "rgba(255,255,255,0.5)" },
            ] as Array<{ label: string; action: () => void; color: string } | null>).map((item, i) =>
              item === null ? (
                <div key={`sep-${i}`} style={{ height: 1, background: "rgba(255,255,255,0.06)", margin: "2px 8px" }} />
              ) : (
                <button
                  key={item.label}
                  className="px-4 py-1.5 text-left transition-all hover:brightness-150"
                  style={{ background: "transparent", border: "none", fontSize: uiFs(0.65), color: item.color, cursor: "pointer" }}
                  onClick={item.action}
                >
                  {item.label}
                </button>
              )
            )}
          </div>
        )}
        {/* View menu dropdown (Feature 3 & 4) */}
        {viewMenuOpen && (
          <div
            className="mt-1 rounded-xl py-2 px-3 flex flex-col gap-2"
            style={{ ...panelStyle, minWidth: 200, borderColor: "rgba(255,255,255,0.1)" }}
          >
            <p style={{ fontSize: uiFs(0.55), fontWeight: 700, color: "rgba(255,255,255,0.35)", letterSpacing: "0.1em", textTransform: "uppercase" }}>
              UI Text Size ({uiScale.toFixed(1)}x)
            </p>
            <div className="flex gap-1">
              <button
                className="px-2 py-1 rounded transition-all hover:brightness-150"
                style={{ background: "rgba(255,255,255,0.06)", color: "rgba(255,255,255,0.6)", border: "none", cursor: "pointer", fontSize: uiFs(0.6) }}
                onClick={() => setUiScale(s => Math.max(0.5, Math.round((s - 0.1) * 10) / 10))}
              >
                A-
              </button>
              <button
                className="px-2 py-1 rounded transition-all hover:brightness-150"
                style={{ background: "rgba(255,255,255,0.06)", color: "rgba(255,255,255,0.6)", border: "none", cursor: "pointer", fontSize: uiFs(0.6) }}
                onClick={() => setUiScale(s => Math.min(4.0, Math.round((s + 0.1) * 10) / 10))}
              >
                A+
              </button>
              <button
                className="px-2 py-1 rounded transition-all hover:brightness-150"
                style={{ background: "rgba(255,255,255,0.06)", color: "rgba(255,255,255,0.5)", border: "none", cursor: "pointer", fontSize: uiFs(0.55) }}
                onClick={() => setUiScale(1.5)}
              >
                Reset
              </button>
            </div>
            <div style={{ height: 1, background: "rgba(255,255,255,0.06)", margin: "2px 0" }} />
            <p style={{ fontSize: uiFs(0.55), fontWeight: 700, color: "rgba(255,255,255,0.35)", letterSpacing: "0.1em", textTransform: "uppercase" }}>
              Background
            </p>
            <div className="flex gap-1 flex-wrap">
              {(["normal", "normalmap", "white", "black"] as const).map(mode => (
                <button
                  key={mode}
                  className="px-2 py-1 rounded transition-all hover:brightness-150"
                  style={{
                    background: bgMode === mode ? "rgba(16,185,129,0.25)" : "rgba(255,255,255,0.06)",
                    color: bgMode === mode ? "#10b981" : "rgba(255,255,255,0.6)",
                    border: "none", cursor: "pointer", fontSize: uiFs(0.55),
                  }}
                  onClick={() => setBgMode(mode)}
                >
                  {mode === "normalmap" ? "Normal Map" : mode.charAt(0).toUpperCase() + mode.slice(1)}
                </button>
              ))}
              <button
                className="px-2 py-1 rounded transition-all hover:brightness-150"
                style={{
                  background: bgMode === "custom" ? "rgba(16,185,129,0.25)" : "rgba(255,255,255,0.06)",
                  color: bgMode === "custom" ? "#10b981" : "rgba(255,255,255,0.6)",
                  border: "none", cursor: "pointer", fontSize: uiFs(0.55),
                }}
                onClick={() => bgFileInputRef.current?.click()}
              >
                Upload Image
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Mode indicator */}
      {interactionMode && (
        <div
          className="absolute top-14 left-1/2 -translate-x-1/2 px-4 py-2 rounded-lg pointer-events-none"
          style={{ ...panelStyle, borderColor: "rgba(16,185,129,0.3)" }}
        >
          <p style={{ fontSize: uiFs(0.7), color: "#10b981", textAlign: "center" }}>
            {interactionMode === "picture" ? "Click a node to attach a picture"
              : interactionMode === "video" ? "Click a node to attach a video"
              : interactionMode === "comment" ? "Click a node to add a comment"
              : connectSource ? `Now click a second node to connect to "${connectSource}"`
              : "Click a node to start, then click another to connect — or drag from one node to another"}
          </p>
          <p style={{ fontSize: uiFs(0.5), color: "rgba(255,255,255,0.3)", textAlign: "center", marginTop: 2 }}>
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
            className="absolute z-50 p-2 rounded-xl flex flex-col"
            style={{
              ...panelStyle,
              left: connectionPopup.x,
              top: connectionPopup.y,
              minWidth: 200,
              maxHeight: 400,
              overflowY: "auto",
              borderColor: "rgba(16,185,129,0.3)",
            }}
            onClick={e => e.stopPropagation()}
          >
            <p style={{ fontSize: uiFs(0.55), fontWeight: 700, color: node.formatting?.color || node.color, letterSpacing: "0.06em", marginBottom: 4, padding: "2px 6px" }}>
              {node.label.split("\n")[0]}
            </p>
            {/* Action buttons */}
            {[
              { label: "Edit", action: () => { setEditingNode(node.id); setEditText(node.label); setEditFormatting(node.formatting || {}); setEditVideoUrl(""); setEditCommentText(""); setConnectionPopup(null); } },
              { label: "Attach Picture", action: () => { setPictureTarget(node.id); setPictureViewIdx(0); setTimeout(() => fileInputRef.current?.click(), 50); setConnectionPopup(null); } },
              { label: "Add Comment", action: () => { setCommentTarget(node.id); setCommentText(""); setConnectionPopup(null); } },
              { label: "Attach Video", action: () => { setVideoTarget(node.id); setVideoUrl(""); setConnectionPopup(null); } },
              { label: "Connect to...", action: () => { setInteractionMode("connect"); setConnectSource(node.id); setConnectionPopup(null); } },
            ].map(item => (
              <button
                key={item.label}
                className="px-3 py-1 text-left rounded transition-all hover:brightness-150"
                style={{ background: "transparent", border: "none", fontSize: uiFs(0.5), color: "rgba(255,255,255,0.6)", cursor: "pointer" }}
                onClick={item.action}
              >
                {item.label}
              </button>
            ))}
            <div style={{ height: 1, background: "rgba(255,255,255,0.06)", margin: "3px 6px" }} />
            <button
              className="px-3 py-1 text-left rounded transition-all hover:brightness-150"
              style={{ background: "transparent", border: "none", fontSize: uiFs(0.5), color: "#ef4444", cursor: "pointer" }}
              onClick={() => {
                if (confirm(`Delete "${node.label.split("\n")[0]}"?`)) {
                  deleteNode(node.id);
                  setConnectionPopup(null);
                }
              }}
            >
              Delete Node
            </button>
            {/* Connections */}
            {conns.length > 0 && (
              <>
                <div style={{ height: 1, background: "rgba(255,255,255,0.06)", margin: "3px 6px" }} />
                <p style={{ fontSize: uiFs(0.45), color: "rgba(255,255,255,0.3)", padding: "2px 6px", letterSpacing: "0.08em", textTransform: "uppercase" }}>Connections</p>
                {conns.map(cid => (
                  <div key={cid} className="flex items-center justify-between gap-2 px-2" style={{ padding: "1px 6px" }}>
                    <span style={{ fontSize: uiFs(0.45), color: "rgba(255,255,255,0.5)", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {cid.split("\n")[0]}
                    </span>
                    <button
                      style={{ fontSize: uiFs(0.4), color: "#ef4444", background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.2)", borderRadius: 4, padding: "0 5px", cursor: "pointer" }}
                      onClick={() => { removeEdge(connectionPopup.nodeId, cid); setConnectionPopup({ ...connectionPopup }); }}
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </>
            )}
            <div style={{ height: 1, background: "rgba(255,255,255,0.06)", margin: "3px 6px" }} />
            <button
              className="px-3 py-1 text-left rounded transition-all hover:brightness-150"
              style={{ background: "transparent", border: "none", fontSize: uiFs(0.45), color: "rgba(255,255,255,0.3)", cursor: "pointer" }}
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
          <div className="p-5 rounded-xl w-[420px] flex flex-col gap-3" style={{ ...panelStyle, maxHeight: "90vh", overflowY: "auto" }}>
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

              {/* Single color picker for text + dot */}
              <span style={{ fontSize: "0.55rem", color: "rgba(255,255,255,0.35)", marginRight: 2 }}>Color:</span>
              <label style={{ display: "inline-flex", alignItems: "center", gap: 4, cursor: "pointer" }}>
                <input
                  type="color"
                  value={editFormatting.color || (data.nodes.find(n => n.id === editingNode)?.color || "#888888")}
                  onChange={e => setEditFormatting(f => ({ ...f, color: e.target.value }))}
                  style={{ width: 22, height: 22, border: "none", padding: 0, cursor: "pointer", background: "transparent", borderRadius: 4 }}
                />
                <span style={{ fontSize: "0.55rem", color: "rgba(255,255,255,0.45)" }}>
                  {editFormatting.color || "default"}
                </span>
              </label>
              {editFormatting.color && (
                <button
                  style={{ fontSize: "0.5rem", color: "rgba(255,255,255,0.35)", background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 4, padding: "1px 6px", cursor: "pointer" }}
                  onClick={() => setEditFormatting(f => ({ ...f, color: undefined }))}
                >
                  Reset
                </button>
              )}
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

            {/* ── Pictures (drag to reorder, click to view full) ── */}
            <div style={{ borderTop: "1px solid rgba(255,255,255,0.08)", paddingTop: 8 }}>
              <div className="flex items-center justify-between mb-2">
                <span style={{ fontSize: "0.6rem", fontWeight: 700, color: "rgba(255,255,255,0.35)", textTransform: "uppercase", letterSpacing: "0.08em" }}>
                  Pictures {nodeImages[editingNode] ? `(${(Array.isArray(nodeImages[editingNode]) ? (nodeImages[editingNode] as string[]).length : 1)})` : ""}
                </span>
                <div className="flex gap-1">
                  <span style={{ fontSize: "0.45rem", color: "rgba(255,255,255,0.2)" }}>drag to reorder · 1st = thumbnail</span>
                  <button
                    style={{ fontSize: "0.55rem", color: "#3b82f6", background: "rgba(59,130,246,0.1)", border: "1px solid rgba(59,130,246,0.2)", borderRadius: 4, padding: "2px 8px", cursor: "pointer" }}
                    onClick={() => { editPicInputRef.current?.click(); }}
                  >
                    + Add
                  </button>
                </div>
              </div>
              {nodeImages[editingNode] && (() => {
                const imgs = Array.isArray(nodeImages[editingNode]) ? nodeImages[editingNode] as string[] : [nodeImages[editingNode] as string];
                return (
                  <div className="flex flex-wrap gap-2 mb-2">
                    {imgs.map((img, i) => (
                      <div
                        key={i}
                        className="relative"
                        style={{ width: 60, height: 60, cursor: "grab", border: i === 0 ? "2px solid rgba(16,185,129,0.5)" : "2px solid transparent", borderRadius: 8 }}
                        draggable
                        onDragStart={() => { editPicDragRef.current = i; }}
                        onDragOver={e => { e.preventDefault(); e.stopPropagation(); }}
                        onDrop={e => {
                          e.preventDefault(); e.stopPropagation();
                          const from = editPicDragRef.current;
                          if (from === null || from === i) return;
                          setNodeImages(prev => {
                            const arr = Array.isArray(prev[editingNode!]) ? [...(prev[editingNode!] as string[])] : prev[editingNode!] ? [prev[editingNode!] as string] : [];
                            const [moved] = arr.splice(from, 1);
                            arr.splice(i, 0, moved);
                            return { ...prev, [editingNode!]: arr };
                          });
                          editPicDragRef.current = null;
                        }}
                      >
                        <img
                          src={img} alt=""
                          style={{ width: 56, height: 56, objectFit: "cover", borderRadius: 6, opacity: 0.9, cursor: "pointer" }}
                          onClick={() => { setPictureTarget(editingNode!); setPictureViewIdx(i); setPictureFullscreen(false); }}
                        />
                        {i === 0 && <span style={{ position: "absolute", bottom: -2, left: 2, fontSize: "0.4rem", color: "#10b981", background: "rgba(0,0,0,0.7)", padding: "0 3px", borderRadius: 3 }}>thumb</span>}
                        <button
                          style={{ position: "absolute", top: -4, right: -4, fontSize: "0.5rem", color: "#ef4444", background: "rgba(0,0,0,0.7)", border: "1px solid rgba(239,68,68,0.3)", borderRadius: "50%", width: 16, height: 16, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}
                          onClick={e => {
                            e.stopPropagation();
                            setNodeImages(prev => {
                              const existing = Array.isArray(prev[editingNode!]) ? [...(prev[editingNode!] as string[])] : prev[editingNode!] ? [prev[editingNode!] as string] : [];
                              existing.splice(i, 1);
                              if (existing.length === 0) { const next = { ...prev }; delete next[editingNode!]; return next; }
                              return { ...prev, [editingNode!]: existing };
                            });
                            if (editFullPicIdx === i) setEditFullPicIdx(null);
                          }}
                        >✕</button>
                      </div>
                    ))}
                  </div>
                );
              })()}
              {/* Full picture view overlay inside modal */}
              {editFullPicIdx !== null && nodeImages[editingNode] && (() => {
                const imgs = Array.isArray(nodeImages[editingNode]) ? nodeImages[editingNode] as string[] : [nodeImages[editingNode] as string];
                const src = imgs[editFullPicIdx];
                if (!src) return null;
                return (
                  <div
                    className="rounded-lg overflow-hidden mb-2"
                    style={{ background: "rgba(0,0,0,0.4)", padding: 8, position: "relative" }}
                  >
                    <img src={src} alt="" style={{ maxWidth: "100%", maxHeight: 400, borderRadius: 6, objectFit: "contain", display: "block", margin: "0 auto" }} />
                    <div className="flex justify-center gap-2 mt-2">
                      <button
                        style={{ fontSize: "0.5rem", color: "rgba(255,255,255,0.5)", background: "rgba(255,255,255,0.06)", border: "none", borderRadius: 4, padding: "2px 10px", cursor: "pointer" }}
                        onClick={() => setEditFullPicIdx(editFullPicIdx > 0 ? editFullPicIdx - 1 : imgs.length - 1)}
                      >← Prev</button>
                      <span style={{ fontSize: "0.5rem", color: "rgba(255,255,255,0.3)" }}>{editFullPicIdx + 1} / {imgs.length}</span>
                      <button
                        style={{ fontSize: "0.5rem", color: "rgba(255,255,255,0.5)", background: "rgba(255,255,255,0.06)", border: "none", borderRadius: 4, padding: "2px 10px", cursor: "pointer" }}
                        onClick={() => setEditFullPicIdx(editFullPicIdx < imgs.length - 1 ? editFullPicIdx + 1 : 0)}
                      >Next →</button>
                      <button
                        style={{ fontSize: "0.5rem", color: "rgba(255,255,255,0.4)", background: "rgba(255,255,255,0.06)", border: "none", borderRadius: 4, padding: "2px 10px", cursor: "pointer" }}
                        onClick={() => setEditFullPicIdx(null)}
                      >Close</button>
                    </div>
                  </div>
                );
              })()}
            </div>

            {/* ── Videos (embedded player) ── */}
            <div style={{ borderTop: "1px solid rgba(255,255,255,0.08)", paddingTop: 8 }}>
              <div className="flex items-center justify-between mb-2">
                <span style={{ fontSize: "0.6rem", fontWeight: 700, color: "rgba(255,255,255,0.35)", textTransform: "uppercase", letterSpacing: "0.08em" }}>Videos</span>
              </div>
              {nodeVideos[editingNode] && (() => {
                const vid = nodeVideos[editingNode];
                // Build embed URL
                let embedUrl = "";
                const ytMatch = vid.url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([\w-]+)/);
                const vimeoMatch = vid.url.match(/vimeo\.com\/(\d+)/);
                if (ytMatch) embedUrl = `https://www.youtube.com/embed/${ytMatch[1]}`;
                else if (vimeoMatch) embedUrl = `https://player.vimeo.com/video/${vimeoMatch[1]}`;
                return (
                  <div className="mb-2">
                    {embedUrl && (
                      <div style={{ position: "relative", paddingBottom: "56.25%", height: 0, overflow: "hidden", borderRadius: 8, marginBottom: 6 }}>
                        <iframe
                          src={embedUrl}
                          style={{ position: "absolute", top: 0, left: 0, width: "100%", height: "100%", border: "none", borderRadius: 8 }}
                          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                          allowFullScreen
                        />
                      </div>
                    )}
                    <div className="flex items-center gap-2 px-2 py-1 rounded" style={{ background: "rgba(255,255,255,0.04)" }}>
                      <span style={{ fontSize: "0.5rem", color: "rgba(255,255,255,0.5)", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{vid.url}</span>
                      <button style={{ fontSize: "0.5rem", color: "#ef4444", cursor: "pointer", background: "none", border: "none" }} onClick={() => setNodeVideos(prev => { const n = { ...prev }; delete n[editingNode!]; return n; })}>✕</button>
                    </div>
                  </div>
                );
              })()}
              <div className="flex gap-1">
                <input style={{ ...inputStyle, fontSize: "0.6rem" }} placeholder="YouTube or Vimeo URL..." value={editVideoUrl} onChange={e => setEditVideoUrl(e.target.value)}
                  onKeyDown={e => { if (e.key === "Enter") {
                    const url = editVideoUrl.trim();
                    if (!url || !editingNode) return;
                    let thumbnail = "";
                    const ytMatch = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([\w-]+)/);
                    const vimeoMatch = url.match(/vimeo\.com\/(\d+)/);
                    if (ytMatch) thumbnail = `https://img.youtube.com/vi/${ytMatch[1]}/mqdefault.jpg`;
                    else if (vimeoMatch) thumbnail = `https://vumbnail.com/${vimeoMatch[1]}.jpg`;
                    if (!thumbnail) return;
                    setNodeVideos(prev => ({ ...prev, [editingNode]: { url, thumbnail } }));
                    setEditVideoUrl("");
                  }}}
                />
                <button style={{ fontSize: "0.5rem", color: "#10b981", background: "rgba(16,185,129,0.15)", border: "1px solid rgba(16,185,129,0.2)", borderRadius: 4, padding: "2px 8px", cursor: "pointer", whiteSpace: "nowrap" }} onClick={() => {
                  const url = editVideoUrl.trim();
                  if (!url || !editingNode) return;
                  let thumbnail = "";
                  const ytMatch = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([\w-]+)/);
                  const vimeoMatch = url.match(/vimeo\.com\/(\d+)/);
                  if (ytMatch) thumbnail = `https://img.youtube.com/vi/${ytMatch[1]}/mqdefault.jpg`;
                  else if (vimeoMatch) thumbnail = `https://vumbnail.com/${vimeoMatch[1]}.jpg`;
                  if (!thumbnail) return;
                  setNodeVideos(prev => ({ ...prev, [editingNode]: { url, thumbnail } }));
                  setEditVideoUrl("");
                }}>Add</button>
              </div>
            </div>

            {/* ── Comments ── */}
            <div style={{ borderTop: "1px solid rgba(255,255,255,0.08)", paddingTop: 8 }}>
              <div className="flex items-center justify-between mb-2">
                <span style={{ fontSize: "0.6rem", fontWeight: 700, color: "rgba(255,255,255,0.35)", textTransform: "uppercase", letterSpacing: "0.08em" }}>Comments</span>
              </div>
              {(nodeComments[editingNode] || []).map((c, i) => (
                <div key={i} className="flex items-start gap-2 px-2 py-1 rounded mb-1" style={{ background: "rgba(255,255,255,0.04)" }}>
                  <p style={{ fontSize: "0.55rem", color: "rgba(255,255,255,0.6)", flex: 1 }}>{c}</p>
                  <button style={{ fontSize: "0.5rem", color: "rgba(255,255,255,0.3)", background: "none", border: "none", cursor: "pointer" }} onClick={() => deleteComment(editingNode!, i)}>✕</button>
                </div>
              ))}
              <div className="flex gap-1">
                <input style={{ ...inputStyle, fontSize: "0.6rem" }} placeholder="Add a comment..." value={editCommentText} onChange={e => setEditCommentText(e.target.value)} onKeyDown={e => { if (e.key === "Enter" && editCommentText.trim() && editingNode) { setNodeComments(prev => ({ ...prev, [editingNode!]: [...(prev[editingNode!] || []), editCommentText.trim()] })); setEditCommentText(""); } }} />
                <button style={{ fontSize: "0.5rem", color: "#f59e0b", background: "rgba(245,158,11,0.15)", border: "1px solid rgba(245,158,11,0.2)", borderRadius: 4, padding: "2px 8px", cursor: "pointer" }} onClick={() => { if (editCommentText.trim() && editingNode) { setNodeComments(prev => ({ ...prev, [editingNode!]: [...(prev[editingNode!] || []), editCommentText.trim()] })); setEditCommentText(""); } }}>Add</button>
              </div>
            </div>

            <div className="flex gap-2">
              <button
                className="flex-1 py-1.5 rounded-md transition-all hover:brightness-125"
                style={{ background: "rgba(16,185,129,0.2)", color: "#10b981", fontSize: "0.75rem", border: "none", cursor: "pointer" }}
                onClick={saveEdit}
              >
                Save
              </button>
              <button
                className="py-1.5 px-3 rounded-md transition-all hover:brightness-125"
                style={{ background: "rgba(59,130,246,0.15)", color: "#3b82f6", fontSize: "0.65rem", border: "1px solid rgba(59,130,246,0.2)", cursor: "pointer", whiteSpace: "nowrap" }}
                onClick={() => {
                  if (!editingNode) return;
                  const node = data.nodes.find(n => n.id === editingNode);
                  if (!node) return;
                  const fmt = { ...editFormatting };
                  for (const cid of node.connections) {
                    const cn = data.nodes.find(n => n.id === cid);
                    if (cn) cn.formatting = { ...fmt };
                  }
                  saveEdit();
                }}
                title="Apply this formatting (color, bold, italic, etc.) to all nodes connected to this one"
              >
                Apply to connected
              </button>
              <button
                className="py-1.5 px-3 rounded-md transition-all hover:brightness-125"
                style={{ background: "rgba(239,68,68,0.15)", color: "#ef4444", fontSize: "0.65rem", border: "1px solid rgba(239,68,68,0.2)", cursor: "pointer" }}
                onClick={() => {
                  if (!editingNode) return;
                  if (confirm(`Delete node "${editText}"?`)) {
                    deleteNode(editingNode);
                    setEditingNode(null); setEditText(""); setEditFormatting({});
                  }
                }}
              >
                Delete
              </button>
              <button
                className="flex-1 py-1.5 rounded-md transition-all hover:brightness-125"
                style={{ background: "rgba(255,255,255,0.04)", color: "rgba(255,255,255,0.4)", fontSize: "0.75rem", border: "none", cursor: "pointer" }}
                onClick={() => { setEditingNode(null); setEditText(""); setEditFormatting({}); setEditVideoUrl(""); setEditCommentText(""); setEditFullPicIdx(null); }}
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

      {/* Picture Preview Dialog — single-image gallery with prev/next navigation */}
      {pictureTarget && nodeImages[pictureTarget] && (() => {
        const allPics = Array.isArray(nodeImages[pictureTarget]) ? nodeImages[pictureTarget] as string[] : [nodeImages[pictureTarget] as string];
        const safeIdx = Math.min(pictureViewIdx, allPics.length - 1);
        const currentPic = allPics[safeIdx];
        const total = allPics.length;
        return (
        <div className="absolute inset-0 flex items-center justify-center z-50" style={{ background: "rgba(0,0,0,0.6)" }}
          onClick={() => { setPictureTarget(null); setPictureFullscreen(false); setPictureViewIdx(0); }}
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
                {total > 1 && <span style={{ marginLeft: 10, fontSize: "0.8rem", color: "rgba(255,255,255,0.4)" }}>{safeIdx + 1} / {total}</span>}
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
            <div className="flex items-center justify-center" style={{ maxHeight: pictureFullscreen ? "80vh" : 700, position: "relative" }}>
              {total > 1 && (
                <button
                  className="rounded-full transition-all hover:brightness-150"
                  style={{
                    position: "absolute", left: 8, top: "50%", transform: "translateY(-50%)", zIndex: 10,
                    width: 36, height: 36, display: "flex", alignItems: "center", justifyContent: "center",
                    background: "rgba(0,0,0,0.5)", color: "rgba(255,255,255,0.8)", border: "none", cursor: "pointer", fontSize: "1.2rem",
                  }}
                  onClick={() => setPictureViewIdx(i => (i - 1 + total) % total)}
                >
                  ‹
                </button>
              )}
              <img
                src={currentPic}
                alt=""
                style={{
                  maxHeight: pictureFullscreen ? "80vh" : 700,
                  maxWidth: "100%",
                  borderRadius: 8,
                  objectFit: "contain",
                }}
              />
              {total > 1 && (
                <button
                  className="rounded-full transition-all hover:brightness-150"
                  style={{
                    position: "absolute", right: 8, top: "50%", transform: "translateY(-50%)", zIndex: 10,
                    width: 36, height: 36, display: "flex", alignItems: "center", justifyContent: "center",
                    background: "rgba(0,0,0,0.5)", color: "rgba(255,255,255,0.8)", border: "none", cursor: "pointer", fontSize: "1.2rem",
                  }}
                  onClick={() => setPictureViewIdx(i => (i + 1) % total)}
                >
                  ›
                </button>
              )}
            </div>
            <div className="flex gap-3">
              <button
                className="flex-1 py-2 rounded-md transition-all hover:brightness-125"
                style={{ background: "rgba(59,130,246,0.15)", color: "#3b82f6", fontSize: "0.85rem", border: "none", cursor: "pointer" }}
                onClick={() => {
                  setInteractionMode("picture");
                  setPictureTarget(null);
                  setPictureFullscreen(false);
                  setPictureViewIdx(0);
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
                onClick={() => { removePicture(pictureTarget); setPictureTarget(null); setPictureFullscreen(false); setPictureViewIdx(0); }}
              >
                Remove Picture
              </button>
              <button
                className="flex-1 py-2 rounded-md transition-all hover:brightness-125"
                style={{ background: "rgba(255,255,255,0.04)", color: "rgba(255,255,255,0.4)", fontSize: "0.85rem", border: "none", cursor: "pointer" }}
                onClick={() => { setPictureTarget(null); setPictureFullscreen(false); setPictureViewIdx(0); }}
              >
                Close
              </button>
            </div>
          </div>
        </div>
        );
      })()}

      {/* Video URL Dialog (Feature 5) */}
      {videoTarget && (
        <div className="absolute inset-0 flex items-center justify-center z-50" style={{ background: "rgba(0,0,0,0.6)" }}>
          <div className="p-5 rounded-xl w-[420px] flex flex-col gap-3" style={panelStyle}>
            <p style={{ fontSize: uiFs(0.7), fontWeight: 700, color: "rgba(255,255,255,0.5)", letterSpacing: "0.1em", textTransform: "uppercase" }}>
              Attach Video: <span style={{ color: data.nodes.find(n => n.id === videoTarget)?.color || "#fff" }}>{videoTarget}</span>
            </p>
            <input
              style={{ ...inputStyle, fontSize: uiFs(0.75) }}
              placeholder="Paste YouTube or Vimeo URL..."
              value={videoUrl}
              onChange={e => setVideoUrl(e.target.value)}
              onKeyDown={e => {
                if (e.key === "Enter") {
                  // Extract video info
                  const ytMatch = videoUrl.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([\w-]+)/);
                  const vimeoMatch = videoUrl.match(/vimeo\.com\/(\d+)/);
                  if (ytMatch) {
                    const id = ytMatch[1];
                    setNodeVideos(prev => ({ ...prev, [videoTarget!]: { url: `https://www.youtube.com/embed/${id}`, thumbnail: `https://img.youtube.com/vi/${id}/mqdefault.jpg` } }));
                    setVideoTarget(null); setVideoUrl("");
                  } else if (vimeoMatch) {
                    const id = vimeoMatch[1];
                    setNodeVideos(prev => ({ ...prev, [videoTarget!]: { url: `https://player.vimeo.com/video/${id}`, thumbnail: `https://vumbnail.com/${id}.jpg` } }));
                    setVideoTarget(null); setVideoUrl("");
                  }
                }
              }}
              autoFocus
            />
            <p style={{ fontSize: uiFs(0.5), color: "rgba(255,255,255,0.3)" }}>
              Supported: YouTube (youtube.com/watch?v=... or youtu.be/...) and Vimeo (vimeo.com/...)
            </p>
            <div className="flex gap-2">
              <button
                className="flex-1 py-1.5 rounded-md transition-all hover:brightness-125"
                style={{ background: "rgba(16,185,129,0.2)", color: "#10b981", fontSize: uiFs(0.7), border: "none", cursor: "pointer" }}
                onClick={() => {
                  const ytMatch = videoUrl.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([\w-]+)/);
                  const vimeoMatch = videoUrl.match(/vimeo\.com\/(\d+)/);
                  if (ytMatch) {
                    const id = ytMatch[1];
                    setNodeVideos(prev => ({ ...prev, [videoTarget!]: { url: `https://www.youtube.com/embed/${id}`, thumbnail: `https://img.youtube.com/vi/${id}/mqdefault.jpg` } }));
                    setVideoTarget(null); setVideoUrl("");
                  } else if (vimeoMatch) {
                    const id = vimeoMatch[1];
                    setNodeVideos(prev => ({ ...prev, [videoTarget!]: { url: `https://player.vimeo.com/video/${id}`, thumbnail: `https://vumbnail.com/${id}.jpg` } }));
                    setVideoTarget(null); setVideoUrl("");
                  }
                }}
              >
                Attach
              </button>
              {nodeVideos[videoTarget] && (
                <button
                  className="py-1.5 px-3 rounded-md transition-all hover:brightness-125"
                  style={{ background: "rgba(239,68,68,0.15)", color: "#ef4444", fontSize: uiFs(0.65), border: "none", cursor: "pointer" }}
                  onClick={() => {
                    setNodeVideos(prev => { const next = { ...prev }; delete next[videoTarget!]; return next; });
                    setVideoTarget(null); setVideoUrl("");
                  }}
                >
                  Remove Video
                </button>
              )}
              <button
                className="flex-1 py-1.5 rounded-md transition-all hover:brightness-125"
                style={{ background: "rgba(255,255,255,0.04)", color: "rgba(255,255,255,0.4)", fontSize: uiFs(0.7), border: "none", cursor: "pointer" }}
                onClick={() => { setVideoTarget(null); setVideoUrl(""); }}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Video Player Modal (Feature 5) */}
      {videoPlayerNode && nodeVideos[videoPlayerNode] && (
        <div className="absolute inset-0 flex items-center justify-center z-50" style={{ background: "rgba(0,0,0,0.7)" }}
          onClick={() => setVideoPlayerNode(null)}
        >
          <div
            className="p-4 rounded-xl flex flex-col gap-3"
            style={{ ...panelStyle, width: "80vw", maxWidth: 900 }}
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <p style={{ fontSize: uiFs(0.8), fontWeight: 700, color: "rgba(255,255,255,0.5)", textTransform: "uppercase" }}>
                Video: {videoPlayerNode}
              </p>
              <button
                style={{ background: "rgba(255,255,255,0.06)", color: "rgba(255,255,255,0.5)", border: "none", cursor: "pointer", fontSize: uiFs(0.7), padding: "4px 12px", borderRadius: 6 }}
                onClick={() => setVideoPlayerNode(null)}
              >
                Close
              </button>
            </div>
            <div style={{ position: "relative", paddingBottom: "56.25%", height: 0 }}>
              <iframe
                src={nodeVideos[videoPlayerNode].url}
                style={{ position: "absolute", top: 0, left: 0, width: "100%", height: "100%", border: "none", borderRadius: 8 }}
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                allowFullScreen
              />
            </div>
          </div>
        </div>
      )}

      {/* Cluster Tree View */}
      <div
        className="absolute top-14 right-3 p-3 rounded-xl max-h-[calc(100vh-100px)] overflow-y-auto"
        style={{ ...panelStyle, scrollbarWidth: "thin", minWidth: 200, maxWidth: 260 }}
        onDragOver={e => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; }}
        onDrop={e => {
          e.preventDefault();
          const draggedId = treeDragRef.current;
          treeDragRef.current = null;
          setTreeDragOver(null);
          if (!draggedId) return;
          // Don't promote if already a cluster root
          for (const cl of Object.values(treeData)) {
            if (cl.rootId === draggedId) return;
          }
          pushUndo();
          const node = data.nodes.find(n => n.id === draggedId);
          if (!node) return;
          const newClusterKey = draggedId.replace(/[^a-zA-Z0-9]/g, "");
          setTreeData(prev => {
            const next = JSON.parse(JSON.stringify(prev));
            for (const cluster of Object.values(next) as any[]) {
              cluster.ungrouped = cluster.ungrouped.filter((id: string) => id !== draggedId);
              for (const sub of cluster.subs) sub.children = sub.children.filter((id: string) => id !== draggedId);
              const subIdx = cluster.subs.findIndex((s: any) => s.nodeId === draggedId);
              if (subIdx !== -1) { const ch = cluster.subs[subIdx].children; cluster.subs.splice(subIdx, 1); cluster.ungrouped.push(...ch); }
            }
            next[newClusterKey] = { rootId: draggedId, subs: [], ungrouped: [] };
            return next;
          });
          node.cluster = newClusterKey;
          node.formatting = { ...node.formatting, bold: true };
          setTimeout(() => persistFormatting(), 0);
        }}
      >
        <p style={{ fontSize: uiFs(0.5), fontWeight: 700, letterSpacing: "0.14em", color: "rgba(255,255,255,0.25)", marginBottom: 6, textTransform: "uppercase" }}>
          Cluster Tree
        </p>
        <div className="flex flex-col gap-0">
          {clusterList.map(clusterKey => {
            const td = treeData[clusterKey];
            const meta = clusterMeta[clusterKey] || { name: clusterKey, color: "#666" };
            const isCollapsed = treeCollapsed[clusterKey];
            const rootNode = td ? data.nodes.find(n => n.id === td.rootId) : null;
            const rootLabel = rootNode?.label.split("\n")[0] || meta.name;

            // Only show cluster if its root is open (visible on canvas)
            if (rootNode && !openNodes.current.has(rootNode.id)) return null;

            return (
              <div key={clusterKey} style={{ marginBottom: 2 }}>
                {/* Cluster root — CAPS, draggable */}
                <div
                  draggable
                  className="flex items-center gap-1.5 px-1.5 py-0.5 rounded-md transition-all"
                  style={{
                    cursor: "grab",
                    background: treeDragOver === `cluster:${clusterKey}` ? "rgba(16,185,129,0.15)" : (selectedCluster === clusterKey ? "rgba(255,255,255,0.06)" : "transparent"),
                    opacity: selectedCluster && selectedCluster !== clusterKey ? 0.3 : 1,
                  }}
                  onClick={() => {
                    setSelectedCluster(prev => prev === clusterKey ? null : clusterKey);
                  }}
                  onDoubleClick={(e) => {
                    e.stopPropagation();
                    if (rootNode) {
                      setEditingNode(rootNode.id);
                      setEditText(rootNode.label);
                      setEditFormatting(rootNode.formatting || {});
                      setEditVideoUrl("");
                      setEditCommentText("");
                    }
                  }}
                  onDragStart={e => handleTreeDragStart(e, td.rootId)}
                  onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); setConnectionPopup({ nodeId: td.rootId, x: e.clientX, y: e.clientY }); }}
                  onDragOver={e => handleTreeDragOverFn(e, `cluster:${clusterKey}`)}
                  onDragLeave={handleTreeDragLeave}
                  onDrop={e => handleTreeDrop(e, clusterKey, "cluster", clusterKey)}
                >
                  <span
                    style={{ fontSize: uiFs(0.5), color: "rgba(255,255,255,0.3)", width: 8, textAlign: "center", flexShrink: 0, userSelect: "none" }}
                    onClick={e => { e.stopPropagation(); setTreeCollapsed(c => ({ ...c, [clusterKey]: !c[clusterKey] })); }}
                  >
                    {isCollapsed ? "▶" : "▼"}
                  </span>
                  <span className="w-2 h-2 rounded-full shrink-0" style={{ background: meta.color, boxShadow: `0 0 4px ${meta.color}40` }} />
                  <span style={{
                    fontSize: uiFs(0.58), fontWeight: rootNode?.formatting?.bold !== false ? 800 : 400,
                    color: rootNode?.formatting?.color || meta.color,
                    fontStyle: rootNode?.formatting?.italic ? "italic" : "normal",
                    textTransform: "uppercase", letterSpacing: "0.04em",
                    textDecoration: rootNode?.formatting?.underline ? "underline" : "none",
                    overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                  }}>
                    {rootLabel}
                  </span>
                </div>

                {/* Sub-nodes + children with Win98-style tree lines */}
                {!isCollapsed && td && (
                  <div style={{ paddingLeft: 4 }}>
                    {td.subs.filter(sub => openNodes.current.has(sub.nodeId)).map((sub, subIdx) => {
                      const subNode = data.nodes.find(n => n.id === sub.nodeId);
                      const subLabel = subNode?.label.split("\n")[0] || sub.nodeId;
                      const subCollapsed = treeCollapsed[sub.nodeId];
                      const visibleChildren = sub.children.filter(cid => openNodes.current.has(cid));
                      const hasCh = visibleChildren.length > 0;
                      const isLastSub = subIdx === td.subs.filter(s => openNodes.current.has(s.nodeId)).length - 1 && td.ungrouped.filter(id => openNodes.current.has(id)).length === 0;

                      return (
                        <div key={sub.nodeId} style={{ display: "flex", alignItems: "stretch" }}>
                          {/* Tree line connector */}
                          <div style={{ width: 16, flexShrink: 0, position: "relative" }}>
                            <div style={{
                              position: "absolute", left: 6, top: 0,
                              bottom: isLastSub ? "50%" : 0,
                              width: 1, background: "rgba(255,255,255,0.12)",
                            }} />
                            <div style={{
                              position: "absolute", left: 6, top: "50%",
                              width: 10, height: 1,
                              background: "rgba(255,255,255,0.12)",
                            }} />
                          </div>
                          {/* Node content */}
                          <div style={{ flex: 1 }}>
                            {/* Sub item — underlined */}
                            <div
                              draggable
                              className="flex items-center gap-1 px-1 py-px rounded transition-all"
                              style={{
                                cursor: "grab",
                                background: treeDragOver === `sub:${sub.nodeId}` ? "rgba(16,185,129,0.12)" : "transparent",
                              }}
                              onDragStart={e => handleTreeDragStart(e, sub.nodeId)}
                              onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); setConnectionPopup({ nodeId: sub.nodeId, x: e.clientX, y: e.clientY }); }}
                              onDragOver={e => handleTreeDragOverFn(e, `sub:${sub.nodeId}`)}
                              onDragLeave={handleTreeDragLeave}
                              onDrop={e => handleTreeDrop(e, sub.nodeId, "sub", clusterKey)}
                              onClick={e => {
                                e.stopPropagation();
                                if (hasCh) setTreeCollapsed(c => ({ ...c, [sub.nodeId]: !c[sub.nodeId] }));
                                setSelectedCluster(clusterKey);
                              }}
                              onDoubleClick={(e) => {
                                e.stopPropagation();
                                if (subNode) {
                                  setEditingNode(subNode.id);
                                  setEditText(subNode.label);
                                  setEditFormatting(subNode.formatting || {});
                                  setEditVideoUrl("");
                                  setEditCommentText("");
                                }
                              }}
                            >
                              <span style={{ fontSize: uiFs(0.45), color: "rgba(255,255,255,0.2)", width: 6, textAlign: "center", flexShrink: 0 }}>
                                {hasCh ? (subCollapsed ? "▶" : "▼") : "·"}
                              </span>
                              <span style={{
                                fontSize: uiFs(0.52),
                                color: subNode?.formatting?.color || meta.color || "rgba(255,255,255,0.7)",
                                fontWeight: subNode?.formatting?.bold ? 700 : 500,
                                fontStyle: subNode?.formatting?.italic ? "italic" : "normal",
                                textDecoration: (subNode?.formatting?.underline !== false) ? "underline" : "none",
                                textUnderlineOffset: "2px",
                                overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                              }}>
                                {subLabel}
                              </span>
                            </div>

                            {/* Children — normal, with tree lines */}
                            {hasCh && !subCollapsed && (
                              <div style={{ paddingLeft: 4 }}>
                                {visibleChildren.map((childId, childIdx) => {
                                  const childNode = data.nodes.find(n => n.id === childId);
                                  const childLabel = childNode?.label.split("\n")[0] || childId;
                                  const isLastChild = childIdx === visibleChildren.length - 1;
                                  return (
                                    <div key={childId} style={{ display: "flex", alignItems: "stretch" }}>
                                      {/* Tree line connector */}
                                      <div style={{ width: 16, flexShrink: 0, position: "relative" }}>
                                        <div style={{
                                          position: "absolute", left: 6, top: 0,
                                          bottom: isLastChild ? "50%" : 0,
                                          width: 1, background: "rgba(255,255,255,0.12)",
                                        }} />
                                        <div style={{
                                          position: "absolute", left: 6, top: "50%",
                                          width: 10, height: 1,
                                          background: "rgba(255,255,255,0.12)",
                                        }} />
                                      </div>
                                      <div
                                        style={{ flex: 1 }}
                                        draggable
                                        className="px-1 py-px rounded transition-all"
                                        onDragStart={e => handleTreeDragStart(e, childId)}
                                        onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); setConnectionPopup({ nodeId: childId, x: e.clientX, y: e.clientY }); }}
                                        onDragOver={e => handleTreeDragOverFn(e, `child:${childId}`)}
                                        onDragLeave={handleTreeDragLeave}
                                        onDrop={e => handleTreeDrop(e, childId, "sibling", clusterKey, sub.nodeId)}
                                        onDoubleClick={(e) => {
                                          e.stopPropagation();
                                          if (childNode) {
                                            setEditingNode(childNode.id);
                                            setEditText(childNode.label);
                                            setEditFormatting(childNode.formatting || {});
                                            setEditVideoUrl("");
                                            setEditCommentText("");
                                          }
                                        }}
                                      >
                                        <span style={{
                                          fontSize: uiFs(0.48),
                                          color: childNode?.formatting?.color || meta.color || "rgba(255,255,255,0.45)",
                                          fontWeight: childNode?.formatting?.bold ? 700 : 400,
                                          fontStyle: childNode?.formatting?.italic ? "italic" : "normal",
                                          textDecoration: childNode?.formatting?.underline ? "underline" : "none",
                                          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                                          display: "block",
                                          cursor: "grab",
                                          background: treeDragOver === `child:${childId}` ? "rgba(16,185,129,0.1)" : "transparent",
                                        }}>
                                          {childLabel}
                                        </span>
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })}

                    {/* Ungrouped nodes with tree lines */}
                    {td.ungrouped.filter(uid => openNodes.current.has(uid)).map((uid, ugIdx) => {
                      const uNode = data.nodes.find(n => n.id === uid);
                      const uLabel = uNode?.label.split("\n")[0] || uid;
                      const visibleUngrouped = td.ungrouped.filter(id => openNodes.current.has(id));
                      const isLastUg = ugIdx === visibleUngrouped.length - 1;
                      return (
                        <div key={uid} style={{ display: "flex", alignItems: "stretch" }}>
                          {/* Tree line connector */}
                          <div style={{ width: 16, flexShrink: 0, position: "relative" }}>
                            <div style={{
                              position: "absolute", left: 6, top: 0,
                              bottom: isLastUg ? "50%" : 0,
                              width: 1, background: "rgba(255,255,255,0.12)",
                            }} />
                            <div style={{
                              position: "absolute", left: 6, top: "50%",
                              width: 10, height: 1,
                              background: "rgba(255,255,255,0.12)",
                            }} />
                          </div>
                          <div
                            style={{ flex: 1 }}
                            draggable
                            className="px-1 py-px rounded transition-all"
                            onDragStart={e => handleTreeDragStart(e, uid)}
                            onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); setConnectionPopup({ nodeId: uid, x: e.clientX, y: e.clientY }); }}
                            onDragOver={e => handleTreeDragOverFn(e, `ug:${uid}`)}
                            onDragLeave={handleTreeDragLeave}
                            onDrop={e => handleTreeDrop(e, uid, "sibling", clusterKey)}
                            onDoubleClick={(e) => {
                              e.stopPropagation();
                              if (uNode) {
                                setEditingNode(uNode.id);
                                setEditText(uNode.label);
                                setEditFormatting(uNode.formatting || {});
                                setEditVideoUrl("");
                                setEditCommentText("");
                              }
                            }}
                          >
                            <span style={{
                              fontSize: uiFs(0.48),
                              color: uNode?.formatting?.color || meta.color || "rgba(255,255,255,0.35)",
                              fontWeight: uNode?.formatting?.bold ? 700 : 400,
                              fontStyle: uNode?.formatting?.italic ? "italic" : "italic",
                              textDecoration: uNode?.formatting?.underline ? "underline" : "none",
                              overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                              display: "block",
                              cursor: "grab",
                              background: treeDragOver === `ug:${uid}` ? "rgba(16,185,129,0.1)" : "transparent",
                            }}>
                              {uLabel}
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
        {selectedCluster && (
          <button
            className="mt-2 w-full text-center py-1 rounded-md"
            style={{ fontSize: uiFs(0.5), color: "rgba(255,255,255,0.3)", background: "rgba(255,255,255,0.03)", border: "none", cursor: "pointer" }}
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
          style={{ background: "rgba(255,255,255,0.06)", color: "rgba(255,255,255,0.5)", border: "none", cursor: "pointer", fontSize: uiFs(0.8) }}
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
          style={{ background: "rgba(255,255,255,0.06)", color: "rgba(255,255,255,0.5)", border: "none", cursor: "pointer", fontSize: uiFs(0.8) }}
          onClick={() => { targetZoomRef.current = Math.max(ZOOM_MIN, targetZoomRef.current / 1.5); }}
        >
          -
        </button>
        <span style={{ fontSize: uiFs(0.5), color: "rgba(255,255,255,0.3)", marginTop: 2 }}>
          {zoomMultiplier < 10 ? zoomMultiplier.toFixed(1) : Math.round(zoomMultiplier)}x
        </span>
      </div>

      {/* Controls */}
      <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex gap-3 pointer-events-none flex-wrap justify-center">
        <span style={{ fontSize: uiFs(0.55), color: "rgba(255,255,255,0.15)" }}>Drag to rotate</span>
        <span style={{ fontSize: uiFs(0.55), color: "rgba(255,255,255,0.06)" }}>·</span>
        <span style={{ fontSize: uiFs(0.55), color: "rgba(255,255,255,0.15)" }}>Shift+drag to pan</span>
        <span style={{ fontSize: uiFs(0.55), color: "rgba(255,255,255,0.06)" }}>·</span>
        <span style={{ fontSize: uiFs(0.55), color: "rgba(255,255,255,0.15)" }}>Scroll to zoom (500x max)</span>
        <span style={{ fontSize: uiFs(0.55), color: "rgba(255,255,255,0.06)" }}>·</span>
        <span style={{ fontSize: uiFs(0.55), color: "rgba(255,255,255,0.15)" }}>Click to filter</span>
        <span style={{ fontSize: uiFs(0.55), color: "rgba(255,255,255,0.06)" }}>·</span>
        <span style={{ fontSize: uiFs(0.55), color: "rgba(255,255,255,0.15)" }}>Double-click to edit</span>
        <span style={{ fontSize: uiFs(0.55), color: "rgba(255,255,255,0.06)" }}>·</span>
        <span style={{ fontSize: uiFs(0.55), color: "rgba(255,255,255,0.15)" }}>Ctrl+click to drag node</span>
        <span style={{ fontSize: uiFs(0.55), color: "rgba(255,255,255,0.06)" }}>·</span>
        <span style={{ fontSize: uiFs(0.55), color: "rgba(255,255,255,0.15)" }}>Alt+drag to connect</span>
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
            pointerEvents: (nodeImages[hovered.node.id] || nodeComments[hovered.node.id] || nodeVideos[hovered.node.id]) ? "auto" : "none",
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
                onClick={(e) => { e.stopPropagation(); setPictureTarget(hovered.node.id); setPictureViewIdx(0); }}
              >
                [pic]
              </span>
            )}
            {nodeVideos[hovered.node.id] && (
              <span
                style={{ fontSize: "0.55rem", color: "#a855f7", cursor: "pointer" }}
                onClick={(e) => { e.stopPropagation(); setVideoPlayerNode(hovered.node.id); }}
              >
                [video]
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
              src={Array.isArray(nodeImages[hovered.node.id]) ? (nodeImages[hovered.node.id] as string[])[0] : nodeImages[hovered.node.id] as string}
              alt=""
              style={{ marginTop: 6, maxHeight: 60, borderRadius: 4, objectFit: "cover", cursor: "pointer", opacity: 0.85 }}
              onClick={(e) => { e.stopPropagation(); setPictureTarget(hovered.node.id); setPictureViewIdx(0); }}
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