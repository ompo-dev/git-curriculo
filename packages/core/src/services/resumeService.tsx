import {
  Document,
  Page,
  StyleSheet,
  Text,
  View,
  pdf
} from "@react-pdf/renderer";
import { z } from "zod";

import {
  JobSpecSchema,
  ResumeDocumentSchema,
  type GitHubProfileSnapshot,
  type JobSpec,
  type ProjectEvidence,
  type ResumeDocument
} from "../schemas";
import { extractKeywords, normalizeKeyword, unique } from "../utils/text";

interface GenerateResumeInput {
  jobSpec: JobSpec;
  profileSnapshot: GitHubProfileSnapshot;
  locale?: "pt-BR" | string;
  profilePrompt?: string;
  customRules?: string;
}

interface ProviderStreamInput {
  jobSpec: JobSpec;
  profileSnapshot: GitHubProfileSnapshot;
  projectEvidence: ProjectEvidence[];
  profilePrompt: string;
  locale: string;
  customRules?: string;
}

export interface PdfMetadata {
  title?: string;
  author?: string;
  subject?: string;
  creator?: string;
  keywords?: string;
  description?: string;
}

export interface ResumeProvider {
  generateResume(input: ProviderStreamInput): Promise<ResumeDocument>;
  generateResumeStream?(
    input: ProviderStreamInput,
    onChunk: (accumulated: string) => void
  ): Promise<string>;
}

export interface DeepSeekProviderOptions {
  apiKey: string;
  model?: string;
  endpoint?: string;
}

export class DeepSeekResumeProvider implements ResumeProvider {
  private readonly apiKey: string;
  private readonly model: string;
  private readonly endpoint: string;

  constructor(options: DeepSeekProviderOptions) {
    this.apiKey = options.apiKey;
    this.model = options.model ?? "deepseek-chat";
    this.endpoint = options.endpoint ?? "https://api.deepseek.com/v1/chat/completions";
  }

