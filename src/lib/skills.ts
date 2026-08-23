/**
 * Skill normalisation + extraction.
 *
 * Job feeds give you unstructured prose, not tidy skill arrays. This maps the
 * many ways a skill is written ("react.js", "ReactJS", "React 18") onto one
 * canonical token so the match engine compares apples to apples.
 *
 * ── ALIAS vs ADJACENCY: the distinction this table kept getting wrong ──
 *
 * An ALIAS is another spelling of the SAME skill. "react.js" and "React" are
 * one skill written two ways, and collapsing them loses nothing.
 *
 * An ADJACENT skill is a DIFFERENT skill that transfers. Databricks and Spark
 * are not the same thing; someone who knows one can probably learn the other.
 * That belongs in the adjacency graph in matching/taxonomy.ts, where it earns
 * PARTIAL credit and stays visible as a distinct skill.
 *
 * This table used to conflate the two, which is what a candidate reported:
 * entering "SQL, Python, PySpark, Databricks" stored THREE skills, because
 * `Spark: ["spark", "pyspark", "databricks"]` collapsed the last two into one
 * token. A Databricks role and a generic Spark role then looked identical to
 * the ranker, and the candidate's four stated skills could never all be shown
 * back to them because the fourth no longer existed.
 *
 * The rule when adding an entry: if a recruiter would accept the two words as
 * interchangeable on a CV, it is an alias. If they would ask a follow-up
 * question about it in a screen, it is a separate skill with an adjacency edge.
 *
 * ── What this does NOT do ──
 *
 * Rows written before this split still hold the collapsed token — a profile
 * that says "Spark" may have been typed as "Databricks" months ago, and that
 * intent is not recoverable. No backfill is attempted, because guessing which
 * of three meanings a stored token had would put words in users' mouths. The
 * adjacency edges added alongside this change mean those profiles keep matching
 * strongly; they are simply less specific than ones written from now on.
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
  // Generic query skill. The specific engines below are separate skills, not
  // spellings of this one: "we run Oracle" and "we run Postgres" are different
  // enough that a recruiter asks about it, which is the test for a split.
  SQL: ["sql", "ansi sql", "sql queries"],
  PostgreSQL: ["postgres", "postgresql", "psql", "pg"],
  MySQL: ["mysql", "mariadb"],
  "SQL Server": ["sql server", "t-sql", "tsql", "mssql", "microsoft sql server"],
  Oracle: ["oracle", "plsql", "pl/sql", "oracle db"],
  NoSQL: ["nosql", "document database"],
  MongoDB: ["mongodb", "mongo"],
  DynamoDB: ["dynamodb", "dynamo db"],
  Cassandra: ["cassandra", "scylladb"],
  Redis: ["redis", "memcached"],
  Kafka: ["kafka", "apache kafka", "event streaming"],
  RabbitMQ: ["rabbitmq", "rabbit mq", "amqp"],
  // "lambda" alone is not an alias for AWS — "lambda expressions" and "lambda
  // functions" appear in job descriptions about Java, Python and C# far more
  // often than they refer to the AWS product. Word-boundary matching does not
  // help, because the word really is "lambda" in both cases.
  AWS: ["aws", "amazon web services", "ec2", "s3", "aws lambda", "cloudfront"],
  GCP: ["gcp", "google cloud", "cloud run"],
  BigQuery: ["bigquery", "big query"],
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
  // The three that prompted this whole change. A data engineer who writes all
  // of "Spark, PySpark, Databricks" is telling you something specific about
  // their stack, and the ranker should be able to hear it.
  Spark: ["spark", "apache spark", "spark sql"],
  PySpark: ["pyspark", "py spark"],
  Databricks: ["databricks", "azure databricks", "delta lake", "unity catalog"],
  Airflow: ["airflow", "apache airflow", "orchestration"],
  Dagster: ["dagster"],
  Prefect: ["prefect"],
  PyTorch: ["pytorch", "torch"],
  TensorFlow: ["tensorflow", "keras"],
  "LLM APIs": ["llm", "large language model", "openai", "anthropic", "claude", "gpt-4", "gpt4", "rag", "prompt engineering"],
  MLOps: ["mlops", "ml ops", "model deployment", "feature store"],
  /**
   * "ai" was missing, which is how a profile reading "AI/ML, Python, PySpark"
   * ended up storing the literal string "AI/ ML" — unmatchable, unrelated to
   * anything in the graph, and holding the TOP retrieval weight because it was
   * listed first. The candidate's most important skill was a dead token.
   *
   * "ai" is safe to match on a word boundary. It is not safe as a substring,
   * which is why the extractor's boundary rules matter here more than most.
   */
  "Machine Learning": [
    "machine learning", "ml", "ai", "a.i.", "artificial intelligence",
    "deep learning", "neural networks", "ai/ml", "ml/ai",
  ],
  "Generative AI": [
    "generative ai", "gen ai", "genai", "generative artificial intelligence",
  ],
  // Distinct specialisms, not spellings of "Machine Learning". A CV team and an
  // NLP team do not interview the same way, and collapsing them meant a vision
  // engineer ranked identically to a language one on either posting.
  NLP: ["nlp", "natural language processing", "text mining"],
  // Deliberately no bare "cv" alias: on a job site "CV" means curriculum vitae
  // in almost every occurrence, and one false alias poisons every posting.
  "Computer Vision": ["computer vision", "image recognition", "object detection"],
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

