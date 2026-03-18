// Cartography of the Lit. Review — Spherical 3D Mind Map
// All nodes mapped onto a sphere with cluster-based coloring

export interface NodeFormatting {
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  fontSize?: number;    // multiplier, 1 = default
  color?: string;       // custom color override
}

export interface Node3D {
  id: string;
  label: string;
  x: number;
  y: number;
  z: number;
  cluster: string;
  color: string;
  size: number;
  type: "header" | "subtitle" | "concept" | "author" | "quote" | "central" | "question" | "work" | "item";
  particleCount: number;
  connections: string[];
  formatting?: NodeFormatting;
}

export interface Edge3D {
  from: string;
  to: string;
  strength: number;
  isCross: boolean; // cross-cluster bridge
}

export interface Particle3D {
  x: number;
  y: number;
  z: number;
  baseX: number;
  baseY: number;
  baseZ: number;
  size: number;
  opacity: number;
  speed: number;
  phase: number;
  orbitRadius: number;
  orbitAngle: number;
  orbitTilt: number;
  color: string;
}

// Seeded PRNG
function createRng(seed: number) {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function hashStr(str: string): number {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash + str.charCodeAt(i)) | 0;
  }
  return hash;
}
function seededGaussian(rng: () => number, mean: number, std: number): number {
  const u = 1 - rng();
  const v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v) * std + mean;
}

// Spherical to Cartesian
function sphereToXYZ(theta: number, phi: number, r: number): { x: number; y: number; z: number } {
  return {
    x: r * Math.cos(phi) * Math.cos(theta),
    y: r * Math.sin(phi),
    z: r * Math.cos(phi) * Math.sin(theta),
  };
}

const SPHERE_R = 320;

// ── Cluster definitions with sphere positions and DISTINCT colors ──
interface ClusterDef {
  key: string;
  color: string;
  theta: number; // azimuth angle
  phi: number;   // elevation angle
}

const CLUSTERS: ClusterDef[] = [
  { key: "Methodology",            color: "#ef4444", theta: -2.1,  phi:  0.75 },
  { key: "ErrorGlitch",            color: "#f97316", theta: -2.6,  phi:  0.25 },
  { key: "Praxis",                 color: "#f59e0b", theta: -1.3,  phi:  0.30 },
  { key: "CriticalPlay",           color: "#eab308", theta: -2.35, phi: -0.20 },
  { key: "Epistemology",           color: "#22c55e", theta: -0.25, phi:  0.35 },
  { key: "HumanLearning",          color: "#10b981", theta:  0.0,  phi:  0.10 },
  { key: "MachineLearning",        color: "#3b82f6", theta:  0.85, phi:  0.25 },
  { key: "PerformanceStudies",     color: "#8b5cf6", theta:  1.80, phi:  0.70 },
  { key: "Ontology",               color: "#a855f7", theta: -0.20, phi: -0.45 },
  { key: "Axiology",               color: "#ec4899", theta: -1.75, phi: -0.65 },
  { key: "Noise",                  color: "#64748b", theta: -2.55, phi: -0.85 },
  { key: "CyberneticPerformances", color: "#14b8a6", theta:  1.25, phi: -0.50 },
  { key: "PerformaAutomata",       color: "#06b6d4", theta:  0.05, phi: -0.72 },
  { key: "Audience",               color: "#f43f5e", theta:  0.15, phi: -1.05 },
];

const clusterMap = new Map<string, ClusterDef>();
CLUSTERS.forEach(c => clusterMap.set(c.key, c));

// ── Node definitions ──
interface NodeDef {
  label: string;
  cluster: string;
  type: Node3D["type"];
  size: number;
  particleCount: number;
  // Angular offset from cluster center (small values keep nodes close)
  dTheta?: number;
  dPhi?: number;
  dR?: number; // radial offset from sphere surface
}