  private buildMessages(input: ProviderStreamInput) {
    const u = input.profileSnapshot.user;
    const topEvidence = input.projectEvidence.slice(0, 5);
    const topLangs = unique(
      input.profileSnapshot.languages
        .sort((a, b) => b.bytes - a.bytes)
        .map(l => l.language)
    ).slice(0, 8);

    // Include raw commit/PR titles so the model can mine for real impact signals
    const evidenceBlock = topEvidence
      .map(e => {
        const lines = [
          `### ${e.repoName}`,
          `Stack: ${e.technologies.slice(0, 8).join(", ") || "n/a"}`,
          `Descricao: ${e.summary.slice(0, 180)}`,
          e.architectureSignals.length > 0
            ? `Padroes: ${e.architectureSignals.join(", ")}`
            : ""
        ].filter(Boolean);

        // Real commit messages and PR titles — model uses these to extract meaningful impact
        if (e.evidence.length > 0) {
          lines.push("Commits e PRs reais (extraia impactos tecnicos concretos destes):");
          for (const ev of e.evidence.slice(0, 18)) {
            lines.push(`  • ${ev.slice(0, 110)}`);
          }
        }

        return lines.join("\n");
      })
      .join("\n\n");

    const userBlock = [
      `Nome: ${u.name ?? u.login}`,
      `GitHub: github.com/${u.login}`,
      u.bio ? `Bio: ${u.bio.slice(0, 300)}` : "",
      u.location ? `Local: ${u.location}` : "",
      u.email ? `Email: ${u.email}` : "",
      `Stack principal: ${topLangs.join(", ")}`,
      `Repositorios publicos: ${u.publicRepos} | Seguidores: ${u.followers}`
    ]
      .filter(Boolean)
      .join("\n");

    const jobBlock = [
      `Titulo: ${input.jobSpec.title}`,
      `Skills requeridas: ${input.jobSpec.requiredSkills.slice(0, 18).join(", ")}`,
      `Responsabilidades: ${input.jobSpec.responsibilities.slice(0, 5).join(" | ")}`,
      `Keywords ATS: ${input.jobSpec.keywords.slice(0, 24).join(", ")}`
    ]
      .filter(s => !s.endsWith(": "))
      .join("\n");

    const rulesBlock = input.customRules?.trim()
      ? [
          "## INSTRUCOES PERSONALIZADAS DO CANDIDATO (PRIORIDADE MAXIMA — aplique antes de tudo)",
          "Estas instrucoes sobrepoe qualquer padrao. Siga-as rigorosamente:",
          input.customRules.trim()
        ].join("\n")
      : "";

    const userContent = [
      `Idioma de saida: ${input.locale}`,
      "",
      "## Perfil GitHub do candidato",
      userBlock,
      "",
      input.profilePrompt.trim()
        ? `## Historico profissional e contexto do candidato (USE TODOS OS DADOS ABAIXO)\n${input.profilePrompt.slice(0, 5000)}`
        : "",
      "",
      "## Vaga alvo",
      jobBlock,
      "",
      rulesBlock,
      "",
      "## Projetos GitHub com evidencias brutas",
      "INSTRUCAO: Para cada projeto, leia os commits/PRs e reescreva como bullets ricos variando estrutura (veja Regra 9). Exemplos do nivel esperado:",
      "  • 'Migrei autenticacao de sessoes para **JWT** + **Redis**, eliminando estado no servidor e suportando escala horizontal'",
      "  • 'Reducao de **42%** no Time-to-Interactive via lazy loading e pre-fetch estrategico de rotas criticas'",
      "  • 'Pipeline de CI/CD com **GitHub Actions** cobrindo build, testes e deploy automatico em ~3min'",
      "Nao liste contadores (ex: '37 commits'). Descreva O QUE foi feito, COM QUAL tecnologia e QUAL o impacto.",
      evidenceBlock
    ]
      .filter(s => s !== undefined && s.trim() !== "")
      .join("\n")
      .trim();

    const systemContent = [
      `Voce e um especialista senior em curriculos ATS para desenvolvedores de software. Idioma: ${input.locale}.`,
      "",
      "REGRAS OBRIGATORIAS:",
      "1. EXPERIENCIA PROFISSIONAL: O campo 'Historico profissional e contexto do candidato' e a fonte da verdade para empregos reais. Inclua TODAS as empresas listadas, com cargo, periodo e bullets de responsabilidade/impacto. Nao omita nenhuma.",
      "2. IMPACTO TECNICO: Leia os commits e PRs reais e reescreva como bullets ricos: tecnologia usada, problema resolvido, resultado. Em vez de '37 PRs merged', descreva o QUE foi entregue.",
      "3. METRICAS: Use numeros APENAS se derivaveis dos dados reais de commits/PRs (ex: contagem de componentes, PRs, repositorios). NAO invente percentuais, volumes, escalas ou tempos sem embasamento real nos dados fornecidos.",
      "4. ATS: Insira keywords da vaga de forma natural — mas SOMENTE onde o candidato tem experiencia real comprovada no perfil. Skills que nao estao no perfil GitHub NAO devem aparecer em bullets de experiencia.",
      "5. ZERO ALUCINACAO: PROIBIDO inventar experiencia com tecnologias, plataformas ou produtos nao presentes no perfil GitHub ou no contexto fornecido. Se a skill nao esta no perfil do candidato, NAO coloque em bullets de experiencia como se o candidato tivesse usado. Colocar informacoes falsas prejudica gravemente o candidato.",
      "6. VOZ: Use SEMPRE primeira pessoa do singular. CORRETO: 'Desenvolvi', 'Implementei', 'Liderei'. ERRADO: 'Desenvolveu', 'Implementou'.",
      "7. LINKS e CONTATO: Na secao Contato use Markdown clicavel: [email@ex.com](mailto:email@ex.com), [linkedin.com/in/user](https://linkedin.com/in/user), [github.com/user](https://github.com/user). Numero de telefone SEMPRE como link WhatsApp: [51999999999](https://wa.me/5551999999999) — substitua pelo numero real. NUNCA texto plano para URLs ou telefone.",
      "10. PROIBIDO usar backticks (`) em qualquer parte do curriculo — nem para codigo, nem para destacar texto.",
      "8. NEGRITO: Use **negrito** SOMENTE em nomes de tecnologias, ferramentas e numeros/resultados dentro dos bullets. NUNCA no verbo. CORRETO: 'Implementei autenticacao com **JWT** e **Redis**'. ERRADO: '**Implementei** autenticacao'.",
      "9. VARIACAO OBRIGATORIA DE BULLETS: Maximo 35% dos bullets pode comecar com verbo. Os demais DEVEM usar outras estruturas. Formatos obrigatorios com exemplos:",
      "   RESULTADO em destaque (comece pelo numero/impacto): '**-65%** no bundle via code splitting e lazy loading, melhorando TTI de 4s para 1.4s'",
      "   TECNOLOGIA em foco (comece pela stack): '**Design System** em Storybook com 28 componentes padronizados, eliminando inconsistencias visuais entre squads'",
      "   CONTEXTO/PROBLEMA (comece pela situacao): 'Para resolver gargalos N+1 nas listagens, apliquei DataLoader e cache com **Redis**, cortando tempo de resposta de 900ms para 95ms'",
      "   DESCRICAO ARQUITETURAL (comece pela solucao): 'Autenticacao stateless com **JWT** + refresh token automatico, permitindo escala horizontal sem sessao no servidor'",
      "   Bullets consecutivos NUNCA podem comecar com o mesmo padrao. Se um bullet comeca com verbo, o proximo DEVE usar outro formato.",
      "",
      ...((): string[] => {
        const cr = (input.customRules ?? "").toLowerCase();
        const omitSkills = /n[aã]o.{0,30}(skills?|habilidades)|sem.{0,20}(skills?|habilidades)|(remov|omit|exclu|tir).{0,30}(skills?|habilidades)|(skills?|habilidades).{0,30}(n[aã]o|sem|remov|exclu)/.test(cr);
        const sections = ["## Resumo", "## Contato", omitSkills ? null : "## Skills", "## Experiencia", "## Projetos", "## Educacao"].filter(Boolean) as string[];
        return [
          "Estrutura Markdown obrigatoria:",
          "# [Nome Completo]",
          "[Headline — 1 linha objetiva]",
          ...sections
        ];
      })()
    ].join("\n");

    return [
      { role: "system" as const, content: systemContent },
      { role: "user" as const, content: userContent }
    ];
  }

