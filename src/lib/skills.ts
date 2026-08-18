/**
 * Skill normalisation + extraction.
 *
 * Job feeds give you unstructured prose, not tidy skill arrays. This maps the
 * many ways a skill is written ("react.js", "ReactJS", "React 18") onto one
 * canonical token so the match engine compares apples to apples.
 */

export const SKILL_ALIASES: Record<string, string[]> = {
  React: ["react", "react.js", "reactjs", "react 18", "react18", "react hooks"],
  "React Native": ["react native", "react-native", "reactnative"],
  TypeScript: ["typescript", "ts", "type script"],
  JavaScript: ["javascript", "js", "es6", "ecmascript", "vanilla js"],
  "Node.js": ["node", "node.js", "nodejs", "express", "express.js", "nestjs", "nest.js"],
  Python: ["python", "python3", "py"],
  Go: ["golang", "go lang", " go "],
  Java: ["java", "spring boot", "springboot"],
  Ruby: ["ruby", "ruby on rails", "rails"],
  "C#": ["c#", "csharp", ".net", "dotnet", "asp.net"],
  PHP: ["php", "laravel", "symfony"],
  Rust: ["rust", "rustlang"],
  Kotlin: ["kotlin"],
  Swift: ["swift", "swiftui"],
  "Next.js": ["next.js", "nextjs", "next js"],
  Vue: ["vue", "vue.js", "vuejs", "nuxt"],
  Angular: ["angular", "angular.js", "angularjs"],
  Svelte: ["svelte", "sveltekit"],
  GraphQL: ["graphql", "graph ql", "apollo"],
  REST: ["rest", "restful", "rest api", "restful api"],
  SQL: ["sql", "postgres", "postgresql", "mysql", "sql server", "t-sql", "plsql"],
  NoSQL: ["nosql", "mongodb", "mongo", "dynamodb", "cassandra"],
  Redis: ["redis", "memcached"],
  Kafka: ["kafka", "event streaming", "pub/sub", "rabbitmq"],
  AWS: ["aws", "amazon web services", "ec2", "s3", "lambda", "cloudfront"],
  GCP: ["gcp", "google cloud", "bigquery", "cloud run"],
  Azure: ["azure", "microsoft azure"],
  Kubernetes: ["kubernetes", "k8s", "eks", "gke"],
  Docker: ["docker", "containers", "containerization"],
  Terraform: ["terraform", "iac", "infrastructure as code", "pulumi"],
  CICD: ["ci/cd", "cicd", "continuous integration", "github actions", "jenkins", "circleci"],
  Observability: ["observability", "datadog", "prometheus", "grafana", "opentelemetry", "monitoring"],
  "Distributed Systems": ["distributed systems", "microservices", "micro-services", "service mesh"],
  "D3.js": ["d3", "d3.js", "d3js"],
  "Data Visualization": ["data visualization", "data viz", "dataviz", "charting", "visualisation"],
  "Data Modeling": ["data modeling", "data modelling", "dimensional modeling", "star schema"],
  dbt: ["dbt", "data build tool"],
  Snowflake: ["snowflake"],
  Spark: ["spark", "pyspark", "databricks"],
  Airflow: ["airflow", "dagster", "prefect", "orchestration"],
  PyTorch: ["pytorch", "torch"],
  TensorFlow: ["tensorflow", "keras"],
  "LLM APIs": ["llm", "large language model", "openai", "anthropic", "claude", "gpt-4", "gpt4", "rag", "prompt engineering"],
  MLOps: ["mlops", "ml ops", "model deployment", "feature store"],
  "Machine Learning": ["machine learning", "ml", "deep learning", "nlp", "computer vision"],
  Figma: ["figma", "sketch", "adobe xd"],
  "Design Systems": ["design system", "design systems", "component library", "storybook"],
  Prototyping: ["prototyping", "wireframing", "wireframes"],
  "User Research": ["user research", "ux research", "usability testing", "user interviews"],
  Accessibility: ["accessibility", "a11y", "wcag", "screen reader"],
  Testing: ["testing", "jest", "vitest", "playwright", "cypress", "unit test", "e2e", "test coverage"],
  Architecture: ["architecture", "system design", "technical design"],
  Leadership: ["leadership", "team lead", "tech lead", "engineering manager", "people management", "mentoring"],
  // Canonical name is "Recruiting", not "Hiring": every canon matches its own
  // name, and "we are hiring" appears in nearly every job description — using
  // "Hiring" would tag every posting on the site with a recruiting skill.
  Recruiting: ["hiring manager", "technical recruiting", "talent acquisition", "interviewing candidates"],
  Presales: ["presales", "pre-sales", "solutions consulting", "sales engineering"],
  Security: ["security", "appsec", "infosec", "penetration testing", "soc2", "oauth"],
  iOS: ["ios", "objective-c", "xcode"],
  Android: ["android", "jetpack compose"],
};

