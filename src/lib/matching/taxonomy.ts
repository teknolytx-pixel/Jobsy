/**
 * SKILL RELATEDNESS + ROLE FAMILIES
 *
 * The old engine compared skill strings for equality, which produces two
 * failures that dominate real results:
 *
 *   1. A Vue developer scores ZERO on a React job, though the transfer is
 *      obvious to any hiring manager.
 *   2. A Product Designer scores WELL on a Backend Engineer job whenever a
 *      token like "Design Systems" happens to appear in both, though no
 *      recruiter would ever look at that candidate.
 *
 * (1) needs a graph of how close two skills are. (2) needs a notion of what
 * KIND of job this is, independent of the skill list.
 *
 * Both are deliberately hand-authored rather than learned. A hiring ranker has
 * to be auditable — under NYC Local Law 144 and Colorado SB 24-205 you must be
 * able to explain, to a third-party assessor, why a candidate ranked where they
 * did. A readable table does that; a weight matrix does not.
 */

// ─────────────────────────────────────────────────────────────
// SKILL ADJACENCY
//
// Weight = credit a candidate gets toward skill A for holding skill B.
// 1.0 would be "identical"; we never assert that. Transfer is not symmetric in
// reality (React→Preact is easier than Preact→React) but modelling direction
// costs more than it buys, so edges are symmetric and deliberately modest.
// ─────────────────────────────────────────────────────────────
type Edge = [string, string, number];

const EDGES: Edge[] = [
  // --- frontend frameworks: concepts transfer, syntax doesn't ---
  ["React", "Vue", 0.55],
  ["React", "Angular", 0.5],
  ["React", "Svelte", 0.55],
  ["Vue", "Svelte", 0.6],
  ["Vue", "Angular", 0.5],
  ["React", "Next.js", 0.85], // Next is React
  ["React", "React Native", 0.6], // same model, different platform

  // --- languages ---
  ["TypeScript", "JavaScript", 0.85], // superset; nearly interchangeable
  ["JavaScript", "Node.js", 0.7],
  ["TypeScript", "Node.js", 0.65],
  ["Java", "C#", 0.6], // same paradigm, similar ecosystems
  ["Java", "Kotlin", 0.8],
  ["Swift", "Kotlin", 0.45], // both modern mobile-native
  ["Python", "Ruby", 0.45],
  ["Go", "Rust", 0.45],
  ["Go", "Java", 0.4],

  // --- mobile ---
  ["iOS", "Swift", 0.85],
  ["Android", "Kotlin", 0.85],
  ["React Native", "iOS", 0.4],
  ["React Native", "Android", 0.4],
  ["iOS", "Android", 0.5],

  // --- cloud: the concepts port, the console doesn't ---
  ["AWS", "GCP", 0.65],
  ["AWS", "Azure", 0.65],
  ["GCP", "Azure", 0.65],

  // --- infra ---
  ["Kubernetes", "Docker", 0.7],
  ["Kubernetes", "Terraform", 0.5],
  ["Terraform", "CICD", 0.45],
  ["CICD", "Docker", 0.5],
  ["Observability", "CICD", 0.4],
  ["Kubernetes", "Distributed Systems", 0.5],

  // --- data ---
  ["SQL", "NoSQL", 0.5],
  ["SQL", "Data Modeling", 0.6],
  ["dbt", "SQL", 0.7],
  ["dbt", "Data Modeling", 0.75],
  ["Snowflake", "SQL", 0.6],
  ["Snowflake", "Spark", 0.45],
  ["Spark", "Python", 0.4],
  ["Airflow", "Python", 0.4],
  ["Airflow", "dbt", 0.5],
  ["Kafka", "Distributed Systems", 0.6],

  // --- ML ---
  ["PyTorch", "TensorFlow", 0.75],
  ["PyTorch", "Machine Learning", 0.85],
  ["TensorFlow", "Machine Learning", 0.85],
  ["MLOps", "Machine Learning", 0.65],
  ["MLOps", "CICD", 0.5],
  ["LLM APIs", "Machine Learning", 0.5],
  ["LLM APIs", "Python", 0.35],

  // --- visualisation ---
  ["D3.js", "Data Visualization", 0.85],
  ["Data Visualization", "Data Modeling", 0.35],
  ["D3.js", "JavaScript", 0.5],

  // --- design ---
  ["Figma", "Prototyping", 0.65],
  ["Figma", "Design Systems", 0.6],
  ["Design Systems", "Accessibility", 0.4],
  ["User Research", "Prototyping", 0.4],

  // --- api styles ---
  ["GraphQL", "REST", 0.6],
  ["REST", "Node.js", 0.4],

  // --- leadership ---
  ["Leadership", "Recruiting", 0.5],
  ["Leadership", "Architecture", 0.4],
  ["Architecture", "Distributed Systems", 0.55],
];