  async generateResumeStream(
    input: ProviderStreamInput,
    onChunk: (accumulated: string) => void
  ): Promise<string> {
    const response = await fetch(this.endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`
      },
      body: JSON.stringify({
        model: this.model,
        temperature: 0.3,
        stream: true,
        messages: this.buildMessages(input)
      })
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Erro DeepSeek (${response.status}): ${body}`);
    }

    if (!response.body) {
      throw new Error("Resposta da DeepSeek sem body para streaming.");
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let accumulated = "";

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || trimmed === "data: [DONE]") continue;
          if (!trimmed.startsWith("data: ")) continue;

          try {
            const parsed = JSON.parse(trimmed.slice(6)) as {
              choices?: Array<{ delta?: { content?: string } }>;
            };
            const content = parsed.choices?.[0]?.delta?.content;
            if (content) {
              accumulated += content;
              onChunk(accumulated);
            }
          } catch {
            // ignore malformed SSE chunk
          }
        }
      }
    } finally {
      reader.releaseLock();
    }

    return accumulated;
  }

  async generateResume(input: ProviderStreamInput): Promise<ResumeDocument> {
    let fullText = "";
    await this.generateResumeStream(input, text => {
      fullText = text;
    });
    return parseMarkdownToResumeDoc(fullText, input.locale, input.projectEvidence);
  }
}

interface ResumeServiceOptions {
  allowMockFallback?: boolean;
}

export class ResumeService {
  private readonly allowMockFallback: boolean;

  constructor(
    private readonly provider?: ResumeProvider,
    options: ResumeServiceOptions = {}
  ) {
    this.allowMockFallback = options.allowMockFallback ?? false;
  }

