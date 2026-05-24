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
import { buildAllProjectEvidence, collectSnapshotTechnologies } from "./projectProfileService";
import { sanitizeResumeMarkdown } from "./resumeAtsEnforcement";
import { filterSnapshotByRepos } from "./stackInferenceService";
import {
  buildJobKeywordPool,
  extractBroadKeywords,
  extractCompanyFromJob,
  extractJobTitleFromText,
  extractKeywords,
  normalizeKeyword,
  sanitizeJobTitle,
  stripAccents,
  stripEmojis,
  unique
} from "../utils/text";
import { filterMeaningfulImpactSignals } from "../utils/resumeMetrics";

export { buildJobKeywordPool, extractBroadKeywords, extractCompanyFromJob, extractJobTitleFromText, sanitizeJobTitle, stripEmojis };

interface GenerateResumeInput {
  jobSpec: JobSpec;
  profileSnapshot: GitHubProfileSnapshot;
  locale?: "pt-BR" | string;
  profilePrompt?: string;
  customRules?: string;
  resumeRepoNames?: string[];
}

interface WeaveMissingAtsInput {
  resumeMarkdown: string;
  missingKeywords: string[];
  profileSnapshot: GitHubProfileSnapshot;
  profilePrompt?: string;
  customRules?: string;
  resumeRepoNames?: string[];
  locale?: string;
  evidenceHints?: string[];
}

interface PolishResumeQualityInput {
  resumeMarkdown: string;
  profileSnapshot: GitHubProfileSnapshot;
  jobSpec: JobSpec;
  profilePrompt?: string;
  customRules?: string;
  resumeRepoNames?: string[];
  locale?: string;
  qualityReport: PolishQualityInput["qualityReport"];
}

interface ProviderStreamInput {
  jobSpec: JobSpec;
  profileSnapshot: GitHubProfileSnapshot;
  projectEvidence: ProjectEvidence[];
  allStackTechnologies: string[];
  resumeRepoNames?: string[];
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

export interface WeaveAtsKeywordsInput {
  resumeMarkdown: string;
  missingKeywords: string[];
  projectEvidence: ProjectEvidence[];
  profilePrompt: string;
  locale: string;
  customRules?: string;
  evidenceHints?: string[];
  allowedProjectRepos?: string[];
}

export interface PolishQualityInput {
  resumeMarkdown: string;
  projectEvidence: ProjectEvidence[];
  profilePrompt: string;
  locale: string;
  jobSpec: JobSpec;
  customRules?: string;
  qualityReport: {
    weakBullets: string[];
    metricPct: number;
    suggestions: string[];
  };
  allowedProjectRepos?: string[];
}

export interface ResumeProvider {
  generateResume(input: ProviderStreamInput): Promise<ResumeDocument>;
  generateResumeStream?(
    input: ProviderStreamInput,
    onChunk: (accumulated: string) => void
  ): Promise<string>;
  weaveAtsKeywordsStream?(
    input: WeaveAtsKeywordsInput,
    onChunk: (accumulated: string) => void
  ): Promise<string>;
  polishResumeQualityStream?(
    input: PolishQualityInput,
    onChunk: (accumulated: string) => void
  ): Promise<string>;
}

export interface DeepSeekProviderOptions {
  apiKey: string;
  model?: string;
  endpoint?: string;
}

export interface CoverLetterStreamInput {
  jobSpec: JobSpec;
  profileSnapshot: GitHubProfileSnapshot;
  projectEvidence: ProjectEvidence[];
  allStackTechnologies: string[];
  resumeRepoNames?: string[];
  profilePrompt: string;
  resumeMarkdown?: string;
  locale: string;
  customRules?: string;
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
    const topEvidence = input.projectEvidence;
    const allDetectedStacks =
      input.allStackTechnologies.length > 0
        ? input.allStackTechnologies
        : collectSnapshotTechnologies(input.profileSnapshot);
    const topLangs = unique(
      input.profileSnapshot.languages
        .sort((a, b) => b.bytes - a.bytes)
        .map(l => l.language)
    ).slice(0, 8);