const nodeDefs: NodeDef[] = [
  // ── METHODOLOGY ──
  { label: "METHODOLOGY", cluster: "Methodology", type: "header", size: 8, particleCount: 30, dTheta: 0, dPhi: 0 },
  { label: '"The Process"', cluster: "Methodology", type: "subtitle", size: 4, particleCount: 10, dTheta: 0.02, dPhi: -0.10 },
  { label: "Critical Speculative Design", cluster: "Methodology", type: "concept", size: 5, particleCount: 14, dTheta: 0.12, dPhi: -0.04 },
  { label: "Dunne & Raby", cluster: "Methodology", type: "author", size: 3.5, particleCount: 10, dTheta: 0.10, dPhi: -0.12 },
  { label: "Auger", cluster: "Methodology", type: "author", size: 3, particleCount: 8, dTheta: 0.08, dPhi: -0.18 },
  { label: "Cosmotechnics", cluster: "Methodology", type: "concept", size: 4.5, particleCount: 12, dTheta: -0.12, dPhi: 0.06 },
  { label: "Yuk Hui", cluster: "Methodology", type: "author", size: 3.5, particleCount: 10, dTheta: -0.14, dPhi: -0.02 },
  { label: "Contingency", cluster: "Methodology", type: "concept", size: 3.5, particleCount: 10, dTheta: -0.10, dPhi: -0.10 },

  // ── ERROR / GLITCH ──
  { label: '"Error"', cluster: "ErrorGlitch", type: "quote", size: 7.5, particleCount: 22, dTheta: 0, dPhi: 0.04 },
  { label: '"The Fall" (2018)', cluster: "ErrorGlitch", type: "work", size: 3.5, particleCount: 8, dTheta: 0.12, dPhi: 0.02 },
  { label: '"Glitch"', cluster: "ErrorGlitch", type: "quote", size: 7, particleCount: 20, dTheta: 0.02, dPhi: -0.08 },
  { label: '"Human-Learning" (2021)', cluster: "ErrorGlitch", type: "work", size: 3.5, particleCount: 10, dTheta: 0.06, dPhi: -0.16 },

  // ── PRAXIS ──
  { label: "Praxis: Design as Research", cluster: "Praxis", type: "header", size: 6, particleCount: 20, dTheta: 0, dPhi: 0 },
  { label: "Critical Posthumanism", cluster: "Praxis", type: "concept", size: 4.5, particleCount: 14, dTheta: 0.10, dPhi: -0.05 },
  { label: "Braidotti, Fernando", cluster: "Praxis", type: "author", size: 3.5, particleCount: 10, dTheta: 0.12, dPhi: -0.12 },
  { label: "Posthuman design", cluster: "Praxis", type: "concept", size: 4, particleCount: 12, dTheta: 0.04, dPhi: -0.14 },
  { label: "Wakkary (2024)", cluster: "Praxis", type: "author", size: 3.5, particleCount: 10, dTheta: 0.08, dPhi: -0.20 },
  { label: "Forlano", cluster: "Praxis", type: "author", size: 3, particleCount: 8, dTheta: 0.14, dPhi: -0.18 },

  // ── CRITICAL PLAY ──
  { label: "Critical Play", cluster: "CriticalPlay", type: "concept", size: 5.5, particleCount: 16, dTheta: 0, dPhi: 0 },
  { label: "RQ: How to apply posthumanism\ninto Critical/Speculative Design?", cluster: "CriticalPlay", type: "question", size: 2.5, particleCount: 6, dTheta: -0.04, dPhi: -0.12 },
  { label: "RQ: How critical play is applied\nto embody the machines?", cluster: "CriticalPlay", type: "question", size: 2.5, particleCount: 6, dTheta: 0.06, dPhi: -0.16 },
  { label: "RQ: What can be learnt from\nnext to experiences?\n(empathy AI instances)", cluster: "CriticalPlay", type: "question", size: 2.5, particleCount: 6, dTheta: -0.08, dPhi: -0.22 },
  { label: '"CAPTCHA" (2025–)', cluster: "CriticalPlay", type: "work", size: 4, particleCount: 10, dTheta: 0.14, dPhi: -0.06 },
  { label: '"Chance-as-agency"', cluster: "CriticalPlay", type: "concept", size: 4, particleCount: 10, dTheta: 0.16, dPhi: -0.14 },

  // ── EPISTEMOLOGY ──
  { label: "EPISTEMOLOGY", cluster: "Epistemology", type: "header", size: 7, particleCount: 25, dTheta: 0, dPhi: 0 },
  { label: '"How?"', cluster: "Epistemology", type: "subtitle", size: 4.5, particleCount: 10, dTheta: 0, dPhi: -0.09 },
  { label: "A framework for Human-AI\nperforming system\n(Embodied Artificial Aesthetics)", cluster: "Epistemology", type: "concept", size: 3.5, particleCount: 12, dTheta: 0.12, dPhi: 0.06 },
  { label: "RQ: How to design live interfaces\nthat is posthumanist?", cluster: "Epistemology", type: "question", size: 2.5, particleCount: 6, dTheta: -0.06, dPhi: -0.16 },
  { label: "RQ: How to intentionally introduce\nglitch/errors as a methodology?", cluster: "Epistemology", type: "question", size: 2.5, particleCount: 6, dTheta: 0.06, dPhi: -0.20 },
  { label: "Artificial Aesthetics", cluster: "Epistemology", type: "concept", size: 5, particleCount: 14, dTheta: 0.18, dPhi: 0.10 },
  { label: "Manovich, Arielli", cluster: "Epistemology", type: "author", size: 3.5, particleCount: 10, dTheta: 0.20, dPhi: 0.04 },

  // ── HUMAN-LEARNING (central) ──
  { label: "human-learning", cluster: "HumanLearning", type: "central", size: 22, particleCount: 120, dTheta: 0, dPhi: 0 },

  // ── MACHINE LEARNING / AI ──
  { label: "Machine-Learning\nfoundational studies", cluster: "MachineLearning", type: "concept", size: 5, particleCount: 16, dTheta: 0, dPhi: 0.08 },
  { label: "Turing", cluster: "MachineLearning", type: "author", size: 4, particleCount: 10, dTheta: -0.06, dPhi: 0.00 },
  { label: "Mitchell", cluster: "MachineLearning", type: "author", size: 3, particleCount: 8, dTheta: -0.04, dPhi: -0.08 },
  { label: "Russell, Norvig", cluster: "MachineLearning", type: "author", size: 3.5, particleCount: 10, dTheta: -0.10, dPhi: -0.04 },
  { label: "AI", cluster: "MachineLearning", type: "concept", size: 5.5, particleCount: 16, dTheta: -0.04, dPhi: -0.16 },
  { label: "Mc Carthey, Minsky", cluster: "MachineLearning", type: "author", size: 3.5, particleCount: 10, dTheta: -0.08, dPhi: -0.22 },
  { label: "Critical AI", cluster: "MachineLearning", type: "concept", size: 5, particleCount: 14, dTheta: 0.14, dPhi: -0.14 },
  { label: "Bostrom, Searle, Dreyfus,\nSherry Turkle, Bratton", cluster: "MachineLearning", type: "author", size: 3, particleCount: 10, dTheta: 0.16, dPhi: -0.22 },

  // ── CYBERNETICS (under Ontology) ──
  { label: "Cybernetics", cluster: "Ontology", type: "concept", size: 4.5, particleCount: 14, dTheta: 0.16, dPhi: 0.06 },
  { label: "Wiener", cluster: "Ontology", type: "author", size: 3.5, particleCount: 10, dTheta: 0.18, dPhi: -0.02 },

  // ── PERFORMANCE STUDIES ──
  { label: "Performance Studies", cluster: "PerformanceStudies", type: "header", size: 8, particleCount: 28, dTheta: 0, dPhi: 0 },
  { label: "Live Interfaces", cluster: "PerformanceStudies", type: "concept", size: 5, particleCount: 14, dTheta: -0.22, dPhi: -0.02 },
  { label: "Sicchio", cluster: "PerformanceStudies", type: "author", size: 3.5, particleCount: 10, dTheta: -0.24, dPhi: -0.08 },
  { label: '"Choreography = Code"', cluster: "PerformanceStudies", type: "quote", size: 4, particleCount: 10, dTheta: -0.20, dPhi: -0.14 },
  { label: "Avant-garde", cluster: "PerformanceStudies", type: "concept", size: 4.5, particleCount: 12, dTheta: 0.04, dPhi: -0.10 },
  { label: '"Performing the machine"', cluster: "PerformanceStudies", type: "quote", size: 3.5, particleCount: 10, dTheta: 0.06, dPhi: -0.16 },
  { label: "Futurism", cluster: "PerformanceStudies", type: "concept", size: 3.5, particleCount: 10, dTheta: 0.12, dPhi: -0.12 },
  { label: "Dadaism", cluster: "PerformanceStudies", type: "concept", size: 3.5, particleCount: 10, dTheta: 0.14, dPhi: -0.18 },
  { label: '"Futile Machines"', cluster: "PerformanceStudies", type: "quote", size: 3.5, particleCount: 10, dTheta: 0.20, dPhi: -0.15 },
  { label: "Surrealism", cluster: "PerformanceStudies", type: "concept", size: 3.5, particleCount: 10, dTheta: 0.22, dPhi: -0.22 },
  { label: "Nam Jun Paik", cluster: "PerformanceStudies", type: "author", size: 3.5, particleCount: 10, dTheta: 0.24, dPhi: -0.28 },

  // ── ONTOLOGY ──
  { label: "Ontology", cluster: "Ontology", type: "header", size: 7, particleCount: 22, dTheta: 0, dPhi: 0 },
  { label: '"What?"', cluster: "Ontology", type: "subtitle", size: 4.5, particleCount: 10, dTheta: 0, dPhi: -0.09 },
  { label: "Cyborg", cluster: "Ontology", type: "concept", size: 5, particleCount: 14, dTheta: -0.06, dPhi: -0.16 },
  { label: "Haraway, Hayles", cluster: "Ontology", type: "author", size: 3.5, particleCount: 10, dTheta: -0.08, dPhi: -0.22 },
  { label: "Caronia", cluster: "Ontology", type: "author", size: 3, particleCount: 8, dTheta: -0.04, dPhi: -0.28 },
  { label: "Cybernetic Art", cluster: "Ontology", type: "concept", size: 4, particleCount: 12, dTheta: 0.20, dPhi: -0.10 },

  // ── AXIOLOGY ──
  { label: "Axiology", cluster: "Axiology", type: "header", size: 6.5, particleCount: 22, dTheta: 0, dPhi: 0 },
  { label: '"Value"', cluster: "Axiology", type: "subtitle", size: 4, particleCount: 10, dTheta: 0, dPhi: -0.09 },
  { label: "Taxonomy of AA in\nlive interface design", cluster: "Axiology", type: "item", size: 3, particleCount: 8, dTheta: 0.10, dPhi: -0.16 },
  { label: "Application of Critical Play\nin Posthumanism", cluster: "Axiology", type: "item", size: 3, particleCount: 8, dTheta: 0.06, dPhi: -0.22 },
  { label: "Hands on experience on designing\nhuman-AI live interface", cluster: "Axiology", type: "item", size: 3, particleCount: 8, dTheta: 0.12, dPhi: -0.26 },

  // ── NOISE ──
  { label: '"Noise"', cluster: "Noise", type: "quote", size: 7.5, particleCount: 22, dTheta: 0, dPhi: 0 },
  { label: "Ethics", cluster: "Noise", type: "concept", size: 3.5, particleCount: 10, dTheta: 0.10, dPhi: -0.08 },
  { label: "System visibility", cluster: "Noise", type: "concept", size: 3.5, particleCount: 10, dTheta: 0.12, dPhi: -0.14 },
  { label: "Human-AI collaboration", cluster: "Noise", type: "concept", size: 3.5, particleCount: 10, dTheta: 0.14, dPhi: -0.20 },

  // ── CYBERNETIC PERFORMANCES ──
  { label: "Cybernetic performances", cluster: "CyberneticPerformances", type: "concept", size: 5.5, particleCount: 20, dTheta: 0, dPhi: 0 },
  { label: "Dixon Steve", cluster: "CyberneticPerformances", type: "author", size: 3.5, particleCount: 10, dTheta: -0.06, dPhi: -0.10 },
  { label: "Michael J. Apter", cluster: "CyberneticPerformances", type: "author", size: 3.5, particleCount: 10, dTheta: -0.04, dPhi: -0.16 },
  { label: "Donnarumma", cluster: "CyberneticPerformances", type: "author", size: 3.5, particleCount: 10, dTheta: -0.08, dPhi: -0.22 },
  { label: '"Feedback loop"', cluster: "CyberneticPerformances", type: "quote", size: 4, particleCount: 10, dTheta: 0.10, dPhi: -0.08 },
  { label: '"Recursivity"', cluster: "CyberneticPerformances", type: "quote", size: 4, particleCount: 10, dTheta: 0.12, dPhi: -0.16 },

  // ── PERFORMA AUTOMATA ──
  { label: '"Performa Automata" (2025–)', cluster: "PerformaAutomata", type: "work", size: 5.5, particleCount: 18, dTheta: 0, dPhi: 0 },

  // ── THE AUDIENCE ──
  { label: "The Audience", cluster: "Audience", type: "header", size: 8, particleCount: 28, dTheta: 0, dPhi: 0 },
  { label: "Spectatorship", cluster: "Audience", type: "concept", size: 4, particleCount: 10, dTheta: 0.06, dPhi: -0.12 },
];

