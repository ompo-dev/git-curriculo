import type { JobSpec } from "../schemas";

export const normalizeKeyword = (value: string): string =>
  value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9+#.\- ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

export const stripAccents = (value: string): string =>
  value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();

export const unique = (items: string[]): string[] => Array.from(new Set(items));

const TECH_PATTERN =
  /\b(?:react|reactjs|react.?query|tanstack|vite|typescript|javascript|js|ts|node|nodejs|python|java|go|rust|c#|dotnet|php|ruby|swift|kotlin|dart|flutter|sql|sqlite|postgres|postgresql|mongodb|mysql|mariadb|redis|elasticsearch|docker|kubernetes|k8s|aws|azure|gcp|graphql|grpc|rest|restful|api|axios|zod|zustand|tailwind|tailwindcss|shadcn|shadcnui|shadcn.?ui|tachyons|bootstrap|material.?ui|chakra|radix|radix.?ui|ci.?cd|github.?actions|gitlab.?ci|jenkins|travis|testing|vitest|jest|playwright|cypress|next\.?js|nextjs|nuqs|html|html5|css|css3|scss|sass|git|github|gitlab|bitbucket|vue|vuejs|angular|svelte|webpack|babel|rollup|parcel|figma|storybook|laravel|rails|django|flask|fastapi|spring|vtex|shopify|magento|woocommerce|e.?commerce|linux|bash|shell|firebase|supabase|vercel|netlify|cloudflare|seo|acessibilidade|accessibility|wcag|performance|pwa|ssr|ssg|spa|design.?system|microfrontend|micro.?frontend|monorepo|turborepo|nx|lerna|websocket|webhook|agile|scrum|kanban|jira|confluence|okr|kpi|analytics|datadog|sentry|observabilidade|clean.?code|solid|tdd|bdd|ddd|passkeys|2fa|otp|i18n|intl|chart\.js|tradingview|logrocket|hook.?form|react.?hook.?form|server.?components|rsc|indexeddb|offline.?first|cache|caching|metadata|json.?ld|sitemap|csp|csrf|xss|ethers|viem|web3|fintech|trading|exchange|lightweight.?charts|class.?variance|cva|core.?web.?vitals|lcp|cls|inp)\b/g;

export const extractKeywords = (input: string): string[] => {
  const lowered = normalizeKeyword(input);
  const matches = lowered.match(TECH_PATTERN) ?? [];
  return unique(matches.map(item => item.trim()).filter(Boolean));
};

export const stripEmojis = (value: string): string =>
  value
    .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE00}-\u{FE0F}\u{200D}\u{20E3}]/gu, "")
    .replace(/\s+/g, " ")
    .trim();

export const sanitizeJobTitle = (value: string): string => {
  let title = stripEmojis(value);
  title = title.replace(/^\[|\]$/g, "").trim();
  title = title.replace(/^[|•\-–—\s]+|[|•\-–—\s]+$/g, "").trim();
  title = title.replace(/\s*\|\s*/g, " | ").trim();
  return title.slice(0, 120);
};

const INVALID_COMPANY =
  /^(de|da|do|dos|das|em|na|no|nos|nas|zona|area|uma|the|a|o|excelencia|excelência|oportunidade|vaga|remota|remoto|br)$/i;

function isValidCompanyName(value: string): boolean {
  const company = stripEmojis(value).replace(/[.,:;!?]+$/g, "").trim();
  if (company.length < 2 || company.length > 40) return false;
  if (INVALID_COMPANY.test(company)) return false;
  if (/^(de|da|do|em|na|no|nos|nas|zona|area)\b/i.test(company)) return false;
  if (/excelencia|excelência|zona de|conhecer melhor|experiencia/i.test(company)) return false;
  // LinkedIn frequentemente vem tudo minúsculo (ex.: "act digital")
  if (!/[A-Za-zÀ-Ü0-9]/.test(company)) return false;
  return true;
}

function normalizeCompanyName(value: string): string {
  let name = stripEmojis(value).replace(/[.,:;!?]+$/g, "").trim();
  const somos = name.match(/^somos a?\s+(.+)$/i);
  if (somos?.[1]) name = somos[1]!.trim();
  return name.slice(0, 40);
}