/** Separators that join two skills into one entry. */
const COMPOUND = /[/&]/;

/**
 * Split a compound entry like "AI/ML" or "Data & Analytics" — but only when
 * doing so actually resolves something.
 *
 * ── Why the whole string is tried first ──
 *
 * Plenty of real skill names contain a slash: CI/CD, PL/SQL, TCP/IP, A/B
 * Testing. Splitting eagerly would shred them. So the rule is:
 *
 *   1. If the WHOLE entry is a skill we know, keep it whole. Settles CI/CD and
 *      PL/SQL, both of which are in the alias table.
 *   2. Otherwise split, and accept the split ONLY if at least one part is a
 *      skill we know. "React/Redux" splits (React resolves); "TCP/IP" does not
 *      (neither part resolves), so it survives intact as the candidate wrote it.
 *
 * This matters because of how the failure looked: a profile reading "AI/ML,
 * Python, PySpark" stored "AI/ ML" as one unrecognised token. It matched no
 * job, related to nothing in the adjacency graph, and — being listed first —
 * carried the highest weight when choosing which jobs to fetch. The single most
 * important thing about that candidate was steering their results into nowhere.
 */
function splitCompound(entry: string): string[] {
  const whole = entry.trim();
  if (!whole) return [];
  // Known as-is? Nothing to do. `normalizeSkill` returns the input unchanged
  // when it does not recognise it, so identity means "not in the table".
  if (normalizeSkill(whole).toLowerCase() !== whole.toLowerCase()) return [whole];
  if (!COMPOUND.test(whole)) return [whole];

  const parts = whole.split(COMPOUND).map((p) => p.trim()).filter(Boolean);
  if (parts.length < 2) return [whole];

  const anyKnown = parts.some((p) => normalizeSkill(p).toLowerCase() !== p.toLowerCase());
  return anyKnown ? parts : [whole];
}

export function normalizeSkills(raw: string[]): string[] {
  const out = new Set<string>();
  for (const s of raw) {
    for (const part of splitCompound(s)) {
      const n = normalizeSkill(part);
      if (n) out.add(n);
    }
  }
  return [...out];
}

/** What the text actually showed about one skill. */
export type SkillEvidence = {
  skill: string;
  /** Total mentions across every spelling of it. */
  mentions: number;
  /** Character offset of the earliest mention; the tie-break. */
  firstAt: number;
};