const ADJACENCY: Map<string, Map<string, number>> = (() => {
  const m = new Map<string, Map<string, number>>();
  const link = (a: string, b: string, w: number) => {
    if (!m.has(a)) m.set(a, new Map());
    const existing = m.get(a)!.get(b) ?? 0;
    if (w > existing) m.get(a)!.set(b, w);
  };
  for (const [a, b, w] of EDGES) {
    link(a, b, w);
    link(b, a, w);
  }
  return m;
})();

/**
 * How much credit `have` gives toward `need`. 1 = exact, 0 = unrelated.
 * Only one hop — transitive chains (React→Vue→Svelte) decay to noise fast and
 * would let a candidate "reach" almost any skill through enough hops.
 */
export function skillCredit(need: string, have: string): number {
  if (need.toLowerCase() === have.toLowerCase()) return 1;
  return ADJACENCY.get(need)?.get(have) ?? 0;
}

/** Best credit any of the candidate's skills gives toward one required skill. */
export function bestCredit(need: string, candidateSkills: string[]): { credit: number; via: string | null } {
  let best = 0;
  let via: string | null = null;
  for (const have of candidateSkills) {
    const c = skillCredit(need, have);
    if (c > best) {
      best = c;
      via = have;
    }
  }
  return { credit: best, via: best === 1 ? need : via };
}

// ─────────────────────────────────────────────────────────────
// ROLE FAMILIES
//
// The single highest-value signal the old engine lacked. Skill overlap between
// two different professions is mostly coincidence, so family is applied as a
// multiplier rather than as points — a designer on a backend role should not be
// "a bit lower", they should be effectively out.
// ─────────────────────────────────────────────────────────────
export type RoleFamily =
  | "FRONTEND"
  | "BACKEND"
  | "FULLSTACK"
  | "MOBILE"
  | "PLATFORM"
  | "DATA_ENG"
  | "DATA_SCIENCE"
  | "ML"
  | "SECURITY"
  | "QA"
  | "DESIGN"
  | "PRODUCT"
  | "SALES"
  | "MARKETING"
  | "SUPPORT"
  | "FINANCE"
  | "PEOPLE"
  | "OPERATIONS"
  | "UNKNOWN";

/** Ordered — first match wins, so put the specific before the generic. */
const FAMILY_RULES: [RegExp, RoleFamily][] = [
  [/\b(ios|android|mobile|react native|flutter)\b/i, "MOBILE"],
  [/\b(sre|site reliability|platform|infrastructure|devops|cloud engineer)\b/i, "PLATFORM"],
  [/\b(security|appsec|infosec|penetration|soc analyst)\b/i, "SECURITY"],
  [/\b(qa|quality assurance|test engineer|sdet|automation engineer)\b/i, "QA"],
  [/\b(machine learning|ml engineer|ai engineer|deep learning|nlp|computer vision|research scientist)\b/i, "ML"],
  [/\b(data scientist|data science|statistician|quantitative analyst)\b/i, "DATA_SCIENCE"],
  [/\b(data engineer|analytics engineer|data platform|etl|bi engineer|business intelligence)\b/i, "DATA_ENG"],
  [/\b(full[\s-]?stack)\b/i, "FULLSTACK"],
  [/\b(front[\s-]?end|ui engineer|web engineer|javascript engineer)\b/i, "FRONTEND"],
  [/\b(back[\s-]?end|server[\s-]?side|api engineer)\b/i, "BACKEND"],
  [/\b(designer|design lead|ux|ui designer|product design|graphic|brand)\b/i, "DESIGN"],
  [/\b(product manager|product owner|program manager|tpm|product lead)\b/i, "PRODUCT"],
  [/\b(sales|account executive|business development|solutions architect|sales engineer|presales)\b/i, "SALES"],
  [/\b(marketing|growth|seo|content|demand gen|brand manager)\b/i, "MARKETING"],
  [/\b(support|customer success|help ?desk|technical account)\b/i, "SUPPORT"],
  [/\b(finance|accountant|controller|fp&a|bookkeep)\b/i, "FINANCE"],
  [/\b(recruiter|talent|people ops|human resources|hr business)\b/i, "PEOPLE"],
  [/\b(operations|logistics|supply chain|office manager)\b/i, "OPERATIONS"],
  // generic engineering last — only if nothing more specific matched
  [/\b(software engineer|swe|developer|programmer|engineer)\b/i, "FULLSTACK"],
];