export const extractJobTitleFromText = (rawText: string, lines: string[]): string => {
  const bracketLine = lines.find(l => /\[.+(?:desenvolv|developer|engineer|engenheiro|analista).+\]/i.test(l));
  if (bracketLine) {
    return sanitizeJobTitle(bracketLine.replace(/^\[|\]$/g, "").trim());
  }

  const pipeLine = lines.find(l => {
    const cleaned = stripEmojis(l);
    return (
      cleaned.includes("|") &&
      cleaned.length >= 8 &&
      cleaned.length < 100 &&
      /\b(desenvolv|developer|engineer|engenheiro|front.?end|back.?end|full.?stack)\b/i.test(cleaned)
    );
  });
  if (pipeLine) {
    const parts = stripEmojis(pipeLine).split("|").map(p => p.trim()).filter(Boolean);
    const jobPart = parts.find(p => /\b(desenvolv|developer|engineer|engenheiro|front.?end)\b/i.test(p));
    if (jobPart) return sanitizeJobTitle(jobPart);
    return sanitizeJobTitle(parts.join(" | "));
  }

  const looksLikeTitle = (l: string) => {
    const cleaned = stripEmojis(l);
    return (
      cleaned.length >= 5 &&
      cleaned.length < 100 &&
      !/^(logo|id da|id:|sobre a|veja como|acesse|conhe|enviar|reative|pessoas|candidatar|compartilhar|salvar|promovid|anunciad|mais de \d|h[íi]brido|remoto|presencial|tempo integral|part.?time|nyse:|whirlpool|samsung|google|amazon|microsoft|meta|uber|ifood|nubank|itau|bradesco|ambev|totvs|softplan|rd station|br\b|zona de|excelencia|excelência)/i.test(cleaned) &&
      /\b(desenvolv|developer|engineer|engenheiro|analista|analyst|designer|gerente|manager|coordenador|lider|lead|especialista|specialist|arquiteto|architect|junior|pleno|senior|sr\.|jr\.|programador|front.?end|back.?end|full.?stack|mobile|devops|sre|qa|tester|product|dados|data|software|systems)\b/i.test(cleaned)
    );
  };

  const rawTitle =
    lines.find(looksLikeTitle) ??
    lines.find(l => {
      const cleaned = stripEmojis(l);
      return (
        cleaned.length < 90 &&
        cleaned.length > 5 &&
        !/^(logo|id:|sobre a|veja como|acesse|conhe|enviar|reative|pessoas|candidatar|compartilhar|salvar|promovid|anunciad|mais de \d|zona de|excelencia)/i.test(cleaned) &&
        // evita pegar frases de responsabilidade como "título"
        !/^(collaborate|develop|build|ensure|integrate|participate|support)\b/i.test(cleaned) &&
        !/\b(?:collaborate|work closely|ensure|integrate|participate)\b/i.test(cleaned)
      );
    }) ??
    "Vaga";

  return sanitizeJobTitle(rawTitle);
};