/**
 * Every canonical skill the text mentions, with how strongly.
 *
 * ── Why mentions, and not position ──
 *
 * This used to return the first twelve skills BY POSITION, which ranked a CV's
 * opening line above everything the person had actually done. "Seeking a role
 * using Java or Python" in a summary outranked the Databricks pipeline they
 * built at three consecutive employers, because the summary is at the top.
 *
 * Counting mentions inverts that. A skill named once in an objective statement
 * scores 1; a skill that appears in three role descriptions scores 3, which is
 * what "top skill" should mean. Position survives only as the tie-break, where
 * it is a reasonable proxy for emphasis.
 *
 * Word-boundary matched so "go" doesn't fire on "going" and "ml" doesn't fire
 * on "html".
 */
export function extractSkillEvidence(text: string): SkillEvidence[] {
  if (!text) return [];
  const hay = " " + text.toLowerCase().replace(/[^a-z0-9+#./ -]/g, " ").replace(/\s+/g, " ") + " ";
  const out: SkillEvidence[] = [];

  for (const canon of CANON) {
    let mentions = 0;
    let firstAt = Number.MAX_SAFE_INTEGER;

    /**
     * Every spelling counts toward the same skill: a CV that says "React" twice
     * and "React.js" once is showing three pieces of evidence, not two skills.
     *
     * DEDUPED, and that matters. Most canonical names also appear in their own
     * alias list ("Java" and "java"), so scanning the raw concatenation counted
     * every mention twice — but only for those skills. Ones whose canonical
     * name is absent from their aliases (Recruiting) counted once, so the
     * doubling was not uniform and silently skewed the ranking toward whichever
     * skills happened to repeat themselves in the table.
     */
    const spellings = new Set([canon, ...SKILL_ALIASES[canon]].map((a) => a.trim().toLowerCase()));
    for (const a of spellings) {
      if (!a) continue;
      const esc = a.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      // Lookahead on the trailing boundary rather than consuming it, so
      // adjacent mentions ("python, python3") are both counted — a consuming
      // match would eat the separator and hide the next one.
      const re = new RegExp(`(^|[^a-z0-9+#])${esc}(?=[^a-z0-9+#]|$)`, "g");
      for (const m of hay.matchAll(re)) {
        mentions++;
        if (m.index < firstAt) firstAt = m.index;
      }
    }

    if (mentions > 0) out.push({ skill: canon, mentions, firstAt });
  }

  return out.sort((a, b) => b.mentions - a.mentions || a.firstAt - b.firstAt);
}

/**
 * Pull canonical skills out of a document, strongest evidence first.
 *
 * The default limit of 12 is unchanged, but which twelve you get is not: it is
 * now the twelve best-evidenced rather than the twelve earliest.
 */
export function extractSkills(text: string, limit = 12): string[] {
  return extractSkillEvidence(text).slice(0, limit).map((h) => h.skill);
}

/**
 * Reorder a skill list the candidate wrote themselves by how much the rest of
 * the document backs each one up.
 *
 * Used for a CV that HAS a "Skills:" section. That section is the candidate's
 * own claim and every skill in it is kept — nothing is dropped here. But a
 * skill also demonstrated in three role descriptions is better evidenced than
 * one that appears only in the list, and when we show back "your top skills"
 * that difference is the whole point.
 *
 * Stable for skills with equal evidence, so a candidate's own ordering is
 * preserved wherever the document gives us no reason to override it.
 */
export function rankByEvidence(listed: string[], document: string): string[] {
  if (listed.length < 2) return [...listed];
  const strength = new Map(extractSkillEvidence(document).map((e) => [e.skill, e.mentions]));
  return listed
    .map((skill, i) => ({ skill, i, n: strength.get(skill) ?? 0 }))
    .sort((a, b) => b.n - a.n || a.i - b.i)
    .map((x) => x.skill);
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