    // Include raw commit/PR titles so the model can mine for real impact signals
    const evidenceBlock = topEvidence
      .map(e => {
        if (e.contextDossier?.trim()) {
          return e.contextDossier.trim();
        }

        const lines = [
          `### ${e.repoName}`,
          `Stack: ${e.technologies.slice(0, 12).join(", ") || "n/a"}`,
          `Descricao: ${e.summary.slice(0, 400)}`,
          e.architectureSignals.length > 0
            ? `Padroes: ${e.architectureSignals.join(", ")}`
            : ""
        ].filter(Boolean);

        if (e.engineeringInsights.length > 0) {
          lines.push("Insights de engenharia (DeepSeek):");
          for (const insight of e.engineeringInsights.slice(0, 6)) {
            lines.push(`  • ${insight.slice(0, 160)}`);
          }
        }

        if (e.analyzedEvidence.length > 0) {
          lines.push("Analises detalhadas de commits/PRs (PRIORIZE estes nos bullets):");
          for (const item of e.analyzedEvidence.slice(0, 24)) {
            lines.push(`  • ${item.slice(0, 160)}`);
          }
        }

        // Real commit messages and PR titles — model uses these to extract meaningful impact
        if (e.quantifiedImpactSignals.length > 0) {
          const meaningful = filterMeaningfulImpactSignals(e.quantifiedImpactSignals);
          if (meaningful.length > 0) {
            lines.push("Resultados mensuraveis (USE apenas metricas de impacto — NUNCA linhas/arquivos brutos):");
            for (const signal of meaningful.slice(0, 6)) {
              lines.push(`  • ${signal.slice(0, 120)}`);
            }
          }
        }

        if (e.evidence.length > 0) {
          lines.push("Commits e PRs reais (extraia impactos tecnicos concretos destes):");
          for (const ev of e.evidence.slice(0, 24)) {
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
      allDetectedStacks.length > 0
        ? `Stacks detectadas em TODOS os repositorios (use para keywords ATS mesmo que o projeto nao entre na secao Projetos): ${allDetectedStacks.join(", ")}`
        : "",
      input.resumeRepoNames && input.resumeRepoNames.length > 0
        ? `Projetos selecionados para secao Projetos do curriculo (SOMENTE estes): ${input.resumeRepoNames.join(", ")}`
        : "Projetos: use os dossies abaixo (todos os repos sincronizados)",
      `Repositorios publicos: ${u.publicRepos} | Seguidores: ${u.followers}`
    ]
      .filter(Boolean)
      .join("\n");

    const jobBlock = [
      input.jobSpec.company ? `Empresa: ${input.jobSpec.company}` : "",
      `Titulo: ${input.jobSpec.title}`,
      `Skills requeridas: ${input.jobSpec.requiredSkills.slice(0, 18).join(", ")}`,
      `Responsabilidades: ${input.jobSpec.responsibilities.slice(0, 5).join(" | ")}`,
      `Keywords ATS: ${input.jobSpec.keywords.slice(0, 30).join(", ")}`
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
      "## Projetos GitHub — analises reais de problemas, solucoes e melhorias",
      input.resumeRepoNames && input.resumeRepoNames.length > 0
        ? `INSTRUCAO CRITICA: A secao ## Projetos do curriculo deve conter EXCLUSIVAMENTE estes repos: ${input.resumeRepoNames.join(", ")}. NAO inclua habit, tradicao, NXD nem qualquer outro repo. Keywords de outros repos vao em ## Experiencia.`
        : "",
      "INSTRUCAO: Cada bloco abaixo descreve entregas REAIS: problemas resolvidos, solucoes implementadas, melhorias e resultados.",
      "NAO use contadores vazios (ex: '541 commits analisados'). Transforme entregas em bullets com IMPACTO QUANTIFICADO quando houver dado real nos dossies. Exemplos:",
      "  • 'Entreguei **12 PRs** com autenticacao **JWT** + **Redis**, eliminando sessao no servidor e suportando escala horizontal'",
      "  • 'Reducao de **42%** no Time-to-Interactive via lazy loading e pre-fetch de rotas criticas (dados de performance nos dossies)'",
      "  • 'Pipeline CI/CD com **GitHub Actions** cobrindo build, testes e deploy em **~3min** por release'",
      "Numeros VALIDOS: % de reducao/aumento, tempo (ms/min), usuarios/clientes, componentes/modulos entregues, PRs merged, latencia, cobertura de testes, dezenas/centenas de componentes.",
      "Numeros PROIBIDOS: linhas de codigo brutas, arquivos reorganizados, diff +8558/-2100 linhas, 'adicionando X linhas'. Linhas/arquivos SO se comparativo com resultado (ex: reduzi de 2000 para 800 linhas, -60%, mesma funcionalidade).",
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
      "1b. RESUMO OBRIGATORIO: Secao ## Resumo SEMPRE presente (3-4 frases sobre voce, posicionamento para a vaga, tom profissional). Use o contexto pessoal do candidato. NUNCA pule ## Resumo.",
      "2. IMPACTO TECNICO: Leia commits/PRs reais e reescreva como bullets STAR: acao + tecnologia + resultado numerico verificavel.",
      "3. METRICAS OBRIGATORIAS: Minimo **70%** dos bullets DEVEM conter impacto mensuravel real (%, tempo, escala, PRs/features). PROIBIDO citar contagem bruta de linhas ou arquivos — isso nao e resultado. Use linhas/arquivos APENAS em reducao comparativa (antes/depois + %).",
      "PROIBIDO bullet de lista de keywords (ex: 'Experiencia comprovada em: X, Y, Z'). Cada tecnologia deve aparecer dentro de um bullet que descreve entrega, problema ou resultado real.",
      "PROIBIDO linha de tags/stack apos titulo de projeto ou empresa (ex: '**React**, **TypeScript**, **Next.js**, **API REST**...'). Apos ### projeto va DIRETO para bullets (-).",
      "PROIBIDO paragrafo no Resumo com enumeracao de tecnologias separadas por virgula — integre no maximo 4-5 techs em frases naturais.",
      ...((): string[] => {
        const cr = (input.customRules ?? "").toLowerCase();
        const omitSkills = /n[aã]o.{0,30}(skills?|habilidades)|sem.{0,20}(skills?|habilidades)|(remov|omit|exclu|tir).{0,30}(skills?|habilidades)|(skills?|habilidades).{0,30}(n[aã]o|sem|remov|exclu)/.test(cr);
        return omitSkills
          ? [
              "4. ATS: Keywords do CHECKLIST DEVEM aparecer literalmente nos bullets de Experiencia ou Projetos (secao Skills removida). Cada termo do checklist = pelo menos 1 mencao explicita."
            ]
          : [
              "4. ATS: Keywords do CHECKLIST ATS (evidenciadas nos dossies GitHub) DEVEM aparecer literalmente em Skills ou bullets. Skills sem evidencia NAO entram em experiencia."
            ];
      })(),
      "5. ZERO ALUCINACAO: PROIBIDO inventar experiencia com tecnologias, plataformas ou produtos nao presentes no perfil GitHub ou no contexto fornecido. Se a skill nao esta no perfil do candidato, NAO coloque em bullets de experiencia como se o candidato tivesse usado. Colocar informacoes falsas prejudica gravemente o candidato.",
      "6. VOZ: Use SEMPRE primeira pessoa do singular. CORRETO: 'Desenvolvi', 'Implementei', 'Liderei'. ERRADO: 'Desenvolveu', 'Implementou'.",
      "7. LINKS e CONTATO: Na secao Contato use Markdown clicavel: [email@ex.com](mailto:email@ex.com), [linkedin.com/in/user](https://linkedin.com/in/user), [github.com/user](https://github.com/user). Numero de telefone SEMPRE como link WhatsApp: [51999999999](https://wa.me/5551999999999) — substitua pelo numero real. NUNCA texto plano para URLs ou telefone.",
      "8. NEGRITO: Use **negrito** SOMENTE em nomes de tecnologias, ferramentas e numeros/resultados dentro dos bullets. NUNCA no verbo.",
      "9. BULLETS PROFISSIONAIS: Inicie com verbo forte (Desenvolvi, Implementei, Otimizei) OU resultado numerico. PROIBIDO bullets vagos ('Inclusao de rotas', 'Adocao de arquitetura', 'Reorganizando arquivos'). Cada bullet = entrega + tech + resultado mensuravel. Minimo 70% com numeros reais.",
      "10. PERSONALIZACAO: Se a vaga informa empresa (ex: GX2), mencione **GX2** no ## Resumo e alinhe headline ao titulo da vaga. Integre 3-5 keywords da vaga em frases naturais.",
      "11. CREDIBILIDADE: PROIBIDO percentuais redondos inventados (100%, 80%, 70%, 60%, 50%) sem evidencia nos dossies. Preferir entregas concretas sem numero a inventar metricas.",
      "12. PROIBIDO usar backticks (`) em qualquer parte do curriculo.",
      "",
      ...((): string[] => {
        const cr = (input.customRules ?? "").toLowerCase();
        const omitSkills = /n[aã]o.{0,30}(skills?|habilidades)|sem.{0,20}(skills?|habilidades)|(remov|omit|exclu|tir).{0,30}(skills?|habilidades)|(skills?|habilidades).{0,30}(n[aã]o|sem|remov|exclu)/.test(cr);
        const sections = ["## Resumo", "## Contato", omitSkills ? null : "## Skills", "## Experiencia", "## Projetos", "## Educacao"].filter(Boolean) as string[];
        const projectOnly =
          input.resumeRepoNames && input.resumeRepoNames.length > 0
            ? [
                `12. SECAO PROJETOS: inclua EXCLUSIVAMENTE ${input.resumeRepoNames.join(", ")}. PROIBIDO adicionar qualquer outro repositorio em ## Projetos. Stack de outros repos pode ser citada apenas em bullets de ## Experiencia.`
              ]
            : [];
        return [
          "Estrutura Markdown obrigatoria:",
          "# [Nome Completo]",
          "[Headline — 1 linha objetiva, sem listar 10+ tecnologias]",
          ...sections,
          "Formato ## Projetos: ### repo — descricao curta (1 frase). Em seguida SOMENTE bullets (-). SEM linha de tecnologias entre titulo e bullets.",
          ...projectOnly
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

  private buildWeaveAtsMessages(input: WeaveAtsKeywordsInput) {
    const evidenceBlock = input.projectEvidence
      .slice(0, 10)
      .map(e => {
        if (e.contextDossier?.trim()) return e.contextDossier.trim().slice(0, 1600);
        return [
          `### ${e.repoName}`,
          e.summary.slice(0, 300),
          `Stack: ${e.technologies.slice(0, 14).join(", ")}`,
          ...e.evidence.slice(0, 8).map(item => `- ${item.slice(0, 120)}`)
        ].join("\n");
      })
      .join("\n\n");

    const rulesBlock = input.customRules?.trim()
      ? `\n## REGRAS DO CANDIDATO\n${input.customRules.trim()}`
      : "";

    const systemContent = [
      `Voce edita curriculos ATS em ${input.locale}. Tarefa: integrar keywords faltantes em bullets EXISTENTES.`,
      "",
      "REGRAS ABSOLUTAS:",
      "1. Edite bullets de Experiencia ou Projetos — incorpore cada keyword em frases que descrevem entrega real.",
      "2. PROIBIDO criar bullet de lista de keywords ('Experiencia comprovada em...', 'Stack: X, Y, Z').",
      "3. PROIBIDO linha de tags apos ### projeto (**React**, **TypeScript**, ...). Edite bullets existentes.",
      "4. PROIBIDO enumerar keywords separadas por virgula em um unico bullet.",
      "5. Distribua 1-3 keywords por bullet, no maximo, sempre com contexto (o que foi feito, com qual tech, qual resultado).",
      "6. Use evidencias dos dossies GitHub — so keywords com base real nos projetos.",
      "7. Mantenha empresas, datas, cargos, estrutura e tom do curriculo. Nao reescreva do zero.",
      input.allowedProjectRepos && input.allowedProjectRepos.length > 0
        ? `8. PROIBIDO criar novos ### em ## Projetos. Projetos permitidos: ${input.allowedProjectRepos.join(", ")}. Keywords de outros repos: integre em ## Experiencia.`
        : "8. Retorne o curriculo Markdown COMPLETO editado.",
      input.allowedProjectRepos && input.allowedProjectRepos.length > 0
        ? "9. Retorne o curriculo Markdown COMPLETO editado."
        : ""
    ]
      .filter(Boolean)
      .join("\n");

    const userContent = [
      "## Keywords faltantes (integrar naturalmente nos bullets existentes)",
      input.missingKeywords.join(", "),
      input.evidenceHints && input.evidenceHints.length > 0
        ? `\n## Onde colocar (evidencia GitHub)\n${input.evidenceHints.slice(0, 12).map(h => `- ${h}`).join("\n")}`
        : "",
      "",
      "## Dossies GitHub (evidencia real — use para contextualizar)",
      evidenceBlock,
      input.profilePrompt.trim()
        ? `\n## Contexto profissional\n${input.profilePrompt.slice(0, 3000)}`
        : "",
      rulesBlock,
      "",
      "## Curriculo atual — EDITE ESTE",
      input.resumeMarkdown.slice(0, 14000)
    ]
      .filter(Boolean)
      .join("\n");

    return [
      { role: "system" as const, content: systemContent },
      { role: "user" as const, content: userContent }
    ];
  }

  async weaveAtsKeywordsStream(
    input: WeaveAtsKeywordsInput,
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
        temperature: 0.2,
        stream: true,
        messages: this.buildWeaveAtsMessages(input)
      })
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Erro DeepSeek weave ATS (${response.status}): ${body}`);
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

    const woven = accumulated.trim() || input.resumeMarkdown;
    return sanitizeResumeMarkdown(woven, {
      allowedProjectRepos: input.allowedProjectRepos,
      profilePrompt: input.profilePrompt
    });
  }

  private buildPolishQualityMessages(input: PolishQualityInput) {
    const metricsBlock = input.projectEvidence
      .slice(0, 10)
      .flatMap(e => [
        ...e.quantifiedImpactSignals.slice(0, 4),
        e.pullRequestCount > 0
          ? `${e.repoName}: ${e.mergedPullRequestCount || e.pullRequestCount} PRs entregues`
          : ""
      ])
      .filter(Boolean)
      .slice(0, 16)
      .map(item => `- ${item}`)
      .join("\n");

    const systemContent = [
      `Voce e editor senior de curriculos ATS em ${input.locale}. Tarefa: elevar qualidade profissional dos bullets.`,
      "",
      "REGRAS ABSOLUTAS:",
      "1. Reescreva bullets FRACOS — adicione impacto real (%, tempo, escala, PRs). PROIBIDO linhas/arquivos brutos.",
      "2. PROIBIDO percentuais redondos sem evidencia (100%, 80%, 70%, 60%, 50%, 45%, 40%, 35%, 30%, 25%). REMOVA ou substitua por entregas concretas (PRs, componentes, rotas, usuarios).",
      "3. PROIBIDO: '8558 linhas', '1979 arquivos', '1243 linhas de documentacao'. PERMITIDO: reducao comparativa com antes/depois.",
      "4. PROIBIDO bullets vagos sem resultado mensuravel verificavel nos dossies.",
      "5. Resumo: maximo 8 tecnologias em negrito — integre o restante em frases naturais.",
      input.jobSpec.company
        ? `   Empresa alvo: ${input.jobSpec.company}. Titulo: ${input.jobSpec.title}`
        : `   Titulo alvo: ${input.jobSpec.title}`,
      "6. Inicie bullets com verbo forte (Desenvolvi, Implementei) ou escopo concreto (15+ rotas, 20+ componentes) dos dossies.",
      "7. Primeira pessoa. Gramatica PT-BR impecavel.",
      "8. Mantenha empresas, datas, cargos e estrutura. Edite cirurgicamente — nao reescreva do zero.",
      "9. Retorne o curriculo Markdown COMPLETO editado."
    ].join("\n");

    const userContent = [
      `Metricas atuais: ${input.qualityReport.metricPct}% bullets com numeros — meta: 70%+.`,
      "",
      "## Bullets fracos (reescrever com impacto quantificado)",
      input.qualityReport.weakBullets.length > 0
        ? input.qualityReport.weakBullets.map(b => `- ${b}`).join("\n")
        : "(detectados automaticamente — revise bullets de Experiencia/Projetos sem numeros)",
      "",
      "## Sugestoes de qualidade",
      input.qualityReport.suggestions.map(s => `- ${s}`).join("\n"),
      "",
      "## Metricas reais disponiveis (USE estas — nao invente)",
      metricsBlock || "(use PRs, componentes e escopo dos dossies abaixo)",
      "",
      "## Dossies GitHub",
      input.projectEvidence
        .slice(0, 8)
        .map(e => (e.contextDossier?.trim() ? e.contextDossier.slice(0, 1400) : `### ${e.repoName}\n${e.summary}`))
        .join("\n\n"),
      input.profilePrompt.trim()
        ? `\n## Contexto profissional\n${input.profilePrompt.slice(0, 3000)}`
        : "",
      input.customRules?.trim() ? `\n## Regras do candidato\n${input.customRules.trim()}` : "",
      "",
      "## Curriculo atual — EDITE ESTE",
      input.resumeMarkdown.slice(0, 14000)
    ]
      .filter(Boolean)
      .join("\n");

    return [
      { role: "system" as const, content: systemContent },
      { role: "user" as const, content: userContent }
    ];
  }

  async polishResumeQualityStream(
    input: PolishQualityInput,
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
        temperature: 0.25,
        stream: true,
        messages: this.buildPolishQualityMessages(input)
      })
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Erro DeepSeek polish qualidade (${response.status}): ${body}`);
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

    const polished = accumulated.trim() || input.resumeMarkdown;
    return sanitizeResumeMarkdown(polished, {
      allowedProjectRepos: input.allowedProjectRepos,
      profilePrompt: input.profilePrompt,
      jobSpec: input.jobSpec
    });
  }

  async generateResume(input: ProviderStreamInput): Promise<ResumeDocument> {
    let fullText = "";
    await this.generateResumeStream(input, text => {
      fullText = text;
    });
    return parseMarkdownToResumeDoc(fullText, input.locale, input.projectEvidence);
  }

  private buildCoverLetterMessages(input: CoverLetterStreamInput) {
    const u = input.profileSnapshot.user;
    const company = input.jobSpec.company ?? "a empresa";
    const evidenceBlock = input.projectEvidence
      .slice(0, 8)
      .map(e => {
        if (e.contextDossier?.trim()) {
          return e.contextDossier.slice(0, 1800);
        }
        const parts = [
          `- ${e.repoName}: ${e.summary.slice(0, 200)} (${e.technologies.slice(0, 6).join(", ")})`
        ];
        if (e.engineeringInsights.length > 0) {
          parts.push(`  Insight: ${e.engineeringInsights[0]!.slice(0, 120)}`);
        }
        return parts.join("\n");
      })
      .join("\n\n");

    const rulesBlock = input.customRules?.trim()
      ? `\n## INSTRUCOES DO CANDIDATO\n${input.customRules.trim()}`
      : "";

    const systemContent = [
      `Voce escreve cartas de apresentacao profissionais e autenticas em ${input.locale}.`,
      "REGRAS:",
      "1. Tom caloroso, profissional e genuino — mostre entusiasmo real pela empresa e pela vaga.",
      "2. Conecte paixoes, valores e motivacoes do candidato com a cultura, missao e produto da empresa citados na vaga.",
      "3. Demonstre conhecimento concreto sobre a empresa (nome, produto, cultura, diferenciais) usando apenas dados da vaga e do perfil.",
      "4. Relacione experiencias reais do candidato com responsabilidades da vaga — sem inventar fatos.",
      "5. Primeira pessoa do singular. 3-4 paragrafos curtos + fechamento com disponibilidade.",
      "6. NAO repita o curriculo inteiro — complemente com motivacao, fit cultural e interesse especifico.",
      "7. Sem emojis. Sem markdown complexo — apenas paragrafos de texto corrido.",
      "8. Mencione o nome da empresa pelo menos 2 vezes de forma natural."
    ].join("\n");

    const userContent = [
      `Empresa: ${company}`,
      `Vaga: ${input.jobSpec.title}`,
      `Resumo da vaga: ${input.jobSpec.summary.slice(0, 500)}`,
      `Responsabilidades: ${input.jobSpec.responsibilities.slice(0, 6).join(" | ")}`,
      "",
      `Candidato: ${u.name ?? u.login}`,
      input.profilePrompt.trim()
        ? `Contexto e paixoes do candidato:\n${input.profilePrompt.slice(0, 4000)}`
        : "",
      evidenceBlock ? `Projetos relevantes:\n${evidenceBlock}` : "",
      input.resumeMarkdown?.trim()
        ? `Curriculo gerado (referencia, nao copie):\n${input.resumeMarkdown.slice(0, 2500)}`
        : "",
      rulesBlock
    ]
      .filter(Boolean)
      .join("\n");

    return [
      { role: "system" as const, content: systemContent },
      { role: "user" as const, content: userContent }
    ];
  }

  async generateCoverLetterStream(
    input: CoverLetterStreamInput,
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
        temperature: 0.45,
        stream: true,
        messages: this.buildCoverLetterMessages(input)
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

    return accumulated.trim();
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

    const extractJobKeywords = (text: string): string[] => {
      const fromTech = extractKeywords(text);
      const n = normalizeKeyword(text);
      const matches = n.match(
        /\b(?:react|reactjs|vite|typescript|javascript|js|ts|node|nodejs|python|java|go|rust|c#|dotnet|php|ruby|swift|kotlin|dart|flutter|sql|sqlite|postgres|postgresql|mongodb|mysql|mariadb|redis|elasticsearch|docker|kubernetes|k8s|aws|azure|gcp|graphql|grpc|rest|restful|api|axios|zod|zustand|tailwind|tailwindcss|shadcn|tachyons|bootstrap|material.?ui|chakra|radix|ci.?cd|github.?actions|gitlab.?ci|jenkins|travis|testing|vitest|jest|playwright|cypress|next\.?js|nextjs|nuqs|html|html5|css|css3|scss|sass|git|github|gitlab|bitbucket|vue|vuejs|angular|svelte|webpack|babel|rollup|parcel|figma|storybook|laravel|rails|django|flask|fastapi|spring|vtex|shopify|magento|woocommerce|e.?commerce|linux|bash|shell|firebase|supabase|vercel|netlify|cloudflare|seo|acessibilidade|accessibility|performance|pwa|ssr|ssg|spa|design.?system|microfrontend|micro.?frontend|monorepo|turborepo|nx|lerna|websocket|webhook|graphql|agile|scrum|kanban|jira|confluence|okr|kpi|analytics|datadog|sentry|observabilidade|clean.?code|solid|tdd|bdd|ddd|passkeys|2fa|hook.?form|react.?hook.?form|server.?components|metadata|json.?ld|sitemap|csp|csrf|xss|ethers|viem|web3|fintech|trading|exchange|lightweight.?charts|class.?variance|cva|core.?web.?vitals|lcp|cls|inp|tanstack|react.?query|wcag|i18n|intl|chart\.js|tradingview|logrocket|indexeddb|offline.?first|cache|caching)\b/g
      ) ?? [];
      return unique([...fromTech, ...matches]);
    };

    const findSection = (startRe: RegExp, endRe: RegExp): string[] => {
      const norm = (l: string) => stripAccents(l);
      const start = lines.findIndex(l => startRe.test(norm(l)));
      if (start < 0) return [];
      const end = lines.findIndex((l, i) => i > start && endRe.test(norm(l)));
      return lines.slice(start + 1, end > 0 ? end : start + 30).filter(l => l.length > 4);
    };

    const title = extractJobTitleFromText(rawText, lines);
    const company = extractCompanyFromJob(rawText, lines);

    const summarySection = findSection(
      /resumo desta fun|sobre a vaga|sobre essa|overview da oportunidade|summary|about the role|para voce nos conhecer/i,
      /suas responsabilidades|responsibilities|requisitos|habilidades|o que oferecemos|beneficios/i
    );
    const respSection = findSection(
      /responsabilidades e atribuicoes|responsabilidades:|responsabilidades incluem|responsibilities/i,
      /requisitos.?minimos|minimum req|habilidades que voce precisa|habilidades que voce|skills?(?:\s+que\s+voce|\s+required)|qualificacoes|o que voce vai encontrar|o que oferecemos/i
    );
    const reqSection = findSection(
      /requisitos.?(?:minimos|essenciais|obrigatorios)|minimum req|habilidades que voce precisa|skills?(?:\s+que\s+voce\s+precisa|\s+required)|qualificacoes/i,
      /habilidades desej|diferenciais|nice.?to.?have|o que voce vai encontrar|beneficios|conecte|sobre n[oó]s|sobre a empresa/i
    );
    const prefSection = findSection(
      /habilidades que vao fazer|habilidades desej|diferenciais|nice.?to.?have|desejavel/i,
      /o que voce vai encontrar|o que oferecemos|beneficios|conecte|sobre n[oó]s|recado da/i
    );

    const summary = (summarySection.length > 0 ? summarySection : lines.slice(0, 6)).join(" ").slice(0, 500);
    const responsibilities = respSection
      .flatMap(l => l.split(/;+/))
      .map(l => l.replace(/^[-•*]\s*/, "").trim())
      .filter(l => l.length > 8)
      .slice(0, 15);

    const reqText = reqSection.length > 0 ? reqSection.join("\n") : rawText;
    const requiredSkills = unique([
      ...reqSection.flatMap(l => extractJobKeywords(l)),
      ...extractJobKeywords(reqText)
    ]);

    const preferredSkills =
      prefSection.length > 0
        ? unique(prefSection.flatMap(l => extractJobKeywords(l)))
        : [];

    const extraKeywords = [
      ...responsibilities.flatMap(l => extractJobKeywords(l)),
      ...extractJobKeywords(summary),
      ...extractBroadKeywords(rawText)
    ];

    const keywords = unique([...requiredSkills, ...preferredSkills, ...extraKeywords]);

    const locationMatch = rawText.match(/\b(remot[oa]|h[íi]brido|presencial)\b/i);
    const levelMatch = title.match(/\b(junior|pleno|senior|sr\.|lead|mid.?level|mid)\b/i);

    return JobSpecSchema.parse({
      title,
      company,
      location: locationMatch?.[1],
      level: levelMatch?.[1],
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
    const resumeRepoNames = input.resumeRepoNames?.filter(Boolean);
    const evidenceSnapshot = filterSnapshotByRepos(input.profileSnapshot, resumeRepoNames);
    const projectEvidence = buildAllProjectEvidence(evidenceSnapshot, { repoNames: resumeRepoNames });
    const allStackTechnologies = collectSnapshotTechnologies(input.profileSnapshot);

    const streamInput: ProviderStreamInput = {
      jobSpec: input.jobSpec,
      profileSnapshot: input.profileSnapshot,
      projectEvidence,
      allStackTechnologies,
      resumeRepoNames,
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

      markdown = sanitizeResumeMarkdown(markdown, {
        allowedProjectRepos: resumeRepoNames,
        profilePrompt: streamInput.profilePrompt,
        jobSpec: streamInput.jobSpec
      });
      onChunk(markdown);

      const doc = parseMarkdownToResumeDoc(markdown, locale, projectEvidence);
      doc.rawMarkdown = markdown;
      return doc;
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Falha desconhecida na geracao do curriculo.";
      throw new Error(`Falha ao gerar curriculo: ${message}`);
    }
  }

  async generateResume(input: GenerateResumeInput): Promise<ResumeDocument> {
    return this.streamResume(input, () => {});
  }

  /** Integra keywords evidenciadas em bullets existentes — sem dump de lista. */
  async weaveMissingAtsKeywords(
    input: WeaveMissingAtsInput,
    onChunk: (accumulated: string) => void
  ): Promise<string> {
    if (!this.provider?.weaveAtsKeywordsStream) {
      return input.resumeMarkdown;
    }

    const missing = input.missingKeywords.filter(Boolean);
    if (missing.length === 0) return input.resumeMarkdown;

    const locale = input.locale ?? "pt-BR";
    const resumeRepoNames = input.resumeRepoNames?.filter(Boolean);
    const evidenceSnapshot = filterSnapshotByRepos(input.profileSnapshot, resumeRepoNames);
    const projectEvidence = buildAllProjectEvidence(evidenceSnapshot, { repoNames: resumeRepoNames });

    return this.provider.weaveAtsKeywordsStream(
      {
        resumeMarkdown: input.resumeMarkdown,
        missingKeywords: missing,
        projectEvidence,
        profilePrompt: input.profilePrompt?.trim() ?? "",
        locale,
        customRules: input.customRules?.trim(),
        evidenceHints: input.evidenceHints,
        allowedProjectRepos: resumeRepoNames
      },
      onChunk
    );
  }

  async streamCoverLetter(
    input: GenerateResumeInput & { resumeMarkdown?: string },
    onChunk: (accumulated: string) => void
  ): Promise<string> {
    if (!this.provider || !(this.provider instanceof DeepSeekResumeProvider)) {
      throw new Error(
        "DeepSeek API Key obrigatoria para gerar carta de apresentacao."
      );
    }

    const locale = input.locale ?? "pt-BR";
    const resumeRepoNames = input.resumeRepoNames?.filter(Boolean);
    const evidenceSnapshot = filterSnapshotByRepos(input.profileSnapshot, resumeRepoNames);
    const projectEvidence = buildAllProjectEvidence(evidenceSnapshot, { repoNames: resumeRepoNames });
    const allStackTechnologies = collectSnapshotTechnologies(input.profileSnapshot);

    return this.provider.generateCoverLetterStream(
      {
        jobSpec: input.jobSpec,
        profileSnapshot: input.profileSnapshot,
        projectEvidence,
        allStackTechnologies,
        resumeRepoNames,
        profilePrompt: input.profilePrompt?.trim() ?? "",
        resumeMarkdown: input.resumeMarkdown,
        locale,
        customRules: input.customRules?.trim()
      },
      onChunk
    );
  }

  /** Eleva qualidade profissional: metricas, verbos, personalizacao. */
  async polishResumeQuality(
    input: PolishResumeQualityInput,
    onChunk: (accumulated: string) => void
  ): Promise<string> {
    if (!this.provider?.polishResumeQualityStream) {
      return input.resumeMarkdown;
    }

    const locale = input.locale ?? "pt-BR";
    const resumeRepoNames = input.resumeRepoNames?.filter(Boolean);
    const evidenceSnapshot = filterSnapshotByRepos(input.profileSnapshot, resumeRepoNames);
    const projectEvidence = buildAllProjectEvidence(evidenceSnapshot, { repoNames: resumeRepoNames });

    return this.provider.polishResumeQualityStream(
      {
        resumeMarkdown: input.resumeMarkdown,
        projectEvidence,
        profilePrompt: input.profilePrompt?.trim() ?? "",
        locale,
        jobSpec: input.jobSpec,
        customRules: input.customRules?.trim(),
        qualityReport: input.qualityReport,
        allowedProjectRepos: resumeRepoNames
      },
      onChunk
    );
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
      creator: resume.fullName,
      keywords: resume.atsKeywords.join(", "),
      description: resume.summary.slice(0, 300),
      ...meta
    };
    delete metadata.subject;
    return pdf(<MarkdownPdfDocument markdown={markdown} metadata={metadata} />).toBlob();
  }

  async exportMarkdownPdf(markdown: string, meta?: PdfMetadata): Promise<Blob> {
    const metadata: PdfMetadata = { title: "Curriculo", ...meta };
    delete metadata.subject;
    return pdf(<MarkdownPdfDocument markdown={markdown} metadata={metadata} />).toBlob();
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
      creator={metadata.creator}
      keywords={metadata.keywords}
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