export const extractCompanyFromJob = (rawText: string, lines: string[]): string | undefined => {
  const firstLines = lines.slice(0, 30);

  const pickCompanyFromLine = (line: string): string | undefined => {
    const cleaned = stripEmojis(line).trim();
    if (!cleaned) return undefined;
    // "Empresa · Local" ou "Empresa · Lisboa..." (LinkedIn)
    const dotParts = cleaned.split("·").map(p => p.trim()).filter(Boolean);
    const candidate = dotParts[0] ?? cleaned;
    const company = normalizeCompanyName(candidate);
    return isValidCompanyName(company) ? company : undefined;
  };

  const prioritized = [
    /recado da\s+([A-Z0-9][A-Za-z0-9&.+\- ]{0,28})/i,
    /somos a\s+([A-Z0-9][A-Za-z0-9&.+\- ]{0,28})/i,
    /\bna\s+([A-Z0-9][A-Za-z0-9&.+\- ]{0,28})\s*,/i,
    /\bna\s+([A-Z0-9][A-Za-z0-9&.+\- ]{0,28})\b/i
  ];

  for (const pattern of prioritized) {
    const match = rawText.match(pattern);
    if (match?.[1]) {
      const company = normalizeCompanyName(match[1]);
      if (isValidCompanyName(company)) return company;
    }
  }

  // Heurística LinkedIn: a empresa costuma ficar logo acima/abaixo do título no topo
  const title = extractJobTitleFromText(rawText, firstLines);
  const titleIdx = firstLines.findIndex((l) => stripEmojis(l).includes(title));
  if (titleIdx >= 0) {
    for (const idx of [titleIdx - 1, titleIdx + 1, titleIdx + 2, 0, 1, 2]) {
      const line = firstLines[idx] ?? "";
      const picked = pickCompanyFromLine(line);
      if (picked) return picked;
    }
  }

  // Procura direta por uma linha "simples" com aparência de nome de empresa no topo
  for (const line of firstLines) {
    const cleaned = stripEmojis(line).trim();
    if (cleaned.length < 2 || cleaned.length > 40) continue;
    if (/react|developer|engineer|desenvolv|front.?end|back.?end|full.?stack/i.test(cleaned)) continue;
    if (/^(logo|compartilhar|salvar|candidatar|h[ií]brido|tempo integral|promovida|avaliando|sobre a vaga|about the role)/i.test(cleaned)) continue;
    const company = normalizeCompanyName(cleaned);
    if (isValidCompanyName(company)) return company;
  }

  const aboutIdx = lines.findIndex(l => /^sobre (?:a empresa|n[oó]s|a \w+)/i.test(l));
  if (aboutIdx >= 0) {
    for (let i = aboutIdx + 1; i < Math.min(aboutIdx + 6, lines.length); i += 1) {
      const line = lines[i] ?? "";
      const somos = line.match(/^somos a?\s+(.+)/i);
      if (somos?.[1]) {
        const company = normalizeCompanyName(somos[1]);
        if (isValidCompanyName(company)) return company;
      }
      if (/^[A-Z0-9][A-Za-z0-9&.+\- ]{1,28}$/.test(stripEmojis(line)) && !/desenvolv|engineer|vaga|remot|consultoria/i.test(line)) {
        const company = normalizeCompanyName(line);
        if (isValidCompanyName(company)) return company;
      }
    }
  }

  const consultoriaMatch = rawText.match(
    /\n\s*([A-Z0-9][A-Za-z0-9&.+\- ]{1,28})\s*\n\s*uma consultoria global/i
  );
  if (consultoriaMatch?.[1]) {
    const company = normalizeCompanyName(consultoriaMatch[1]);
    if (isValidCompanyName(company)) return company;
  }

  return undefined;
};