  parseJobText(rawText: string): JobSpec {
    const lines = rawText.split(/\r?\n/).map(l => l.trim()).filter(Boolean);

    // Extended tech pattern — covers frontend, backend, tools, platforms, methodologies
    const extractJobKeywords = (text: string): string[] => {
      const n = normalizeKeyword(text);
      const matches = n.match(
        /\b(?:react|reactjs|vite|typescript|javascript|js|ts|node|nodejs|python|java|go|rust|c#|dotnet|php|ruby|swift|kotlin|dart|flutter|sql|sqlite|postgres|postgresql|mongodb|mysql|mariadb|redis|elasticsearch|docker|kubernetes|k8s|aws|azure|gcp|graphql|grpc|rest|restful|api|axios|zod|zustand|tailwind|tailwindcss|shadcn|tachyons|bootstrap|material.?ui|chakra|radix|ci.?cd|github.?actions|gitlab.?ci|jenkins|travis|testing|vitest|jest|playwright|cypress|next\.?js|nextjs|nuqs|html|html5|css|css3|scss|sass|git|github|gitlab|bitbucket|vue|vuejs|angular|svelte|webpack|babel|rollup|parcel|figma|storybook|laravel|rails|django|flask|fastapi|spring|vtex|shopify|magento|woocommerce|e.?commerce|linux|bash|shell|firebase|supabase|vercel|netlify|cloudflare|seo|acessibilidade|accessibility|performance|pwa|ssr|ssg|spa|design.?system|microfrontend|micro.?frontend|monorepo|turborepo|nx|lerna|websocket|webhook|graphql|agile|scrum|kanban|jira|confluence|okr|kpi|analytics|datadog|sentry|observabilidade|clean.?code|solid|tdd|bdd|ddd)\b/g
      ) ?? [];
      return unique(matches);
    };

    // Detect section boundaries by heading keywords
    const findSection = (startRe: RegExp, endRe: RegExp): string[] => {
      const start = lines.findIndex(l => startRe.test(l));
      if (start < 0) return [];
      const end = lines.findIndex((l, i) => i > start + 1 && endRe.test(l));
      return lines.slice(start + 1, end > 0 ? end : start + 20).filter(l => l.length > 4);
    };

    // Job title: prefer lines that look like a role/position title
    const looksLikeTitle = (l: string) =>
      l.length >= 5 && l.length < 100 &&
      !/^(logo|id da|id:|sobre a|veja como|acesse|conhe|enviar|reative|pessoas|candidatar|compartilhar|salvar|promovid|anunciad|mais de \d|h[íi]brido|remoto|presencial|tempo integral|part.?time|nyse:|whirlpool|samsung|google|amazon|microsoft|meta|uber|ifood|nubank|itau|bradesco|ambev|totvs|softplan|rd station)/i.test(l) &&
      /\b(desenvolv|engineer|engenheiro|analista|analyst|designer|gerente|manager|coordenador|lider|lead|especialista|specialist|arquiteto|architect|junior|pleno|senior|sr\.|jr\.|dev|programador|front.?end|back.?end|full.?stack|mobile|devops|sre|qa|tester|product|dados|data|software|systems)\b/i.test(l);

    const title =
      lines.find(looksLikeTitle) ??
      lines.find(l =>
        l.length < 90 && l.length > 5 &&
        !/^(logo|id:|sobre a|veja como|acesse|conhe|enviar|reative|pessoas|candidatar|compartilhar|salvar|promovid|anunciad|mais de \d)/i.test(l)
      ) ?? "Vaga";

    // Sections
    const summarySection = findSection(
      /resumo desta fun|sobre a vaga|sobre essa|summary|about the role/i,
      /suas responsabilidades|responsibilities|requisitos|habilidades|o que oferecemos|beneficios/i
    );
    const respSection = findSection(
      /suas responsabilidades|responsabilidades incluem|responsibilities/i,
      /requisitos.?minimos|minimum req|habilidades|o que oferecemos/i
    );
    const reqSection = findSection(
      /requisitos.?(?:minimos|essenciais|obrigatorios)|minimum req/i,
      /habilidades desej|diferenciais|nice.?to.?have|o que oferecemos|beneficios/i
    );
    const prefSection = findSection(
      /habilidades desej|diferenciais|nice.?to.?have|desejavel/i,
      /o que oferecemos|beneficios|conecte|sobre n[oó]s/i
    );

    const summary = (summarySection.length > 0 ? summarySection : lines.slice(0, 6)).join(" ").slice(0, 500);
    const responsibilities = respSection.filter(l => l.length > 8).slice(0, 15);

    // Required skills: from req section; fallback to full text
    const requiredSkills = reqSection.length > 0
      ? unique(reqSection.flatMap(l => extractJobKeywords(l)))
      : extractJobKeywords(rawText);

    // Preferred skills: from pref section
    const preferredSkills = prefSection.length > 0
      ? unique(prefSection.flatMap(l => extractJobKeywords(l)))
      : [];

    // Additional keywords from responsibilities + summary
    const extraKeywords = [
      ...responsibilities.flatMap(l => extractJobKeywords(l)),
      ...extractJobKeywords(summary),
    ];

    const keywords = unique([...requiredSkills, ...preferredSkills, ...extraKeywords]);

    return JobSpecSchema.parse({
      title,
      summary: summary.length > 0 ? summary : rawText.slice(0, 300),
      responsibilities,
      requiredSkills,
      preferredSkills,
      keywords
    });
  }

  /**
   * Stream resume generation. Calls onChunk with the accumulated markdown as it arrives.
   * Returns the final ResumeDocument once streaming completes.
   */
  async streamResume(
    input: GenerateResumeInput,
    onChunk: (accumulated: string) => void
  ): Promise<ResumeDocument> {
    if (!this.provider) {
      throw new Error(
        "DeepSeek API Key obrigatoria para gerar curriculo. Configure a chave e tente novamente."
      );
    }

    const locale = input.locale ?? "pt-BR";
    const projectEvidence = this.buildProjectEvidence(input.profileSnapshot);

    const streamInput: ProviderStreamInput = {
      jobSpec: input.jobSpec,
      profileSnapshot: input.profileSnapshot,
      projectEvidence,
      profilePrompt: input.profilePrompt?.trim() ?? "",
      locale,
      customRules: input.customRules?.trim()
    };

    try {
      let markdown: string;

      if (this.provider.generateResumeStream) {
        markdown = await this.provider.generateResumeStream(streamInput, onChunk);
      } else {
        const doc = await this.provider.generateResume(streamInput);
        markdown = doc.rawMarkdown ?? this.docToMarkdown(doc);
        onChunk(markdown);
        return doc;
      }

      return parseMarkdownToResumeDoc(markdown, locale, projectEvidence);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Falha desconhecida na geracao do curriculo.";
      throw new Error(`Falha ao gerar curriculo: ${message}`);
    }
  }

  async generateResume(input: GenerateResumeInput): Promise<ResumeDocument> {
    return this.streamResume(input, () => {});
  }

  exportMarkdown(resumeDoc: ResumeDocument): string {
    if (resumeDoc.rawMarkdown) return resumeDoc.rawMarkdown;
    return this.docToMarkdown(resumeDoc);
  }

  private docToMarkdown(resume: ResumeDocument): string {
    const lines: string[] = [
      `# ${resume.fullName}`,
      "",
      resume.headline,
      "",
      "## Resumo",
      "",
      resume.summary,
      "",
      "## Contato",
      ""
    ];

    if (resume.contact.email) lines.push(`- Email: ${resume.contact.email}`);
    if (resume.contact.location) lines.push(`- Local: ${resume.contact.location}`);
    if (resume.contact.github) lines.push(`- GitHub: ${resume.contact.github}`);
    if (resume.contact.website) lines.push(`- Site: ${resume.contact.website}`);

    lines.push("", "## Skills", "", `- ${resume.skills.join(", ")}`);
    lines.push("", "## Experiencia", "");
    for (const item of resume.experience) {
      lines.push(`### ${item.title}`);
      for (const b of item.bullets) lines.push(`- ${b}`);
      lines.push("");
    }
    lines.push("## Projetos", "");
    for (const item of resume.projects) {
      lines.push(`### ${item.title}`);
      for (const b of item.bullets) lines.push(`- ${b}`);
      lines.push("");
    }
    if (resume.education.length > 0) {
      lines.push("## Educacao", "");
      for (const item of resume.education) lines.push(`- ${item}`);
      lines.push("");
    }
    return lines.join("\n").trimEnd();
  }

  async exportPdf(resumeDoc: ResumeDocument, meta?: PdfMetadata): Promise<Blob> {
    const resume = ResumeDocumentSchema.parse(resumeDoc);
    const markdown = resume.rawMarkdown ?? this.docToMarkdown(resume);
    const metadata: PdfMetadata = {
      title: resume.headline,
      author: resume.fullName,
      subject: "Curriculo",
      creator: resume.fullName,
      keywords: resume.atsKeywords.join(", "),
      description: resume.summary.slice(0, 300),
      ...meta
    };
    return pdf(<MarkdownPdfDocument markdown={markdown} metadata={metadata} />).toBlob();
  }

  async exportMarkdownPdf(markdown: string, meta?: PdfMetadata): Promise<Blob> {
    const metadata: PdfMetadata = { title: "Curriculo", creator: "Git Curriculo", ...meta };
    return pdf(<MarkdownPdfDocument markdown={markdown} metadata={metadata} />).toBlob();
  }

  private buildProjectEvidence(profileSnapshot: GitHubProfileSnapshot): ProjectEvidence[] {
    const commitsByRepo = new Map<string, string[]>();
    const prsByRepo = new Map<string, string[]>();
    const mergedPrCountByRepo = new Map<string, number>();
    const issuesByRepo = new Map<string, string[]>();
    const languagesByRepo = new Map<string, Array<{ language: string; bytes: number }>>();

    for (const commit of profileSnapshot.commits) {
      const current = commitsByRepo.get(commit.repoName) ?? [];
      current.push(commit.message);
      commitsByRepo.set(commit.repoName, current);
    }
    for (const pr of profileSnapshot.pullRequests) {
      const current = prsByRepo.get(pr.repoName) ?? [];
      current.push(pr.title);
      prsByRepo.set(pr.repoName, current);
      if (pr.mergedAt) {
        mergedPrCountByRepo.set(pr.repoName, (mergedPrCountByRepo.get(pr.repoName) ?? 0) + 1);
      }
    }
    for (const issue of profileSnapshot.issues) {
      const current = issuesByRepo.get(issue.repoName) ?? [];
      current.push(issue.title);
      issuesByRepo.set(issue.repoName, current);
    }
    for (const language of profileSnapshot.languages) {
      const current = languagesByRepo.get(language.repoName) ?? [];
      current.push({ language: language.language, bytes: language.bytes });
      languagesByRepo.set(language.repoName, current);
    }

    return profileSnapshot.repos
      .map(repo => {
        const commitMessages = commitsByRepo.get(repo.name) ?? [];
        const prTitles = prsByRepo.get(repo.name) ?? [];
        const issueTitles = issuesByRepo.get(repo.name) ?? [];
        const repoLanguages = (languagesByRepo.get(repo.name) ?? [])
          .sort((a, b) => b.bytes - a.bytes)
          .map(item => item.language);

        const evidenceLines = [
          ...prTitles.slice(0, 8),
          ...commitMessages.slice(0, 8),
          ...issueTitles.slice(0, 4)
        ];

        const architectureSignals = this.extractArchitectureSignals([
          repo.description ?? "",
          ...prTitles,
          ...commitMessages
        ]);

        const technologies = unique(
          [
            repo.language ?? "",
            ...repoLanguages,
            ...extractKeywords([repo.description ?? "", ...prTitles, ...commitMessages].join(" "))
          ].filter(Boolean)
        ).slice(0, 12);

        const quantifiedImpactSignals = this.extractQuantifiedImpacts(evidenceLines);

        return {
          repoName: repo.name,
          fullName: repo.fullName,
          summary:
            repo.description?.trim() ||
            `Projeto com ${commitMessages.length} commits e ${prTitles.length} PRs.`,
          technologies,
          architectureSignals,
          commitCount: commitMessages.length,
          pullRequestCount: prTitles.length,
          mergedPullRequestCount: mergedPrCountByRepo.get(repo.name) ?? 0,
          issueCount: issueTitles.length,
          quantifiedImpactSignals,
          evidence: evidenceLines.slice(0, 10)
        } satisfies ProjectEvidence;
      })
      .sort((a, b) => {
        const scoreA = a.commitCount + a.pullRequestCount * 2 + a.mergedPullRequestCount * 2;
        const scoreB = b.commitCount + b.pullRequestCount * 2 + b.mergedPullRequestCount * 2;
        return scoreB - scoreA;
      });
  }

  private extractArchitectureSignals(lines: string[]): string[] {
    const joined = lines.join(" ").toLowerCase();
    const patterns: Array<{ signal: string; regex: RegExp }> = [
      { signal: "Microservices", regex: /\bmicro[- ]?services?\b/ },
      { signal: "Monolito", regex: /\bmonolith|monolito\b/ },
      { signal: "Clean Architecture", regex: /\bclean architecture\b/ },
      { signal: "Hexagonal", regex: /\bhexagonal\b/ },
      { signal: "Event-Driven", regex: /\bevent[- ]driven|eventos\b/ },
      { signal: "Caching", regex: /\bcache|caching|redis\b/ },
      { signal: "API Design", regex: /\brest|graphql|api\b/ },
      { signal: "CI/CD", regex: /\bci\/cd|github actions|pipeline\b/ },
      { signal: "Testing", regex: /\btest|vitest|jest|e2e\b/ },
      { signal: "Observability", regex: /\bobservability|logs|metrics|tracing\b/ }
    ];
    return patterns.filter(item => item.regex.test(joined)).map(item => item.signal);
  }

  private extractQuantifiedImpacts(lines: string[]): string[] {
    const impactRegex =
      /\b(?:reduz(?:iu|ir)?|aument(?:ou|ar)?|improv(?:ed|e)|otimiz(?:ed|ou|ar)|decrease(?:d)?|increase(?:d)?)\b[\s\S]{0,50}?\b\d{1,4}(?:[.,]\d{1,2})?\s?%/i;
    const percentageRegex = /\b\d{1,4}(?:[.,]\d{1,2})?\s?%/;
    return unique(
      lines
        .map(l => l.trim())
        .filter(l => impactRegex.test(l) || percentageRegex.test(l))
        .map(l => (l.length > 180 ? `${l.slice(0, 177)}...` : l))
    ).slice(0, 10);
  }
}

// ── Markdown → ResumeDocument parser ────────────────────────────────────────

function parseSections(markdown: string): Record<string, string> {
  const sections: Record<string, string> = {};
  const lines = markdown.split("\n");
  let currentKey = "";
  const currentLines: string[] = [];

  const flush = () => {
    if (currentKey) {
      sections[currentKey.toLowerCase()] = currentLines.join("\n").trim();
    }
  };

  for (const line of lines) {
    if (line.startsWith("## ")) {
      flush();
      currentKey = line.replace(/^##\s+/, "").trim();
      currentLines.length = 0;
    } else {
      currentLines.push(line);
    }
  }
  flush();
  return sections;
}

function parseBulletSections(text: string): Array<{ title: string; bullets: string[] }> {
  if (!text.trim()) return [];
  const items: Array<{ title: string; bullets: string[] }> = [];
  const parts = text.split(/(?=^###\s)/m);

  for (const part of parts) {
    const lines = part.split("\n").filter(l => l.trim());
    if (!lines.length) continue;
    const firstLine = lines[0] ?? "";
    const title = firstLine.startsWith("### ")
      ? firstLine.replace(/^###\s+/, "").trim()
      : firstLine.replace(/^#+\s*/, "").trim();
    const bullets = lines
      .slice(firstLine.startsWith("#") ? 1 : 0)
      .map(l => l.replace(/^[-*•]\s*/, "").trim())
      .filter(l => l.length > 0);
    if (title && bullets.length > 0) items.push({ title, bullets });
  }

  // Flat list with no subsections — group all bullets under one item
  if (items.length === 0) {
    const bullets = text
      .split("\n")
      .map(l => l.replace(/^[-*•]\s*/, "").trim())
      .filter(l => l.length > 0 && !l.startsWith("#"));
    if (bullets.length > 0) items.push({ title: "Atividades", bullets });
  }

  return items;
}

function parseMarkdownToResumeDoc(
  markdown: string,
  locale: string,
  evidence: ProjectEvidence[]
): ResumeDocument {
  const lines = markdown.split("\n");

  // # Full Name
  const nameLine = lines.find(l => /^#\s+\S/.test(l));
  const fullName = nameLine?.replace(/^#\s+/, "").trim() || "Candidato";

  // Headline = first non-empty, non-heading line after the name
  const nameIdx = nameLine ? lines.indexOf(nameLine) : 0;
  const headline =
    lines
      .slice(nameIdx + 1)
      .find(l => l.trim() && !l.startsWith("#"))
      ?.trim() || "Desenvolvedor de Software";

  const sec = parseSections(markdown);

  const summary =
    sec["resumo"] || sec["summary"] || sec["sobre"] || lines.slice(nameIdx + 2, nameIdx + 5).join(" ").trim() || "Perfil em desenvolvimento.";

  // Skills: comma or newline separated
  const skillsRaw = sec["skills"] || sec["habilidades"] || sec["tecnologias"] || "";
  const skills = unique(
    skillsRaw
      .split(/[,\n]/)
      .map(s => s.replace(/^[-*•]\s*/, "").trim())
      .filter(s => s.length > 1 && !s.startsWith("#"))
  ).slice(0, 24);

  const experience = parseBulletSections(sec["experiencia"] || sec["experience"] || "");
  const projects = parseBulletSections(sec["projetos"] || sec["projects"] || "");

  const educationRaw = sec["educacao"] || sec["education"] || "";
  const education = educationRaw
    .split("\n")
    .map(l => l.replace(/^[-*•]\s*/, "").trim())
    .filter(l => l.length > 2 && !l.startsWith("#"))
    .slice(0, 8);

  const atsRaw = sec["keywords ats"] || sec["keywords"] || sec["palavras-chave"] || "";
  const atsKeywords = unique(
    atsRaw
      .split(/[,\n]/)
      .map(s => s.replace(/^[-*•]\s*/, "").trim())
      .filter(s => s.length > 1)
  ).slice(0, 30);

  const contactRaw = sec["contato"] || sec["contact"] || markdown;
  const emailMatch = contactRaw.match(/(?:email|e-mail):\s*(\S+@\S+)/i);
  const locationMatch = contactRaw.match(/(?:local|location|cidade):\s*(.+)/i);
  const githubMatch =
    contactRaw.match(/github:\s*(https?:\/\/\S+)/i) ||
    markdown.match(/https?:\/\/github\.com\/[\w-]+/i);

  // Strip the Keywords ATS section from rawMarkdown — keywords are in atsKeywords array
  // and go into PDF metadata only, not visible in the document body
  const rawMarkdownClean = markdown
    .replace(/\n## (?:Keywords ATS|Keywords|Palavras-chave)[^\n]*(?:\n[\s\S]*?)?(?=\n## |\n# |$)/i, "")
    .trimEnd();

  return ResumeDocumentSchema.parse({
    locale,
    fullName,
    headline,
    summary: summary.slice(0, 800),
    contact: {
      email: emailMatch?.[1]?.trim(),
      location: locationMatch?.[1]?.trim().slice(0, 80),
      github: githubMatch?.[1]?.trim()
    },
    skills: skills.length > 0 ? skills : ["Ver perfil GitHub"],
    experience:
      experience.length > 0
        ? experience
        : [{ title: "Contribuicoes no GitHub", bullets: ["Projetos e atividades no GitHub"] }],
    projects,
    projectEvidence: evidence.slice(0, 12),
    education,
    atsKeywords,
    rawMarkdown: rawMarkdownClean
  });
}

// ── PDF renderer — renders from raw markdown to match the preview 1:1 ─────────

// Parse inline markdown (bold, italic, code, links) into react-pdf Text nodes.
function parseInlineForPdf(raw: string): (string | JSX.Element)[] {
  type P = { re: RegExp; node: (m: RegExpMatchArray, k: number) => JSX.Element };
  const patterns: P[] = [
    {
      re: /\[([^\]]+)\]\((https?:\/\/[^)]+|mailto:[^)]+)\)/,
      node: (m, k) => <Text key={k} style={{ color: "#2563eb" }}>{m[1]!}</Text>
    },
    {
      re: /\*\*(.+?)\*\*/,
      node: (m, k) => <Text key={k} style={{ fontFamily: "Helvetica-Bold" }}>{m[1]!}</Text>
    },
    {
      re: /\*(.+?)\*/,
      node: (m, k) => <Text key={k} style={{ fontFamily: "Helvetica-Oblique" }}>{m[1]!}</Text>
    },
    {
      // Strip backticks — render content as plain text (backticks should not appear in resumes)
      re: /`(.+?)`/,
      node: (m, k) => <Text key={k}>{m[1]!}</Text>
    },
    {
      re: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/,
      node: (m, k) => <Text key={k} style={{ color: "#2563eb" }}>{m[0]}</Text>
    },
    {
      re: /https?:\/\/[^\s<>"&)]+/,
      node: (m, k) => <Text key={k} style={{ color: "#2563eb" }}>{m[0]}</Text>
    },
  ];

  const nodes: (string | JSX.Element)[] = [];
  let rem = raw;
  let kc = 0;
  while (rem.length > 0) {
    let best: { index: number; m: RegExpMatchArray; p: P } | null = null;
    for (const p of patterns) {
      const match = rem.match(p.re);
      if (match && match.index !== undefined && (!best || match.index < best.index)) {
        best = { index: match.index, m: match, p };
      }
    }
    if (!best) { nodes.push(rem); break; }
    if (best.index > 0) nodes.push(rem.slice(0, best.index));
    nodes.push(best.p.node(best.m, kc++));
    rem = rem.slice(best.index + best.m[0].length);
  }
  return nodes;
}

const pdfStyles = StyleSheet.create({
  page: { paddingHorizontal: 22, paddingVertical: 18, fontSize: 9.5, color: "#0f172a", fontFamily: "Helvetica" },
  h1: { fontFamily: "Helvetica-Bold", fontSize: 16, marginBottom: 1, color: "#0f172a" },
  h2Wrap: { marginTop: 10, marginBottom: 4, borderBottomWidth: 0.5, borderBottomColor: "#cbd5e1", paddingBottom: 2 },
  h2: { fontFamily: "Helvetica-Bold", fontSize: 11, color: "#0f172a" },
  h3: { fontFamily: "Helvetica-Bold", fontSize: 9.5, marginTop: 5, marginBottom: 1.5, color: "#374151" },
  bulletRow: { flexDirection: "row", marginBottom: 1.8, paddingLeft: 4 },
  bulletDot: { width: 8, fontSize: 9.5, color: "#64748b", paddingTop: 0.5 },
  bulletText: { flex: 1, fontSize: 9.5, lineHeight: 1.35, color: "#0f172a" },
  p: { fontSize: 9.5, lineHeight: 1.35, marginBottom: 1.5, color: "#0f172a" },
  spacer: { height: 2 },
});

const MarkdownPdfDocument = ({
  markdown,
  metadata = {}
}: {
  markdown: string;
  metadata?: PdfMetadata;
}) => {
  const lines = markdown.split("\n");
  const nodes: JSX.Element[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i] ?? "";

    if (line.startsWith("# ")) {
      nodes.push(<Text key={i} style={pdfStyles.h1}>{line.slice(2)}</Text>);
    } else if (line.startsWith("## ")) {
      nodes.push(
        <View key={i} style={pdfStyles.h2Wrap}>
          <Text style={pdfStyles.h2}>{line.slice(3)}</Text>
        </View>
      );
    } else if (line.startsWith("### ")) {
      nodes.push(<Text key={i} style={pdfStyles.h3}>{line.slice(4)}</Text>);
    } else if (/^[-*•] /.test(line)) {
      const bullets: string[] = [];
      while (i < lines.length && /^[-*•] /.test(lines[i] ?? "")) {
        bullets.push((lines[i] ?? "").replace(/^[-*•] /, ""));
        i++;
      }
      bullets.forEach((b, j) => {
        nodes.push(
          <View key={`b${i}-${j}`} style={pdfStyles.bulletRow}>
            <Text style={pdfStyles.bulletDot}>•</Text>
            <Text style={pdfStyles.bulletText}>{parseInlineForPdf(b)}</Text>
          </View>
        );
      });
      continue;
    } else if (line.trim()) {
      nodes.push(<Text key={i} style={pdfStyles.p}>{parseInlineForPdf(line)}</Text>);
    } else {
      nodes.push(<View key={i} style={pdfStyles.spacer} />);
    }
    i++;
  }

  return (
    <Document
      title={metadata.title}
      author={metadata.author}
      subject={metadata.subject}
      creator={metadata.creator}
      keywords={metadata.keywords}
      producer="Git Curriculo"
    >
      <Page size="A4" style={pdfStyles.page} wrap>
        {nodes}
      </Page>
    </Document>
  );
};

export const ResumeGenerationSchema = z.object({
  jobSpec: JobSpecSchema,
  profilePrompt: z.string().optional(),
  locale: z.string().default("pt-BR")
});