// ── Connection definitions ──
const connectionDefs: [string, string, number, boolean][] = [
  // [from, to, strength, isCrossCluster]

  // Methodology internal
  ["METHODOLOGY", '"The Process"', 0.9, false],
  ["METHODOLOGY", "Critical Speculative Design", 0.7, false],
  ["Critical Speculative Design", "Dunne & Raby", 0.85, false],
  ["Critical Speculative Design", "Auger", 0.75, false],
  ["METHODOLOGY", "Cosmotechnics", 0.6, false],
  ["Cosmotechnics", "Yuk Hui", 0.9, false],
  ["Cosmotechnics", "Contingency", 0.7, false],

  // Error/Glitch internal
  ['"Error"', '"The Fall" (2018)', 0.8, false],
  ['"Error"', '"Glitch"', 0.9, false],
  ['"Glitch"', '"Human-Learning" (2021)', 0.75, false],

  // Praxis internal
  ["Praxis: Design as Research", "Critical Posthumanism", 0.85, false],
  ["Critical Posthumanism", "Braidotti, Fernando", 0.9, false],
  ["Critical Posthumanism", "Posthuman design", 0.75, false],
  ["Posthuman design", "Wakkary (2024)", 0.85, false],
  ["Posthuman design", "Forlano", 0.7, false],

  // Critical Play internal
  ["Critical Play", '"CAPTCHA" (2025–)', 0.7, false],
  ["Critical Play", '"Chance-as-agency"', 0.65, false],
  ["Critical Play", "RQ: How to apply posthumanism\ninto Critical/Speculative Design?", 0.5, false],
  ["Critical Play", "RQ: How critical play is applied\nto embody the machines?", 0.5, false],
  ["Critical Play", "RQ: What can be learnt from\nnext to experiences?\n(empathy AI instances)", 0.5, false],

  // Epistemology internal
  ["EPISTEMOLOGY", '"How?"', 0.9, false],
  ["EPISTEMOLOGY", "A framework for Human-AI\nperforming system\n(Embodied Artificial Aesthetics)", 0.7, false],
  ["EPISTEMOLOGY", "Artificial Aesthetics", 0.6, false],
  ["Artificial Aesthetics", "Manovich, Arielli", 0.9, false],

  // Machine Learning internal
  ["Machine-Learning\nfoundational studies", "Turing", 0.9, false],
  ["Machine-Learning\nfoundational studies", "Mitchell", 0.8, false],
  ["Machine-Learning\nfoundational studies", "Russell, Norvig", 0.85, false],
  ["AI", "Mc Carthey, Minsky", 0.9, false],
  ["AI", "Critical AI", 0.7, false],
  ["Critical AI", "Bostrom, Searle, Dreyfus,\nSherry Turkle, Bratton", 0.9, false],
  ["Machine-Learning\nfoundational studies", "AI", 0.65, false],

  // Performance Studies internal
  ["Performance Studies", "Live Interfaces", 0.7, false],
  ["Live Interfaces", "Sicchio", 0.9, false],
  ["Live Interfaces", '"Choreography = Code"', 0.8, false],
  ["Performance Studies", "Avant-garde", 0.7, false],
  ["Avant-garde", '"Performing the machine"', 0.8, false],
  ["Avant-garde", "Futurism", 0.7, false],
  ["Avant-garde", "Dadaism", 0.7, false],
  ["Dadaism", '"Futile Machines"', 0.65, false],
  ['"Futile Machines"', "Surrealism", 0.6, false],
  ["Surrealism", "Nam Jun Paik", 0.7, false],

  // Ontology internal
  ["Ontology", '"What?"', 0.9, false],
  ["Ontology", "Cyborg", 0.75, false],
  ["Cyborg", "Haraway, Hayles", 0.9, false],
  ["Cyborg", "Caronia", 0.7, false],
  ["Ontology", "Cybernetics", 0.65, false],
  ["Cybernetics", "Wiener", 0.9, false],
  ["Cybernetics", "Cybernetic Art", 0.7, false],

  // Axiology internal
  ["Axiology", '"Value"', 0.9, false],
  ["Axiology", "Taxonomy of AA in\nlive interface design", 0.6, false],
  ["Axiology", "Application of Critical Play\nin Posthumanism", 0.6, false],
  ["Axiology", "Hands on experience on designing\nhuman-AI live interface", 0.6, false],

  // Noise internal
  ['"Noise"', "Ethics", 0.7, false],
  ['"Noise"', "System visibility", 0.7, false],
  ['"Noise"', "Human-AI collaboration", 0.7, false],

  // Cybernetic performances internal
  ["Cybernetic performances", "Dixon Steve", 0.8, false],
  ["Cybernetic performances", "Michael J. Apter", 0.8, false],
  ["Cybernetic performances", "Donnarumma", 0.8, false],
  ["Cybernetic performances", '"Feedback loop"', 0.7, false],
  ["Cybernetic performances", '"Recursivity"', 0.7, false],

  // Audience internal
  ["The Audience", "Spectatorship", 0.9, false],

  // ═══════════════════════════════════════
  // CROSS-CLUSTER BRIDGES
  // ═══════════════════════════════════════

  // human-learning → ALL clusters (central hub, the pattern that emerges)
  ["human-learning", "METHODOLOGY", 0.5, true],
  ["human-learning", "EPISTEMOLOGY", 0.6, true],
  ["human-learning", "Ontology", 0.5, true],
  ["human-learning", "Machine-Learning\nfoundational studies", 0.7, true],
  ["human-learning", '"Error"', 0.45, true],
  ["human-learning", "Artificial Aesthetics", 0.5, true],
  ["human-learning", "Performance Studies", 0.4, true],
  ["human-learning", '"Performa Automata" (2025–)', 0.5, true],
  ["human-learning", "Praxis: Design as Research", 0.45, true],
  ["human-learning", "Critical Play", 0.4, true],
  ["human-learning", "Axiology", 0.4, true],
  ["human-learning", '"Noise"', 0.35, true],
  ["human-learning", "Cybernetic performances", 0.4, true],
  ["human-learning", "The Audience", 0.35, true],
  ["human-learning", '"Glitch"', 0.4, true],
  ["human-learning", "Cybernetics", 0.4, true],
  ["human-learning", "Critical AI", 0.35, true],
  ["human-learning", "Critical Posthumanism", 0.4, true],

  // Methodology ↔ Praxis
  ["Praxis: Design as Research", "METHODOLOGY", 0.6, true],
  ["Critical Speculative Design", "Critical Posthumanism", 0.5, true],

  // Error/Glitch ↔ Praxis
  ['"Error"', "Praxis: Design as Research", 0.5, true],
  ['"Glitch"', "EPISTEMOLOGY", 0.45, true],

  // Critical Play ↔ Praxis
  ["Critical Play", "Praxis: Design as Research", 0.5, true],
  ["Critical Play", "Critical Posthumanism", 0.4, true],

  // Epistemology ↔ Performance
  ["Live Interfaces", "EPISTEMOLOGY", 0.45, true],
  ["Artificial Aesthetics", "Machine-Learning\nfoundational studies", 0.4, true],

  // Ontology ↔ Cybernetic Performances
  ["Cybernetic Art", "Cybernetic performances", 0.7, true],
  ["Cybernetics", "Cybernetic performances", 0.65, true],
  ["Cybernetics", '"Feedback loop"', 0.5, true],

  // Performa Automata bridges
  ['"Performa Automata" (2025–)', "The Audience", 0.6, true],
  ['"Performa Automata" (2025–)', "Cybernetic performances", 0.55, true],
  ['"Performa Automata" (2025–)', "Performance Studies", 0.4, true],

  // Noise ↔ Axiology
  ['"Noise"', "Axiology", 0.4, true],
  ['"Noise"', "Ethics", 0.7, false],
  ["Human-AI collaboration", "human-learning", 0.35, true],

  // Axiology ↔ Critical Play
  ["Axiology", "Critical Play", 0.5, true],
  ["Application of Critical Play\nin Posthumanism", "Critical Play", 0.6, true],

  // Ontology ↔ Epistemology
  ["Ontology", "EPISTEMOLOGY", 0.5, true],
  ["Cyborg", "Critical Posthumanism", 0.45, true],

  // Critical AI ↔ Cybernetics
  ["Critical AI", "Cybernetics", 0.4, true],

  // Performance ↔ Cybernetic performances
  ["Performance Studies", "Cybernetic performances", 0.5, true],
  ["Nam Jun Paik", "Cybernetic Art", 0.5, true],

  // AI ↔ human-learning
  ["AI", "human-learning", 0.55, true],
];