export function buildPdfDocumentTitle(input: {
  fullName: string;
  jobTitle: string;
  company?: string;
  suffix?: string;
  date?: Date;
}): string {
  const safeName = input.fullName.replace(/[<>:"/\\|?*]/g, "").trim();
  const company = input.company?.replace(/[<>:"/\\|?*]/g, "").trim();

  const isSentenceLike = (value: string): boolean => {
    const v = stripEmojis(value).toLowerCase();
    if (v.length < 10) return false;
    // verbos comuns de "responsibilities" que não deveriam virar "título de vaga"
    if (/\b(collaborate|develop|build|ensure|integrate|participate|support|maintain|work\s+closely)\b/i.test(v)) {
      return true;
    }
    // frases longas com virgulas costumam ser bullets/responsabilidades
    if (v.length > 55 && /,/.test(v)) return true;
    return false;
  };

  const normalizeJobForTitle = (jobTitle: string): string => {
    const cleaned = sanitizeJobTitle(jobTitle)
      .replace(/\//g, "-")
      .replace(/[<>:"\\|?*]/g, "")
      .trim();

    // pega só o pedaço mais "cargo" quando vier com lixo extra
    const splitCandidates = cleaned
      .split(/\s*(?:\||-|–|—|·|•)\s*/g)
      .map((p) => p.trim())
      .filter(Boolean);

    const roleLike = splitCandidates.find((p) =>
      /\b(developer|engineer|analyst|designer|front.?end|back.?end|full.?stack|devops|sre|qa|tester|react)\b/i.test(p)
    );

    const best = roleLike ?? splitCandidates[0] ?? cleaned;
    const short = best.slice(0, 70).trim();
    return isSentenceLike(short) ? "" : short;
  };

  const safeJob = normalizeJobForTitle(input.jobTitle);
  const middle = input.suffix?.trim() ? input.suffix.trim() : safeJob;

  const d = input.date ?? new Date();
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yyyy = d.getFullYear();

  // evita " -  - " quando faltar middle
  const parts = [
    safeName,
    company || "",
    middle || "",
    `${dd}-${mm}-${yyyy}`
  ].filter((p) => p.trim().length > 0);

  return parts.join(" - ");
};

/** Palavras genericas de anuncios de vaga — nunca sao lacunas ATS reais. */
const GENERIC_ATS_STOPWORDS = new Set([
  "para", "com", "que", "uma", "mais", "dos", "das", "nas", "nos", "aos", "pelo", "pela",
  "seus", "suas", "from", "with", "and", "the", "are", "will", "this", "that", "our",
  "all", "not", "can", "tem", "ser", "seu", "sua", "por", "ter", "vai", "ele", "ela",
  "todo", "como", "sobre", "vaga", "buscamos", "voce", "entre", "cada", "deve", "isso",
  "outro", "pois", "bem", "sido", "esta", "fazer", "fica", "sempre", "muito", "tambem",
  "sendo", "quando", "ainda", "mesmo", "qual", "quem", "onde", "type", "util", "area",
  "gx2", "empresa", "consultoria", "oportunidade", "overview", "remota", "remoto",
  "pessoas", "conhecimento", "solucoes", "operacoes", "real", "implementar", "implementacao",
  "desenvolvimento", "desenvolver", "experiencia", "trabalho", "equipe", "time", "projeto",
  "projetos", "mercado", "processos", "processo", "sistema", "sistemas", "tecnologia",
  "tecnologias", "produto", "produtos", "digital", "dados", "candidato", "requisitos",
  "requisito", "responsabilidades", "atribuicoes", "atribuicao", "habilidades", "precisa",
  "anos", "solido", "solidos", "profissional", "profissionais", "ambiente", "cultura",
  "cliente", "clientes", "usuario", "usuarios", "negocio", "negocios", "criar", "criacao",
  "garantir", "garantia", "busca", "buscar", "participar", "participacao", "atuar", "atuacao",
  "realizar", "realizacao", "construir", "construcao", "entregar", "entrega", "entregas",
  "melhorar", "melhoria", "melhorias", "otimizar", "otimizacao", "integrar", "integracao",
  "integracoes", "utilizar", "usando", "forma", "formas", "parte", "partes", "qualidade",
  "seguranca", "solucao", "operacao", "conhecer", "conhecendo", "encontrar", "oferecemos",
  "beneficios", "beneficio", "oportunidades", "plataforma", "plataformas", "servicos",
  "servico", "interno", "interna", "externo", "externa", "global", "local", "nacional",
  "internacional", "grande", "grandes", "melhor", "melhores", "novo", "nova", "novos",
  "novas", "outras", "outros", "todas", "todos", "cada", "seja", "sejam", "sera", "serao",
  "pode", "podem", "deve", "devem", "precisamos", "procuramos", "valorizamos", "buscamos"
]);

const MEANINGFUL_SOFT_SKILLS = new Set([
  "acessibilidade", "accessibility", "figma", "agile", "scrum", "kanban", "shadcn",
  "lideranca", "comunicacao", "colaboracao", "proatividade", "autonomia", "wireframe",
  "wireframes", "prototipo", "prototipos", "ux", "ui", "design", "fintech", "crypto",
  "cripto", "trading", "a11y", "wcag"
]);

/** Termo tecnico ou skill rastreavel — descarta verbos/substantivos genericos de anuncios. */
export function isMeaningfulAtsKeyword(keyword: string): boolean {
  const norm = normalizeKeyword(keyword);
  if (!norm || norm.length < 2) return false;
  if (GENERIC_ATS_STOPWORDS.has(norm)) return false;

  const tokens = norm.split(/\s+/).filter(Boolean);
  if (tokens.length > 1 && tokens.every(token => GENERIC_ATS_STOPWORDS.has(token))) {
    return false;
  }

  if (extractKeywords(norm).length > 0) return true;
  if (tokens.some(token => extractKeywords(token).length > 0)) return true;

  if (MEANINGFUL_SOFT_SKILLS.has(norm) || tokens.some(token => MEANINGFUL_SOFT_SKILLS.has(token))) {
    return true;
  }

  if (/^(react|next|tailwind|node|vue|angular)\s+\d/.test(norm)) return true;
  if (/^(app router|shadcn ui|tailwind css v\d|react hook form|server components|core web vitals)$/.test(norm)) {
    return true;
  }

  return false;
}

export function filterMeaningfulAtsKeywords(keywords: string[]): string[] {
  return unique(keywords.map(normalizeKeyword).filter(Boolean)).filter(isMeaningfulAtsKeyword);
}

export const extractBroadKeywords = (text: string): string[] => {
  const norm = normalizeKeyword(text);
  const tech = extractKeywords(text);

  const extra =
    norm.match(
      /\b(?:senior|junior|pleno|lead|lider|architect|engineer|engenheiro|developer|desenvolvedor|front.?end|back.?end|full.?stack|mobile|devops|cloud|agile|scrum|kanban|sprint|ci.?cd|deploy|pipeline|git|api|rest|restful|graphql|microservice|monolito|design.?system|component|pwa|ssr|seo|performance|acessibilidade|accessibility|responsiv|escalabilidade|scalab|observabilidade|monitoring|logging|testing|unit|integration|e2e|refactor|code.?review|docker|container|linux|clean.?code|solid|dry|kiss|tdd|bdd|comunicacao|lideranca|autonomia|proatividade|colaboracao|problem.?solving|qualidade|seguranca|figma|websocket|axios|datadog|sentry|radix|shadcn|metadata|json.?ld|app router|wcag|a11y)\b/g
    ) ?? [];

  return filterMeaningfulAtsKeywords(unique([...tech, ...extra])).slice(0, 80);
};

export const buildJobKeywordPool = (jobSpec: JobSpec, jobFullText: string): string[] =>
  filterMeaningfulAtsKeywords(
    unique([
      ...jobSpec.requiredSkills,
      ...jobSpec.preferredSkills,
      ...jobSpec.keywords,
      ...extractKeywords(jobSpec.summary),
      ...extractKeywords(jobSpec.responsibilities.join(" ")),
      ...extractBroadKeywords(jobFullText)
    ])
  );

function extractJsonObject(raw: string): string {
  let text = raw.trim();
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) text = fenced[1].trim();

  const start = text.indexOf("{");
  if (start < 0) return "{}";
  return text.slice(start);
}

function repairTruncatedJson(text: string): string {
  let result = "";
  let inString = false;
  let escape = false;
  const stack: Array<"{" | "["> = [];

  for (let i = 0; i < text.length; i++) {
    const char = text[i]!;
    result += char;

    if (escape) {
      escape = false;
      continue;
    }

    if (inString) {
      if (char === "\\") escape = true;
      else if (char === '"') inString = false;
      continue;
    }

    if (char === '"') inString = true;
    else if (char === "{") stack.push("{");
    else if (char === "[") stack.push("[");
    else if (char === "}") stack.pop();
    else if (char === "]") stack.pop();
  }

  if (inString) result += '"';
  result = result.replace(/,\s*$/, "");

  while (stack.length > 0) {
    result += stack.pop() === "[" ? "]" : "}";
  }

  return result;
}

export function parseAiJsonContent(raw: string): unknown {
  const text = extractJsonObject(raw);
  if (!text || text === "{}") return {};

  try {
    return JSON.parse(text);
  } catch (firstError) {
    try {
      return JSON.parse(repairTruncatedJson(text));
    } catch {
      const message =
        firstError instanceof Error ? firstError.message : "JSON invalido";
      throw new Error(`Resposta JSON da IA corrompida ou truncada: ${message}`);
    }
  }
}

export function isJsonParseError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return (
    error.message.includes("JSON") ||
    error.message.includes("truncada") ||
    error.message.includes("corrompida")
  );
}