export function roleFamily(title: string, description = ""): RoleFamily {
  // Title carries far more signal than the body, which is full of boilerplate
  // about the company. Check it alone first.
  for (const [re, fam] of FAMILY_RULES) if (re.test(title)) return fam;
  const head = description.slice(0, 500);
  for (const [re, fam] of FAMILY_RULES) if (re.test(head)) return fam;
  return "UNKNOWN";
}

/**
 * Cross-family compatibility, 0..1, used as a multiplier on the skills score.
 * Anything not listed falls back to DEFAULT_CROSS.
 */
const DEFAULT_CROSS = 0.25;
const SAME = 1;

const CROSS: Partial<Record<RoleFamily, Partial<Record<RoleFamily, number>>>> = {
  FRONTEND: { FULLSTACK: 0.85, MOBILE: 0.6, DESIGN: 0.35, BACKEND: 0.45 },
  BACKEND: { FULLSTACK: 0.85, PLATFORM: 0.65, DATA_ENG: 0.5, FRONTEND: 0.45 },
  FULLSTACK: { FRONTEND: 0.85, BACKEND: 0.85, MOBILE: 0.55, PLATFORM: 0.5, DATA_ENG: 0.4 },
  MOBILE: { FRONTEND: 0.6, FULLSTACK: 0.55 },
  PLATFORM: { BACKEND: 0.65, DATA_ENG: 0.45, SECURITY: 0.45, FULLSTACK: 0.5 },
  DATA_ENG: { DATA_SCIENCE: 0.6, ML: 0.5, BACKEND: 0.5, PLATFORM: 0.45 },
  DATA_SCIENCE: { ML: 0.75, DATA_ENG: 0.6 },
  ML: { DATA_SCIENCE: 0.75, DATA_ENG: 0.5, BACKEND: 0.35 },
  SECURITY: { PLATFORM: 0.45, BACKEND: 0.35 },
  QA: { FRONTEND: 0.4, BACKEND: 0.4, FULLSTACK: 0.4 },
  DESIGN: { PRODUCT: 0.4, FRONTEND: 0.35 },
  PRODUCT: { DESIGN: 0.4, MARKETING: 0.3 },
  SALES: { MARKETING: 0.4, SUPPORT: 0.35 },
  MARKETING: { SALES: 0.4, PRODUCT: 0.3 },
  SUPPORT: { SALES: 0.35, OPERATIONS: 0.35 },
  PEOPLE: { OPERATIONS: 0.35 },
};

export function familyCompatibility(jobFamily: RoleFamily, candFamily: RoleFamily): number {
  if (jobFamily === candFamily) return SAME;
  // An unknown on either side means we simply couldn't classify. Staying
  // neutral is right: penalising would silently bury anyone with an unusual
  // job title, which is exactly the kind of arbitrary exclusion a bias audit
  // would flag.
  if (jobFamily === "UNKNOWN" || candFamily === "UNKNOWN") return 0.8;
  return CROSS[jobFamily]?.[candFamily] ?? DEFAULT_CROSS;
}

export const FAMILY_LABEL: Record<RoleFamily, string> = {
  FRONTEND: "Frontend",
  BACKEND: "Backend",
  FULLSTACK: "Full stack",
  MOBILE: "Mobile",
  PLATFORM: "Platform / SRE",
  DATA_ENG: "Data engineering",
  DATA_SCIENCE: "Data science",
  ML: "Machine learning",
  SECURITY: "Security",
  QA: "QA",
  DESIGN: "Design",
  PRODUCT: "Product",
  SALES: "Sales",
  MARKETING: "Marketing",
  SUPPORT: "Support",
  FINANCE: "Finance",
  PEOPLE: "People / Talent",
  OPERATIONS: "Operations",
  UNKNOWN: "Unclassified",
};