export function generateLatentSpace3D(): {
  nodes: Node3D[];
  edges: Edge3D[];
  particles: Particle3D[];
} {
  const nodes: Node3D[] = [];
  const labelToId = new Map<string, string>();

  for (const def of nodeDefs) {
    const cl = clusterMap.get(def.cluster);
    if (!cl) continue;

    // Central node lives at origin (0,0,0) — it emerges from the center of the sphere
    let x: number, y: number, z: number;
    if (def.type === "central") {
      x = 0; y = 0; z = 0;
    } else {
      const theta = cl.theta + (def.dTheta || 0);
      const phi = cl.phi + (def.dPhi || 0);
      const r = SPHERE_R + (def.dR || 0);
      const pos = sphereToXYZ(theta, phi, r);
      x = pos.x; y = pos.y; z = pos.z;
    }

    labelToId.set(def.label, def.label);

    nodes.push({
      id: def.label,
      label: def.label,
      x, y, z,
      cluster: def.cluster,
      color: cl.color,
      size: def.size,
      type: def.type,
      particleCount: def.particleCount,
      connections: [],
    });
  }

  const edges: Edge3D[] = [];

  for (const [fromLabel, toLabel, strength, isCross] of connectionDefs) {
    const fromId = labelToId.get(fromLabel);
    const toId = labelToId.get(toLabel);
    if (fromId && toId) {
      edges.push({ from: fromId, to: toId, strength, isCross });
      const fn = nodes.find(n => n.id === fromId);
      const tn = nodes.find(n => n.id === toId);
      if (fn && !fn.connections.includes(toId)) fn.connections.push(toId);
      if (tn && !tn.connections.includes(fromId)) tn.connections.push(fromId);
    }
  }

  // Particles
  const particles: Particle3D[] = [];
  for (const node of nodes) {
    const pRng = createRng(hashStr(node.id + "_sp"));
    for (let i = 0; i < node.particleCount; i++) {
      const orbitRadius = seededGaussian(pRng, node.size * 2.2, node.size * 1.0);
      const orbitAngle = pRng() * Math.PI * 2;
      const orbitTilt = (pRng() - 0.5) * Math.PI;
      const px = node.x + Math.cos(orbitAngle) * Math.cos(orbitTilt) * orbitRadius;
      const py = node.y + Math.sin(orbitAngle) * Math.cos(orbitTilt) * orbitRadius;
      const pz = node.z + Math.sin(orbitTilt) * orbitRadius;

      particles.push({
        x: px, y: py, z: pz,
        baseX: node.x, baseY: node.y, baseZ: node.z,
        size: pRng() * 1.2 + 0.2,
        opacity: pRng() * 0.4 + 0.08,
        speed: pRng() * 0.4 + 0.1,
        phase: pRng() * Math.PI * 2,
        orbitRadius, orbitAngle, orbitTilt,
        color: node.color,
      });
    }
  }

  // Ambient particles on a larger sphere shell
  const ambRng = createRng(hashStr("ambient_sphere_litrev"));
  for (let i = 0; i < 250; i++) {
    const theta = ambRng() * Math.PI * 2;
    const phi = (ambRng() - 0.5) * Math.PI;
    const r = SPHERE_R * (0.7 + ambRng() * 0.9);
    const p = sphereToXYZ(theta, phi, r);
    particles.push({
      x: p.x, y: p.y, z: p.z,
      baseX: p.x, baseY: p.y, baseZ: p.z,
      size: ambRng() * 0.9 + 0.1,
      opacity: ambRng() * 0.08 + 0.015,
      speed: ambRng() * 0.06 + 0.02,
      phase: ambRng() * Math.PI * 2,
      orbitRadius: ambRng() * 12 + 2,
      orbitAngle: ambRng() * Math.PI * 2,
      orbitTilt: (ambRng() - 0.5) * Math.PI,
      color: "#6b7280",
    });
  }

  return { nodes, edges, particles };
}