const CANON = Object.keys(SKILL_ALIASES);

const LOOKUP: Map<string, string> = (() => {
  const m = new Map<string, string>();
  for (const canon of CANON) {
    m.set(canon.toLowerCase(), canon);
    for (const a of SKILL_ALIASES[canon]) m.set(a.trim().toLowerCase(), canon);
  }
  return m;
})();

/** Map one free-text skill string onto its canonical form (or title-case it). */
export function normalizeSkill(raw: string): string {
  const k = raw.trim().toLowerCase().replace(/\s+/g, " ");
  if (!k) return "";
  return LOOKUP.get(k) ?? raw.trim().replace(/\s+/g, " ");
}

export function normalizeSkills(raw: string[]): string[] {
  const out = new Set<string>();
  for (const s of raw) {
    const n = normalizeSkill(s);
    if (n) out.add(n);
  }
  return [...out];
}

/**
 * Pull canonical skills out of a job description. Word-boundary matched so
 * "go" doesn't fire on "going" and "ml" doesn't fire on "html".
 */
export function extractSkills(text: string, limit = 12): string[] {
  if (!text) return [];
  const hay = " " + text.toLowerCase().replace(/[^a-z0-9+#./ -]/g, " ").replace(/\s+/g, " ") + " ";
  const hits: { skill: string; at: number }[] = [];

  for (const canon of CANON) {
    for (const alias of [canon, ...SKILL_ALIASES[canon]]) {
      const a = alias.trim().toLowerCase();
      if (!a) continue;
      const esc = a.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const re = new RegExp(`(^|[^a-z0-9+#])${esc}([^a-z0-9+#]|$)`);
      const m = re.exec(hay);
      if (m) {
        hits.push({ skill: canon, at: m.index });
        break;
      }
    }
  }
  return hits.sort((a, b) => a.at - b.at).slice(0, limit).map((h) => h.skill);
}

const SENIORITY_RULES: [RegExp, string][] = [
  [/\b(vp|vice president|head of|director)\b/i, "Director"],
  [/\b(principal|staff|distinguished)\b/i, "Principal"],
  [/\b(manager|engineering manager|em)\b/i, "Lead"],
  [/\b(lead|team lead|tech lead)\b/i, "Lead"],
  [/\b(sr\.?|senior)\b/i, "Senior"],
  [/\b(jr\.?|junior|entry.level|graduate|new grad|intern)\b/i, "Junior"],
];

export function inferSeniority(title: string, description = ""): string {
  const hay = `${title} ${description.slice(0, 400)}`;
  for (const [re, level] of SENIORITY_RULES) if (re.test(hay)) return level;
  return "Mid";
}

const SENIORITY_RANK: Record<string, number> = {
  Junior: 1,
  Mid: 2,
  Senior: 3,
  Lead: 4,
  Principal: 4,
  Director: 5,
};
export const seniorityRank = (s: string): number => SENIORITY_RANK[s] ?? 2;
