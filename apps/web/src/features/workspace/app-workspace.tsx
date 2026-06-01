"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { BookMarked, Check, ChevronDown, ChevronUp, Clipboard, Eye, FileText, GitBranch, GitMerge, GitPullRequest, Lock, Mail, MapPin, RefreshCw, Star, Users } from "lucide-react";
import {
  DeepSeekResumeProvider,
  MetricsService,
  ResumeService,
  SecureStorage,
  SyncService,
  AiAtsAnalyzer,
  blueprintToGenerationRules,
  buildRepoProfile,
  sanitizeResumeMarkdown,
  updateBlueprintFromEvaluation,
  atsAnalysisFromBlueprint,
  blueprintToPromptBlock,
  evidenceHintsForKeywords,
  filterEvidenceByRepos,
  findMissingEvidencedKeywords,
  normalizeKeyword,
  analyzeResumeQuality,
  buildPdfDocumentTitle,
  unique,
  type AtsAnalysis,
  type AtsBlueprint,
  type EncryptedSecret,
  type GitHubProfileSnapshot
} from "@gitcurriculo/core";
import { Button, GitHubLikeDashboardPage, Input, Textarea } from "@gitcurriculo/ui";

import { RepoDetailPanel } from "@/components/repo-detail-panel";
import { SyncProgressPanel } from "@/components/sync-progress-panel";
import { MarkdownPreview } from "@/components/markdown-preview";
import { downloadBlob, downloadText } from "@gitcurriculo/core";
import {
  readJsonLocalStorage,
  readLocalStorage,
  readSessionStorage,
  writeLocalStorage,
  writeSessionStorage
} from "@/lib/browser-storage";
import { useStorage } from "@/providers/storage-provider";
import { useAppStore } from "@/store/use-app-store";
import { useAuthStore } from "@/store/use-auth-store";
import { useResumeStore } from "@/store/use-resume-store";

const AUTH_START_PATH = "/api/oauth/github/start";
const OAUTH_BRIDGE_KEY = "git-curriculo:web:oauth-bridge";
const SESSION_TOKEN_KEY = "git-curriculo:web:session-token";   // sessionStorage: cleared on tab close
const LOCAL_DEEPSEEK_KEY = "git-curriculo:web:deepseek-key";   // localStorage: persists across sessions
const LOCAL_PASSPHRASE_KEY = "git-curriculo:web:passphrase";   // localStorage: persists across sessions
const LOCAL_JOB_TEXT_KEY = "git-curriculo:web:job-text";
const LOCAL_PROFILE_PROMPT_KEY = "git-curriculo:web:profile-prompt";
const LOCAL_CUSTOM_RULES_KEY = "git-curriculo:web:custom-rules";
const LOCAL_RESUME_REPOS_KEY = "git-curriculo:resume-repos";

const LOCAL_REGENERATE_NOTES_KEY = "git-curriculo:web:regenerate-notes";
const LOCAL_COVER_REGENERATE_NOTES_KEY = "git-curriculo:web:cover-regenerate-notes";

function loadResumeRepoNames(): string[] {
  const parsed = readJsonLocalStorage<unknown>(LOCAL_RESUME_REPOS_KEY, []);
  return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
}

const resolveSecret = async (
  plain: string,
  encrypted: EncryptedSecret | null,
  passphrase: string,
  secureStorage: SecureStorage
): Promise<string> => {
  if (plain.trim().length > 0) return plain.trim();
  if (!encrypted) return "";
  if (!passphrase.trim()) {
    throw new Error("Informe a passphrase para desbloquear credenciais salvas.");
  }
  return secureStorage.decryptSecret(encrypted, passphrase);
};

export function AppWorkspace(): JSX.Element {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [statusMessage, setStatusMessage] = useState("");
  const [lastSyncAt, setLastSyncAt] = useState<string | null>(null);
  const view = pathname.startsWith("/curriculo") ? "curriculo" : "overview";
  const repoFromPath = pathname.startsWith("/repo/")
    ? decodeURIComponent(pathname.slice("/repo/".length).split("/")[0] ?? "")
    : null;
  const selectedRepo = searchParams.get("repo") ?? repoFromPath ?? null;
  const setView = (next: string | null): void => {
    if (next === "curriculo") router.replace("/curriculo");
    else router.replace("/overview");
  };
  const setSelectedRepo = (repo: string | null): void => {
    if (repo) {
      router.replace(`/repo/${encodeURIComponent(repo)}`);
      return;
    }
    const base = view === "curriculo" ? "/curriculo" : "/overview";
    router.replace(base);
  };
  const {
    githubToken,
    deepseekApiKey,
    passphrase,
    showSecrets,
    setGithubToken,
    setDeepseekApiKey,
    setPassphrase,
    setShowSecrets
  } = useAuthStore();

  const {
    jobText,
    profilePrompt,
    customRules,
    regenerateNotes,
    coverRegenerateNotes,
    streamingMarkdown,
    editedMarkdown,
    resumeSourceMarkdown,
    aiAtsPromptBlock,
    atsBlueprint,
    isStreaming,
    copiedMd,
    previewMode,
    coverLetterMarkdown,
    isGeneratingCoverLetter,
    contentTab,
    resumeRepoNames,
    setJobText,
    setProfilePrompt,
    setCustomRules,
    setRegenerateNotes,
    setCoverRegenerateNotes,
    setStreamingMarkdown,
    setEditedMarkdown,
    setResumeSourceMarkdown,
    setAiAtsPromptBlock,
    setAtsBlueprint,
    setIsStreaming,
    setCopiedMd,
    setPreviewMode,
    setCoverLetterMarkdown,
    setIsGeneratingCoverLetter,
    setContentTab,
    setResumeRepoNames
  } = useResumeStore();

  const authPopupRef = useRef<Window | null>(null);
  const popupWatcherRef = useRef<number | null>(null);
  const loginStartedAtRef = useRef<number | null>(null);
  const storageHydratedRef = useRef(false);

  const {
    snapshot,
    metrics,
    ats,
    resume,
    syncStatus,
    loading,
    error,
    setSnapshot,
    setMetrics,
    setAts,
    setResume,
    setSyncStatus,
    setLoading,
    setError
  } = useAppStore();

  const { storage: sqliteStorage, secureStorage, localStateStorage } = useStorage();
  const syncService = useMemo(() => new SyncService(), []);
  const metricsService = useMemo(() => new MetricsService(), []);

  const clearPopupWatcher = (): void => {
    if (popupWatcherRef.current !== null) {
      window.clearInterval(popupWatcherRef.current);
      popupWatcherRef.current = null;
    }
  };

  const consumeOAuthBridgePayload = (): {
    type?: string;
    token?: string;
    error?: string;
  } | null => {
    const raw = readLocalStorage(OAUTH_BRIDGE_KEY, "");
    if (!raw.trim()) return null;
    writeLocalStorage(OAUTH_BRIDGE_KEY, "");
    try {
      const parsed = JSON.parse(raw) as { type?: string; token?: string; error?: string };
      if (!parsed || typeof parsed !== "object") return null;
      return parsed;
    } catch {
      return null;
    }
  };

  const handleOAuthPayload = (payload: {
    type?: string;
    token?: string;
    error?: string;
  }): boolean => {
    if (payload.type === "GITHUB_AUTH_SUCCESS" && payload.token) {
      clearPopupWatcher();
      authPopupRef.current?.close();
      authPopupRef.current = null;
      loginStartedAtRef.current = null;
      setGithubToken(payload.token);
      setLoading(false);
      setStatusMessage("Login GitHub concluido. Sincronizando automaticamente...");
      void syncGitHubDataWithToken(payload.token);
      return true;
    }

    if (payload.type === "GITHUB_AUTH_ERROR") {
      clearPopupWatcher();
      authPopupRef.current?.close();
      authPopupRef.current = null;
      loginStartedAtRef.current = null;
      setLoading(false);
      setError(payload.error ?? "Falha no login com GitHub.");
      return true;
    }

    return false;
  };

  // stores ja hidratam via AppProviders; mantemos a flag para logica legada abaixo
  useEffect(() => {
    storageHydratedRef.current = true;
  }, []);

  useEffect(() => {
    const init = async (): Promise<void> => {
      const settings = localStateStorage.loadSettings();

      const currentPassphrase = readLocalStorage(LOCAL_PASSPHRASE_KEY);
      if (currentPassphrase && !readSessionStorage(SESSION_TOKEN_KEY) && settings.githubTokenEncrypted) {
        try {
          const decrypted = await secureStorage.decryptSecret(settings.githubTokenEncrypted, currentPassphrase);
          setGithubToken(decrypted);
          writeSessionStorage(SESSION_TOKEN_KEY, decrypted);
        } catch {
          setStatusMessage("Nao foi possivel decriptar o token salvo com a passphrase atual.");
        }
      }

      await sqliteStorage.init();
      const dbSnapshot = await sqliteStorage.getLatestSnapshot();
      if (dbSnapshot) {
        setSnapshot(dbSnapshot);
        setMetrics(
          metricsService.computeProfileMetrics({
            profileSnapshot: dbSnapshot,
            windowMonths: 24
          })
        );
      }

      if (settings.lastSyncAt) setLastSyncAt(settings.lastSyncAt);
    };

    void init();
    return () => clearPopupWatcher();
  }, [
    localStateStorage,
    metricsService,
    secureStorage,
    setMetrics,
    setSnapshot,
    sqliteStorage
  ]);

  // persistencia agora e feita pelos setters do Zustand stores

  useEffect(() => {
    if (!snapshot) return;
    setResumeRepoNames(prev => {
      const valid = prev.filter(name => snapshot.repos.some(r => r.name === name));
      return valid.length === prev.length ? prev : valid;
    });
  }, [snapshot]);

  const resumeReposForGeneration = resumeRepoNames.length > 0 ? resumeRepoNames : undefined;

  const toggleResumeRepo = (repoName: string, include: boolean): void => {
    setResumeRepoNames(prev => {
      if (include) return unique([...prev, repoName]);
      return prev.filter(name => name !== repoName);
    });
  };

  const syncGitHubDataWithToken = async (
    tokenValue?: string,
    options?: { forceFull?: boolean }
  ): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      const settings = localStateStorage.loadSettings();
      const token = tokenValue
        ? tokenValue
        : await resolveSecret(githubToken, settings.githubTokenEncrypted, passphrase, secureStorage);

      if (!token) throw new Error("Faca login com GitHub para sincronizar.");

      const since = options?.forceFull ? undefined : (settings.lastSyncAt ?? undefined);
      setStatusMessage(
        options?.forceFull
          ? "Sincronizacao completa (24 meses) — buscando todos os repositorios..."
          : since
            ? `Buscando dados novos desde ${new Date(since).toLocaleDateString("pt-BR")}...`
            : "Sincronizacao inicial (24 meses)..."
      );

      const incrementalSnapshot = await syncService.runManualSync({
        token,
        since,
        deepseekApiKey: await resolveSecret(
          deepseekApiKey,
          settings.deepseekApiKeyEncrypted,
          passphrase,
          secureStorage
        ),
        onProgress: (progress) => {
          setSyncStatus({
            ...syncService.getLastSyncStatus(),
            stage: "running",
            progress
          });
        }
      });
      const existingSnapshot = snapshot ?? (await sqliteStorage.getLatestSnapshot());
      const finalSnapshot = existingSnapshot
        ? syncService.mergeSnapshots(existingSnapshot, incrementalSnapshot)
        : incrementalSnapshot;

      const profileMetrics = metricsService.computeProfileMetrics({
        profileSnapshot: finalSnapshot,
        windowMonths: 24
      });

      await sqliteStorage.saveSnapshot(finalSnapshot);
      setSnapshot(finalSnapshot);
      setMetrics(profileMetrics);
      setSyncStatus(syncService.getLastSyncStatus());

      const persistWarning = sqliteStorage.getPersistWarning?.() ?? null;
      if (persistWarning) {
        setError(persistWarning);
      }

      const now = new Date().toISOString();
      const updatedSettings = localStateStorage.loadSettings();
      updatedSettings.lastSyncAt = now;
      localStateStorage.saveSettings(updatedSettings);
      setLastSyncAt(now);

      const status = syncService.getLastSyncStatus();
      setStatusMessage(
        `${options?.forceFull ? "Sync completa:" : "Sync incremental:"} +${status.syncedCommits} commits, +${status.syncedPullRequests} PRs, +${status.syncedIssues} issues em ${status.syncedRepos} repos. Total: ${finalSnapshot.repos.length} repos, ${finalSnapshot.commits.length} commits.`
      );
    } catch (syncError) {
      setError(syncError instanceof Error ? syncError.message : "Erro de sincronizacao.");
      setSyncStatus(syncService.getLastSyncStatus());
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const initialPayload = consumeOAuthBridgePayload();
    if (initialPayload) {
      handleOAuthPayload(initialPayload);
    }

    const handler = (event: MessageEvent<unknown>): void => {
      if (!event.data || typeof event.data !== "object") return;

      const payload = event.data as {
        type?: string;
        token?: string;
        error?: string;
        payload?: { token?: string };
      };

      if (event.origin === window.location.origin) {
        handleOAuthPayload(payload);
      }
    };

    const storageHandler = (event: StorageEvent): void => {
      if (event.key !== OAUTH_BRIDGE_KEY || !event.newValue) return;
      try {
        const payload = JSON.parse(event.newValue) as {
          type?: string;
          token?: string;
          error?: string;
        };
        handleOAuthPayload(payload);
      } catch {
        // ignore malformed payload
      }

    };

    window.addEventListener("message", handler);
    window.addEventListener("storage", storageHandler);
    return () => {
      window.removeEventListener("message", handler);
      window.removeEventListener("storage", storageHandler);
    };
  }, [setError]);

  const loginWithGitHub = async (): Promise<void> => {
    setLoading(true);
    setError(null);

    const width = 560;
    const height = 720;
    const left = Math.max(0, window.screenX + Math.round((window.outerWidth - width) / 2));
    const top = Math.max(0, window.screenY + Math.round((window.outerHeight - height) / 2));

    const popup = window.open(
      AUTH_START_PATH,
      "github-oauth-login",
      `width=${width},height=${height},left=${left},top=${top},resizable=yes,scrollbars=yes`
    );

    if (!popup) {
      setLoading(false);
      setError("Popup bloqueado pelo navegador. Permita popups para continuar.");
      return;
    }

    authPopupRef.current = popup;
    loginStartedAtRef.current = Date.now();
    setStatusMessage("Popup de login do GitHub aberto...");
    clearPopupWatcher();
    popupWatcherRef.current = window.setInterval(() => {
      const bridgePayload = consumeOAuthBridgePayload();
      if (bridgePayload && handleOAuthPayload(bridgePayload)) {
        return;
      }

      if (loginStartedAtRef.current && Date.now() - loginStartedAtRef.current > 90_000) {
        clearPopupWatcher();
        authPopupRef.current?.close();
        authPopupRef.current = null;
        loginStartedAtRef.current = null;
        setLoading(false);
        setError("Tempo limite do login GitHub. Tente novamente.");
        return;
      }

      if (!authPopupRef.current || authPopupRef.current.closed) {
        clearPopupWatcher();
        authPopupRef.current = null;
        loginStartedAtRef.current = null;
        setLoading(false);
      }
    }, 500);
  };

  const persistSecrets = async (): Promise<void> => {
    if (!passphrase) {
      setError("Defina uma passphrase para persistir segredos com criptografia local.");
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const settings = localStateStorage.loadSettings();
      settings.githubTokenEncrypted = githubToken
        ? await secureStorage.encryptSecret(githubToken, passphrase)
        : settings.githubTokenEncrypted;
      settings.deepseekApiKeyEncrypted = deepseekApiKey
        ? await secureStorage.encryptSecret(deepseekApiKey, passphrase)
        : settings.deepseekApiKeyEncrypted;
      localStateStorage.saveSettings(settings);
      setStatusMessage("Credenciais persistidas com AES-GCM + PBKDF2 no navegador local.");
    } catch (persistError) {
      setError(persistError instanceof Error ? persistError.message : "Falha ao salvar segredos.");
    } finally {
      setLoading(false);
    }
  };

  const clearLocalSecrets = (): void => {
    setGithubToken("");
    setDeepseekApiKey("");
    setPassphrase("");
    sessionStorage.removeItem(SESSION_TOKEN_KEY);
    localStorage.removeItem(LOCAL_DEEPSEEK_KEY);
    localStorage.removeItem(LOCAL_PASSPHRASE_KEY);

    const settings = localStateStorage.loadSettings();
    settings.githubTokenEncrypted = null;
    settings.deepseekApiKeyEncrypted = null;
    localStateStorage.saveSettings(settings);
    setStatusMessage("Segredos removidos do estado atual e do armazenamento local.");
  };

  const analyzeAndGenerateResume = async (options?: {
    extraRules?: string;
    regenerate?: boolean;
    baseMarkdown?: string;
    blueprintOverride?: AtsBlueprint;
  }): Promise<void> => {
    const extraRules = options?.extraRules;
    const isRegeneration = options?.regenerate ?? Boolean(extraRules?.includes("REESCRITA CIRURGICA"));
    const isFirstGeneration = !resume && !isRegeneration;
    const previousMarkdown = options?.baseMarkdown ?? editedMarkdown;
    const iterationBlueprint = options?.blueprintOverride ?? atsBlueprint ?? undefined;

    setIsStreaming(true);
    setError(null);
    void setView("curriculo");
    if (!isRegeneration) {
      setStreamingMarkdown("");
      setEditedMarkdown("");
      setResume(null);
      if (isFirstGeneration) setAts(null);
    } else {
      setStreamingMarkdown(previousMarkdown);
    }
    try {
      if (!snapshot || !metrics) {
        throw new Error("Execute a sincronizacao do GitHub antes de gerar curriculo.");
      }
      if (!jobText.trim()) {
        throw new Error("Cole o texto da vaga para gerar analise ATS.");
      }

      const settings = localStateStorage.loadSettings();
      const resolvedDeepseekApiKey = await resolveSecret(
        deepseekApiKey,
        settings.deepseekApiKeyEncrypted,
        passphrase,
        secureStorage
      );
      if (!resolvedDeepseekApiKey) {
        throw new Error(
          "Informe a DeepSeek API Key para gerar curriculo real com base nos seus projetos."
        );
      }

      const resumeService = new ResumeService(
        new DeepSeekResumeProvider({ apiKey: resolvedDeepseekApiKey })
      );
      const aiAts = new AiAtsAnalyzer({ apiKey: resolvedDeepseekApiKey });

      const jobSpec = resumeService.parseJobText(jobText);

      setAts({
        score: 0,
        matchedKeywords: [],
        missingKeywords: [],
        suggestions: [],
        evidence: ["Fase 1/3: IA criando blueprint ATS (JSON)..."],
        evidencedKeywords: [],
        gapsInResume: [],
        unavailableKeywords: []
      });

      let profileAnalysis: {
        ats: AtsAnalysis;
        blueprint: AtsBlueprint;
        promptBlock: string;
      };

      if (isRegeneration && iterationBlueprint) {
        profileAnalysis = {
          blueprint: iterationBlueprint,
          ats: atsAnalysisFromBlueprint(iterationBlueprint),
          promptBlock: blueprintToPromptBlock(iterationBlueprint)
        };
      } else {
        profileAnalysis = await aiAts.analyzeProfileForJob({
          jobSpec,
          jobFullText: jobText,
          profileSnapshot: snapshot,
          profilePrompt,
          resumeRepoNames: resumeReposForGeneration,
          customRules: customRules.trim() || undefined
        });
      }

      setAtsBlueprint(profileAnalysis.blueprint);
      setAiAtsPromptBlock(profileAnalysis.promptBlock);

      if (isFirstGeneration) {
        setAts({
          ...profileAnalysis.ats,
          evidence: [
            "Blueprint ATS criado — Fase 2/3: gerando curriculo alinhado ao plano...",
            ...profileAnalysis.ats.evidence.slice(0, 4)
          ],
          blueprint: profileAnalysis.blueprint
        });
      }

      let fullGeneratedMarkdown = previousMarkdown;
      const mandatoryKeywords = profileAnalysis.blueprint.evidencedKeywords;
      const candidateRules = customRules.trim();
      const omitSkillsRule = /tir.{0,20}(skills?|habilidades)|sem.{0,20}(skills?|habilidades)/i.test(candidateRules);
      const blueprintRules = blueprintToGenerationRules(profileAnalysis.blueprint, {
        jobSpec,
        resumeRepoNames: resumeReposForGeneration,
        omitSkillsRule,
        extraRules: extraRules?.trim()
      });

      setAts({
        score: 0,
        matchedKeywords: [],
        missingKeywords: [],
        suggestions: [],
        evidence: ["Fase 2/3: gerando curriculo encaixado no blueprint ATS..."],
        evidencedKeywords: profileAnalysis.blueprint.evidencedKeywords,
        gapsInResume: profileAnalysis.blueprint.evidencedKeywords,
        unavailableKeywords: profileAnalysis.blueprint.unavailableKeywords,
        blueprint: profileAnalysis.blueprint
      });

      const generatedResume = await resumeService.streamResume(
        {
          jobSpec,
          profileSnapshot: snapshot,
          profilePrompt,
          customRules: candidateRules || undefined,
          atsBlueprintRules: blueprintRules || undefined,
          locale: "pt-BR",
          resumeRepoNames: resumeReposForGeneration
        },
        (accumulated) => {
          fullGeneratedMarkdown = accumulated;
          setStreamingMarkdown(accumulated);
        }
      );

      const cleanMd = generatedResume.rawMarkdown ?? "";
      let atsSearchText = fullGeneratedMarkdown || cleanMd;
      const atsEvidence = profileAnalysis.blueprint.keywordEvidence.map(
        entry => `${entry.source}: ${entry.keyword} — ${entry.hint}`
      );

      for (let weavePass = 0; weavePass < 2; weavePass++) {
        const missingAfterGeneration = findMissingEvidencedKeywords(
          mandatoryKeywords,
          atsSearchText
        );
        if (missingAfterGeneration.length === 0) break;

        setAts({
          score: profileAnalysis.ats.score,
          matchedKeywords: profileAnalysis.ats.matchedKeywords,
          missingKeywords: profileAnalysis.ats.missingKeywords,
          suggestions: profileAnalysis.ats.suggestions,
          evidence: [
            weavePass === 0
              ? "Ajustando curriculo ao blueprint (weave passagem 1)..."
              : "Ajuste fino ao blueprint (weave passagem 2)..."
          ],
          evidencedKeywords: profileAnalysis.blueprint.evidencedKeywords,
          gapsInResume: missingAfterGeneration,
          unavailableKeywords: profileAnalysis.blueprint.unavailableKeywords,
          blueprint: profileAnalysis.blueprint
        });

        const weaveHints = filterEvidenceByRepos(
          evidenceHintsForKeywords(atsEvidence, missingAfterGeneration),
          resumeReposForGeneration
        );

        atsSearchText = await resumeService.weaveMissingAtsKeywords(
          {
            resumeMarkdown: atsSearchText,
            missingKeywords: missingAfterGeneration,
            profileSnapshot: snapshot,
            profilePrompt,
            customRules: candidateRules || undefined,
            atsBlueprintRules: blueprintRules || undefined,
            resumeRepoNames: resumeReposForGeneration,
            locale: "pt-BR",
            evidenceHints: weaveHints
          },
          accumulated => {
            atsSearchText = accumulated;
            setStreamingMarkdown(accumulated);
          }
        );
        atsSearchText = sanitizeResumeMarkdown(atsSearchText, {
          allowedProjectRepos: resumeReposForGeneration,
          profilePrompt,
          jobSpec
        });
        generatedResume.rawMarkdown = atsSearchText;
        setEditedMarkdown(atsSearchText);
        setStreamingMarkdown(atsSearchText);
      }

      const preQuality = analyzeResumeQuality(atsSearchText, { jobSpec, jobFullText: jobText });
      const credibilityScore =
        preQuality.dimensions.find(d => d.id === "credibility")?.score ?? 100;
      if (preQuality.metricPct < 65 || preQuality.overallScore < 72 || credibilityScore < 65) {
        setAts({
          score: profileAnalysis.ats.score,
          matchedKeywords: profileAnalysis.ats.matchedKeywords,
          missingKeywords: profileAnalysis.ats.missingKeywords,
          suggestions: preQuality.suggestions,
          evidence: [
            credibilityScore < 65
              ? `Credibilidade ${credibilityScore}% — removendo percentuais inventados e polindo bullets...`
              : `Qualidade atual: ${preQuality.overallScore}% — polindo bullets (${preQuality.bulletsWithMetrics}/${preQuality.totalBullets} com metricas)...`
          ],
          evidencedKeywords: profileAnalysis.blueprint.evidencedKeywords,
          gapsInResume: findMissingEvidencedKeywords(mandatoryKeywords, atsSearchText),
          unavailableKeywords: profileAnalysis.blueprint.unavailableKeywords,
          blueprint: profileAnalysis.blueprint
        });

        atsSearchText = await resumeService.polishResumeQuality(
          {
            resumeMarkdown: atsSearchText,
            profileSnapshot: snapshot,
            jobSpec,
            profilePrompt,
            customRules: candidateRules || undefined,
            atsBlueprintRules: blueprintRules || undefined,
            resumeRepoNames: resumeReposForGeneration,
            locale: "pt-BR",
            qualityReport: {
              weakBullets: preQuality.weakBullets,
              metricPct: preQuality.metricPct,
              suggestions: preQuality.suggestions
            }
          },
          accumulated => {
            atsSearchText = accumulated;
            setStreamingMarkdown(accumulated);
          }
        );
        atsSearchText = sanitizeResumeMarkdown(atsSearchText, {
          allowedProjectRepos: resumeReposForGeneration,
          profilePrompt,
          jobSpec
        });
        generatedResume.rawMarkdown = atsSearchText;
        setEditedMarkdown(atsSearchText);
        setStreamingMarkdown(atsSearchText);
      }

      setAts({
        score: profileAnalysis.ats.score,
        matchedKeywords: profileAnalysis.ats.matchedKeywords,
        missingKeywords: profileAnalysis.ats.missingKeywords,
        suggestions: profileAnalysis.ats.suggestions,
        evidence: ["Fase 3/3: IA avaliando curriculo vs blueprint ATS..."],
        evidencedKeywords: profileAnalysis.blueprint.evidencedKeywords,
        gapsInResume: profileAnalysis.ats.gapsInResume,
        unavailableKeywords: profileAnalysis.blueprint.unavailableKeywords,
        blueprint: profileAnalysis.blueprint
      });

      const finalAts = await aiAts.evaluateResumeAgainstBlueprint({
        jobSpec,
        jobFullText: jobText,
        profileSnapshot: snapshot,
        profilePrompt,
        resumeRepoNames: resumeReposForGeneration,
        resumeMarkdown: atsSearchText,
        coverLetterMarkdown: coverLetterMarkdown || undefined,
        blueprint: profileAnalysis.blueprint
      });

      const updatedBlueprint = updateBlueprintFromEvaluation(profileAnalysis.blueprint, finalAts);
      setAtsBlueprint(updatedBlueprint);
      setAts({ ...finalAts, blueprint: updatedBlueprint });

      generatedResume.atsKeywords = unique([
        ...(generatedResume.atsKeywords ?? []),
        ...finalAts.matchedKeywords,
        ...finalAts.evidencedKeywords
      ]).slice(0, 50);

      setResume(generatedResume);
      setResumeSourceMarkdown(atsSearchText);
      setStreamingMarkdown(atsSearchText);
      setEditedMarkdown(atsSearchText);
      await sqliteStorage.saveMetrics(new Date().toISOString(), { ...finalAts, blueprint: updatedBlueprint });
      await sqliteStorage.saveResume(new Date().toISOString(), generatedResume);
    } catch (generationError) {
      setError(generationError instanceof Error ? generationError.message : "Erro ao gerar curriculo.");
    } finally {
      setIsStreaming(false);
    }
  };

  const regenerateWithAts = (): void => {
    if (!ats || !jobText.trim()) return;
    const scoreFloor = ats.score;
    const markdownFloor = editedMarkdown;
    const resumeFloor = resume;
    const atsFloor = ats;
    const blueprintFloor = atsBlueprint ?? ats.blueprint ?? null;
    const svc = new ResumeService();
    const jobSpec = svc.parseJobText(jobText);
    const quality =
      ats.qualityReport ??
      analyzeResumeQuality(editedMarkdown, { jobSpec });
    const metricPct = quality.metricPct;
    const bulletsWithNums = quality.bulletsWithMetrics;
    const totalBullets = Math.max(quality.totalBullets, 1);
    const roleMax = 20;
    const roleActual = Math.round((quality.roleAdherencePct / 100) * roleMax);

    const lines: string[] = [
      `=== REESCRITA CIRURGICA PARA MAXIMIZAR ATS — score atual: ${ats.score}/100 ===`,
      `Meta obrigatoria: ${Math.min(100, ats.score + 20)}+ pontos. Aplique TODAS as regras abaixo sem excecao:`,
      jobSpec.company ? `Empresa: ${jobSpec.company}` : "",
      "",
    ];
    let n = 1;

    if (ats.suggestions.length > 0) {
      lines.push(`${n++}. SUGESTOES ATS IDENTIFICADAS (corrija todas):`);
      for (const suggestion of ats.suggestions) {
        lines.push(`   - ${suggestion}`);
      }
      lines.push("");
    }

    if (metricPct < 65) {
      lines.push(
        `${n++}. METRICAS [impacto maximo no score — PRIORIDADE 1]:`,
        `   Atual: ${metricPct}% (${bulletsWithNums}/${totalBullets} bullets com numeros). Meta: 70%+.`,
        `   Reescreva bullets vagos adicionando numeros REAIS derivados dos dados do perfil (contagem de componentes criados, repos, PRs, tempo economizado estimavel).`,
        `   PROIBIDO inventar percentuais ou volumes sem base nos dados reais fornecidos.`,
        `   Formato: [o que foi feito] com [tecnologia] — resultado em [numero real ou estimavel com base]`,
        "",
      );
    }

    if (roleActual < Math.round(roleMax * 0.65)) {
      const responsibilities = jobSpec.responsibilities.slice(0, 5).join(" | ");
      lines.push(
        `${n++}. ADERENCIA A VAGA [gap de ${roleMax - roleActual} pontos]:`,
        `   Use vocabulario direto das responsabilidades do JD em bullets de experiencia.`,
        responsibilities
          ? `   Responsabilidades-chave da vaga: ${responsibilities}`
          : `   Foco da vaga: ${jobSpec.summary.slice(0, 200)}`,
        "",
      );
    }

    const gapsToFix =
      ats.gapsInResume.length > 0 ? ats.gapsInResume : ats.missingKeywords;

    if (gapsToFix.length > 0) {
      lines.push(
        `${n++}. KEYWORDS COM EVIDENCIA NOS PROJETOS — inclua OBRIGATORIAMENTE em bullets de experiencia/projetos:`,
        `   ${gapsToFix.slice(0, 20).join(", ")}`,
        "",
      );
    }

    const trulyMissing = ats.unavailableKeywords;

    if (trulyMissing.length > 0) {
      lines.push(
        `${n++}. SEM EVIDENCIA NO PERFIL — NAO invente:`,
        `   ${trulyMissing.slice(0, 12).join(", ")}`,
        "",
      );
    }

    if (aiAtsPromptBlock.trim()) {
      lines.push(
        "",
        "=== MAPEAMENTO ATS IA (reaplicar) ===",
        aiAtsPromptBlock.trim()
      );
    }

    if (customRules.trim()) {
      lines.push(
        `${n++}. REGRAS MANUAIS DO CANDIDATO (prioridade maxima — reaplique todas):`,
        customRules.trim(),
        "",
      );
    }

    if (quality.weakBullets.length > 0) {
      lines.push(
        `${n++}. BULLETS FRACOS (reescrever com metricas reais):`,
        ...quality.weakBullets.slice(0, 5).map(b => `   - ${b}`),
        ""
      );
    }

    if (quality.personalizationPct < 70) {
      lines.push(
        `${n++}. PERSONALIZACAO (${quality.personalizationPct}%):`,
        `   Mencione titulo da vaga e empresa no Resumo/Headline.`,
        jobSpec.company ? `   Empresa alvo: ${jobSpec.company}` : "",
        `   Titulo: ${jobSpec.title}`,
        ""
      );
    }

    const structureEv = ats.evidence.find(e => e.includes("Estrutura")) ?? "";
    if (!structureEv.includes("Resumo"))  lines.push(`${n++}. Adicione ## Resumo posicionando explicitamente para esta vaga.`);
    if (!structureEv.includes("Projetos")) lines.push(`${n++}. Adicione ## Projetos destacando 2-3 projetos relevantes para a vaga.`);

    lines.push(
      "",
      `${n}. REGRAS ABSOLUTAS DE INTEGRIDADE:`,
      "   - USE O CURRICULO ATUAL ABAIXO COMO BASE — nao reescreva do zero, apenas edite cirurgicamente",
      "   - Mantenha todas as empresas, datas, cargos e tecnologias reais",
      "   - ZERO invencao de metricas, experiencias ou tecnologias ausentes no perfil",
      "   - Numeros so se derivaveis de dados reais (contagem de componentes, repos, PRs reais)",
      "",
      "=== CURRICULO ATUAL — EDITE ESTE, NAO IGNORE ===",
      editedMarkdown,
      "=== FIM DO CURRICULO ATUAL ==="
    );

    if (regenerateNotes.trim()) {
      lines.push(
        "",
        "=== OBSERVACAO DO CANDIDATO PARA ESTA REFAZER (PRIORIDADE ALTA) ===",
        regenerateNotes.trim()
      );
    }

    const nextBlueprint = blueprintFloor ? updateBlueprintFromEvaluation(blueprintFloor, ats) : null;
    if (nextBlueprint) setAtsBlueprint(nextBlueprint);

    void analyzeAndGenerateResume({
      extraRules: lines.join("\n"),
      regenerate: true,
      baseMarkdown: editedMarkdown,
      blueprintOverride: nextBlueprint ?? undefined
    }).then(() => {
      setTimeout(() => {
        const newAts = useAppStore.getState().ats;
        if (!newAts || newAts.score < scoreFloor) {
          setEditedMarkdown(markdownFloor);
          setStreamingMarkdown(markdownFloor);
          setResume(resumeFloor);
          setAts(atsFloor);
        }
      }, 0);
    });
  };

  const reanalyzeAts = async (): Promise<void> => {
    if (!jobText.trim() || !editedMarkdown || !snapshot) return;
    try {
      const settings = localStateStorage.loadSettings();
      const resolvedDeepseekApiKey = await resolveSecret(
        deepseekApiKey,
        settings.deepseekApiKeyEncrypted,
        passphrase,
        secureStorage
      );
      if (!resolvedDeepseekApiKey) {
        throw new Error("Informe a DeepSeek API Key para reanalisar o ATS.");
      }

      const resumeService = new ResumeService();
      const jobSpec = resumeService.parseJobText(jobText);
      const aiAts = new AiAtsAnalyzer({ apiKey: resolvedDeepseekApiKey });
      const searchText = resumeSourceMarkdown || editedMarkdown;

      const blueprint =
        atsBlueprint ??
        ats?.blueprint ??
        (await aiAts.createAtsBlueprint({
          jobSpec,
          jobFullText: jobText,
          profileSnapshot: snapshot,
          profilePrompt,
          resumeRepoNames: resumeReposForGeneration
        }));

      setAts({
        score: ats?.score ?? 0,
        matchedKeywords: ats?.matchedKeywords ?? [],
        missingKeywords: ats?.missingKeywords ?? [],
        suggestions: ats?.suggestions ?? [],
        evidence: ["Reavaliando curriculo vs blueprint ATS..."],
        evidencedKeywords: ats?.evidencedKeywords ?? [],
        gapsInResume: ats?.gapsInResume ?? [],
        unavailableKeywords: ats?.unavailableKeywords ?? [],
        blueprint
      });

      const result = await aiAts.evaluateResumeAgainstBlueprint({
        jobSpec,
        jobFullText: jobText,
        profileSnapshot: snapshot,
        profilePrompt,
        resumeRepoNames: resumeReposForGeneration,
        resumeMarkdown: searchText,
        coverLetterMarkdown: coverLetterMarkdown || undefined,
        blueprint
      });
      const updatedBlueprint = updateBlueprintFromEvaluation(blueprint, result);
      setAtsBlueprint(updatedBlueprint);
      setAts({ ...result, blueprint: updatedBlueprint });
    } catch (reanalyzeError) {
      setError(reanalyzeError instanceof Error ? reanalyzeError.message : "Erro ao reanalisar ATS.");
    }
  };

  const copyMarkdown = async (): Promise<void> => {
    const content =
      contentTab === "cover-letter"
        ? coverLetterMarkdown
        : editedMarkdown || streamingMarkdown || (resume ? new ResumeService().exportMarkdown(resume) : "");
    if (!content) return;
    await navigator.clipboard.writeText(content);
    setCopiedMd(true);
    setTimeout(() => setCopiedMd(false), 2000);
  };

  const regenerateCoverLetter = async (): Promise<void> => {
    if (!snapshot || !jobText.trim() || !coverLetterMarkdown.trim()) return;
    const previousLetter = coverLetterMarkdown;
    setIsGeneratingCoverLetter(true);
    setError(null);
    setContentTab("cover-letter");
    try {
      const settings = localStateStorage.loadSettings();
      const resolvedDeepseekApiKey = await resolveSecret(
        deepseekApiKey,
        settings.deepseekApiKeyEncrypted,
        passphrase,
        secureStorage
      );
      if (!resolvedDeepseekApiKey) {
        throw new Error("Informe a DeepSeek API Key para refazer a carta de apresentacao.");
      }

      const resumeService = new ResumeService(
        new DeepSeekResumeProvider({ apiKey: resolvedDeepseekApiKey })
      );
      const jobSpec = resumeService.parseJobText(jobText);

      const regenRules = [
        "=== REFAZER CARTA DE APRESENTACAO (EDICAO, NAO DO ZERO) ===",
        "Use a carta atual como base e aplique as correcoes abaixo.",
        "Mantenha tom autentico, entusiasmo pela empresa e conexao com a vaga.",
        coverRegenerateNotes.trim()
          ? `Observacao do candidato:\n${coverRegenerateNotes.trim()}`
          : "",
        "=== CARTA ATUAL ===",
        previousLetter,
        "=== FIM DA CARTA ATUAL ==="
      ].filter(Boolean).join("\n\n");

      const letter = await resumeService.streamCoverLetter(
        {
          jobSpec,
          profileSnapshot: snapshot,
          profilePrompt,
          customRules: regenRules,
          resumeMarkdown: editedMarkdown || streamingMarkdown,
          locale: "pt-BR",
          resumeRepoNames: resumeReposForGeneration
        },
        setCoverLetterMarkdown
      );
      setCoverLetterMarkdown(letter);
    } catch (coverLetterError) {
      setCoverLetterMarkdown(previousLetter);
      setError(
        coverLetterError instanceof Error
          ? coverLetterError.message
          : "Erro ao refazer carta de apresentacao."
      );
    } finally {
      setIsGeneratingCoverLetter(false);
    }
  };

  const generateCoverLetter = async (): Promise<void> => {
    if (!snapshot || !jobText.trim()) return;
    setIsGeneratingCoverLetter(true);
    setError(null);
    setCoverLetterMarkdown("");
    setContentTab("cover-letter");
    try {
      const settings = localStateStorage.loadSettings();
      const resolvedDeepseekApiKey = await resolveSecret(
        deepseekApiKey,
        settings.deepseekApiKeyEncrypted,
        passphrase,
        secureStorage
      );
      if (!resolvedDeepseekApiKey) {
        throw new Error("Informe a DeepSeek API Key para gerar a carta de apresentacao.");
      }

      const resumeService = new ResumeService(
        new DeepSeekResumeProvider({ apiKey: resolvedDeepseekApiKey })
      );
      const jobSpec = resumeService.parseJobText(jobText);
      const letter = await resumeService.streamCoverLetter(
        {
          jobSpec,
          profileSnapshot: snapshot,
          profilePrompt,
          customRules: customRules.trim() || undefined,
          resumeMarkdown: editedMarkdown || streamingMarkdown,
          locale: "pt-BR",
          resumeRepoNames: resumeReposForGeneration
        },
        setCoverLetterMarkdown
      );
      setCoverLetterMarkdown(letter);
    } catch (coverLetterError) {
      setError(
        coverLetterError instanceof Error
          ? coverLetterError.message
          : "Erro ao gerar carta de apresentacao."
      );
    } finally {
      setIsGeneratingCoverLetter(false);
    }
  };

  const exportPdf = async (): Promise<void> => {
    if (!resume) return;
    const service = new ResumeService();
    const markdown = editedMarkdown || resume.rawMarkdown || service.exportMarkdown(resume);
    const now = new Date();
    const jobSpec = service.parseJobText(jobText);
    const docTitle = buildPdfDocumentTitle({
      fullName: resume.fullName,
      jobTitle: jobSpec.title,
      company: jobSpec.company,
      date: now
    });
    const filename = `${docTitle}.pdf`;
    const pdfKeywords = unique([
      ...(ats?.matchedKeywords ?? []),
      ...jobSpec.requiredSkills,
      ...jobSpec.keywords
    ]).slice(0, 40).join(", ");
    downloadBlob(
      filename,
      await service.exportMarkdownPdf(markdown, {
        title: docTitle,
        author: resume.fullName,
        creator: resume.fullName,
        keywords: pdfKeywords,
        description: resume.summary.slice(0, 300)
      })
    );
  };

  const exportCoverLetterPdf = async (): Promise<void> => {
    if (!coverLetterMarkdown.trim() || !resume) return;
    const service = new ResumeService();
    const now = new Date();
    const jobSpec = service.parseJobText(jobText);
    const docTitle = buildPdfDocumentTitle({
      fullName: resume.fullName,
      jobTitle: jobSpec.title,
      company: jobSpec.company,
      suffix: "Carta de Apresentacao",
      date: now
    });
    downloadBlob(
      `${docTitle}.pdf`,
      await service.exportMarkdownPdf(coverLetterMarkdown, {
        title: docTitle,
        author: resume.fullName,
        creator: resume.fullName,
        description: coverLetterMarkdown.slice(0, 300)
      })
    );
  };

  const isLoggedIn = githubToken.trim().length > 0;

  const LANG_COLORS: Record<string, string> = {
    TypeScript: "#3178c6", JavaScript: "#f1e05a", Python: "#3572a5",
    CSS: "#563d7c", HTML: "#e34c26", Rust: "#dea584", Go: "#00add8",
    Java: "#b07219", "C++": "#f34b7d", "C#": "#178600", Vue: "#41b883",
    Shell: "#89e051", Ruby: "#701516", Swift: "#f05138", Kotlin: "#a97bff",
    Dart: "#00b4ab", PHP: "#4f5d95", Scala: "#c22d40"
  };

  const topLangs = metrics?.topLanguages.slice(0, 5) ?? [];
  const topRepos = snapshot?.repos
    .slice()
    .sort((a, b) => {
      const aTime = new Date(a.pushedAt ?? a.updatedAt).getTime();
      const bTime = new Date(b.pushedAt ?? b.updatedAt).getTime();
      return bTime - aTime;
    }) ?? [];

  const selectedRepoProfile =
    snapshot && selectedRepo ? buildRepoProfile(snapshot, selectedRepo) : null;

  const sidebar = (
    <div className="space-y-4">
      {/* On mobile: avatar + name side by side. On desktop: avatar full-width stacked */}
      <div className="flex items-center gap-4 lg:block lg:space-y-4">
        {snapshot?.user?.avatarUrl ? (
          <img
            src={snapshot.user.avatarUrl}
            alt={snapshot.user.login}
            className="h-16 w-16 shrink-0 rounded-full border border-[var(--gc-border)] sm:h-20 sm:w-20 lg:h-auto lg:w-full"
          />
        ) : (
          <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-[var(--gc-canvas-subtle)] text-2xl font-bold text-[var(--gc-text)] sm:h-20 sm:w-20 lg:aspect-square lg:h-auto lg:w-full lg:text-4xl">
            {(snapshot?.user?.login ?? "?").slice(0, 2).toUpperCase()}
          </div>
        )}

        {snapshot?.user ? (
          <div className="min-w-0 flex-1 lg:hidden">
            {snapshot.user.name ? (
              <h1 className="truncate text-base font-semibold text-[var(--gc-text)]">{snapshot.user.name}</h1>
            ) : null}
            <p className="truncate text-sm font-light text-[var(--gc-text-muted)]">{snapshot.user.login}</p>
          </div>
        ) : null}
      </div>

      {snapshot?.user ? (
        <>
          <div className="hidden lg:block">
            {snapshot.user.name ? (
              <h1 className="text-xl font-semibold text-[var(--gc-text)]">{snapshot.user.name}</h1>
            ) : null}
            <p className="text-xl font-light text-[var(--gc-text-muted)]">{snapshot.user.login}</p>
            {snapshot.user.bio ? (
              <p className="mt-2 text-sm text-[var(--gc-text)]">{snapshot.user.bio}</p>
            ) : null}
          </div>
          <div className="lg:hidden">
            {snapshot.user.bio ? (
              <p className="text-sm text-[var(--gc-text)]">{snapshot.user.bio}</p>
            ) : null}
          </div>

          <div className="space-y-1 text-sm text-[var(--gc-text)]">
            {snapshot.user.location ? (
              <div className="flex items-center gap-2">
                <MapPin size={14} className="text-[var(--gc-text-muted)]" />
                <span>{snapshot.user.location}</span>
              </div>
            ) : null}
            {snapshot.user.email ? (
              <div className="flex items-center gap-2">
                <Mail size={14} className="text-[var(--gc-text-muted)]" />
                <span>{snapshot.user.email}</span>
              </div>
            ) : null}
            <div className="flex items-center gap-2">
              <Users size={14} className="text-[var(--gc-text-muted)]" />
              <span>
                <strong>{snapshot.user.followers}</strong>{" "}
                <span className="text-[var(--gc-text-muted)]">seguidores</span>
                {" · "}
                <strong>{snapshot.user.following}</strong>{" "}
                <span className="text-[var(--gc-text-muted)]">seguindo</span>
              </span>
            </div>
            <div className="flex items-center gap-2">
              <BookMarked size={14} className="text-[var(--gc-text-muted)]" />
              <strong>{snapshot.user.publicRepos}</strong>{" "}
              <span className="text-[var(--gc-text-muted)]">repositorios publicos</span>
            </div>
          </div>
          <hr className="border-[var(--gc-border)]" />
        </>
      ) : null}

      {/* Credentials */}
      <div>
        <button
          type="button"
          onClick={() => setShowSecrets(!showSecrets)}
          className="flex w-full items-center justify-between text-sm font-semibold text-[var(--gc-text)]"
        >
          <span className="flex items-center gap-1.5">
            <Lock size={13} />
            Credenciais
          </span>
          {showSecrets ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        </button>

        {showSecrets ? (
          <div className="mt-3 space-y-2">
            <div>
              <label className="mb-1 block text-xs text-[var(--gc-text-muted)]">DeepSeek API Key</label>
              <Input type="password" autoComplete="off" value={deepseekApiKey} onChange={(e) => setDeepseekApiKey(e.target.value)} placeholder="sk-..." />
            </div>
            <div>
              <label className="mb-1 block text-xs text-[var(--gc-text-muted)]">Passphrase local</label>
              <Input type="password" autoComplete="off" value={passphrase} onChange={(e) => setPassphrase(e.target.value)} placeholder="Para criptografia local" />
            </div>
            <div>
              <label className="mb-1 block text-xs text-[var(--gc-text-muted)]">Token GitHub</label>
              <Input type="password" autoComplete="off" value={githubToken} onChange={(e) => setGithubToken(e.target.value)} placeholder="Preenchido pelo login" />
            </div>
            <div className="flex flex-wrap gap-2 pt-1">
              <Button variant="secondary" size="sm" onClick={() => void persistSecrets()} disabled={loading}>Salvar criptografado</Button>
              <Button variant="secondary" size="sm" onClick={clearLocalSecrets} disabled={loading}>Limpar tudo</Button>
            </div>
          </div>
        ) : null}
      </div>

      <hr className="border-[var(--gc-border)]" />

      {/* Sync */}
      <div className="space-y-2">
        <p className="text-xs text-[var(--gc-text-muted)]">
          {lastSyncAt
            ? <>Atualizado em <strong className="text-[var(--gc-text)]">{new Date(lastSyncAt).toLocaleString("pt-BR")}</strong></>
            : "Nenhuma sincronizacao ainda"}
        </p>
        {!isLoggedIn ? (
          <Button className="w-full" size="sm" onClick={() => void loginWithGitHub()} disabled={loading}>
            Entrar com GitHub
          </Button>
        ) : (
          <div className="space-y-2">
            <Button variant="secondary" className="w-full" size="sm" onClick={() => void syncGitHubDataWithToken()} disabled={loading}>
              <RefreshCw size={13} className={loading ? "animate-spin" : ""} />
              {loading ? "Atualizando..." : lastSyncAt ? "Buscar novidades" : "Sincronizar agora"}
            </Button>
            <Button
              variant="secondary"
              className="w-full"
              size="sm"
              onClick={() => void syncGitHubDataWithToken(undefined, { forceFull: true })}
              disabled={loading}
            >
              Sincronizacao completa (24 meses)
            </Button>
            <p className="text-[10px] text-[var(--gc-text-subtle)]">
              {deepseekApiKey.trim()
                ? "DeepSeek ativa: cada repo sera analisado por IA com todos commits e PRs."
                : "Configure a chave DeepSeek acima para analise completa por IA durante o sync."}
            </p>
          </div>
        )}
        {syncStatus.stage === "running" ? (
          <SyncProgressPanel progress={syncStatus.progress} />
        ) : null}
        {statusMessage ? <p className="text-xs text-[var(--gc-text-muted)]">{statusMessage}</p> : null}
        {error ? <p className="text-xs text-[var(--gc-danger)]">{error}</p> : null}
      </div>
    </div>
  );

  const tabLabels: Record<string, string> = { overview: "Visao geral", curriculo: "Gerar Curriculo" };

  const main = (
    <div>
      {/* Tab nav — GitHub underline style */}
      <div className="border-b border-[var(--gc-border)]">
        <nav className="-mb-px flex">
          {Object.entries(tabLabels).map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setView(key)}
              className={[
                "flex items-center gap-1.5 border-b-2 px-4 py-3 text-sm transition-colors",
                view === key
                  ? "border-[#fd8c73] font-semibold text-[var(--gc-text)]"
                  : "border-transparent text-[var(--gc-text-muted)] hover:border-[var(--gc-border)] hover:text-[var(--gc-text)]"
              ].join(" ")}
            >
              {label}
              {key === "overview" && snapshot ? (
                <span className="rounded-full bg-[var(--gc-border-muted)] px-2 py-0.5 text-xs font-semibold text-[var(--gc-text-muted)]">
                  {snapshot.repos.length}
                </span>
              ) : null}
            </button>
          ))}
        </nav>
      </div>

      <div className="mt-6">
        {view === "curriculo" ? (
          /* ── Gerar Curriculo tab ── */
          <div className="space-y-4">
            <div>
              <label className="mb-1 block text-sm font-semibold text-[var(--gc-text)]">Contexto sobre voce</label>
              <Textarea
                value={profilePrompt}
                onChange={(e) => setProfilePrompt(e.target.value)}
                placeholder="Senior Frontend, foco em performance, arquitetura de design systems, lideranca tecnica..."
                className="min-h-[80px]"
                disabled={isStreaming}
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-semibold text-[var(--gc-text)]">Texto da vaga</label>
              <Textarea
                value={jobText}
                onChange={(e) => setJobText(e.target.value)}
                placeholder="Cole a descricao completa da vaga aqui..."
                className="min-h-[140px]"
                disabled={isStreaming}
              />
            </div>
            {snapshot ? (
              <div className="rounded-md border border-[var(--gc-border)] bg-[var(--gc-canvas-subtle)] px-3 py-2.5">
                <p className="text-xs font-semibold text-[var(--gc-text)]">Projetos no curriculo</p>
                <p className="mt-1 text-xs text-[var(--gc-text-muted)]">
                  {resumeRepoNames.length > 0
                    ? `${resumeRepoNames.length} repo(s) selecionado(s) na Visao geral: ${resumeRepoNames.join(", ")}`
                    : `Nenhum repo selecionado — secao Projetos usara todos os ${snapshot.repos.length} repos sincronizados`}
                </p>
                <p className="mt-1 text-[10px] text-[var(--gc-text-subtle)]">
                  Stack e keywords ATS sao buscadas em todos os repositorios. Marque ate 3 repos na aba Visao geral para controlar o que aparece em Projetos.
                </p>
                {resumeRepoNames.length > 0 ? (
                  <button
                    type="button"
                    onClick={() => setResumeRepoNames([])}
                    className="mt-2 text-[10px] text-[var(--gc-accent)] hover:underline"
                  >
                    Limpar selecao (usar todos)
                  </button>
                ) : null}
              </div>
            ) : null}
            <div>
              <label className="mb-1 block text-sm font-semibold text-[var(--gc-text)]">
                Regras e ajustes
                <span className="ml-2 text-xs font-normal text-[var(--gc-text-muted)]">opcional — instrucoes especificas para o modelo</span>
              </label>
              <Textarea
                value={customRules}
                onChange={(e) => setCustomRules(e.target.value)}
                placeholder={"Exemplos:\n- Foque apenas em Front-End, nao mencione Back-End\n- Destaque mais o projeto gymrats\n- Resumo deve ter no maximo 3 linhas\n- Nao mencione a experiencia na Tegma\n- Mencione React 18 e Next.js 14 explicitamente"}
                className="min-h-[90px] font-mono text-xs"
                disabled={isStreaming}
              />
            </div>
            <Button
              onClick={() => void analyzeAndGenerateResume()}
              disabled={isStreaming || !snapshot}
              className="w-full"
            >
              {isStreaming ? (
                <span className="flex items-center gap-2">
                  <span className="h-3 w-3 animate-spin rounded-full border-2 border-white border-t-transparent" />
                  Gerando curriculo...
                </span>
              ) : "Gerar Curriculo ATS"}
            </Button>

            {(editedMarkdown || streamingMarkdown) && !isStreaming ? (
              <Button
                onClick={() => void generateCoverLetter()}
                disabled={isStreaming || isGeneratingCoverLetter || !snapshot}
                variant="secondary"
                className="w-full"
              >
                {isGeneratingCoverLetter ? (
                  <span className="flex items-center gap-2">
                    <span className="h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent" />
                    Gerando carta de apresentacao...
                  </span>
                ) : "Gerar Carta de Apresentacao"}
              </Button>
            ) : null}

            {coverLetterMarkdown && !isGeneratingCoverLetter ? (
              <div className="rounded-md border border-[var(--gc-border)] bg-[var(--gc-surface)] p-3 space-y-2">
                <p className="text-xs font-semibold text-[var(--gc-text)]">Refazer carta de apresentacao</p>
                <Textarea
                  value={coverRegenerateNotes}
                  onChange={(e) => setCoverRegenerateNotes(e.target.value)}
                  placeholder="Ex: enfatize entusiasmo pela cultura GX2 e minha paixao por fintech..."
                  className="min-h-[70px] text-xs"
                  disabled={loading || isGeneratingCoverLetter}
                />
                <Button
                  variant="secondary"
                  size="sm"
                  className="w-full"
                  onClick={() => void regenerateCoverLetter()}
                  disabled={loading || isGeneratingCoverLetter}
                >
                  <RefreshCw size={12} className="mr-1.5" />
                  Refazer carta com observacao
                </Button>
              </div>
            ) : null}

            {/* ATS analysis — updates live during streaming, final pass when complete */}
            {ats ? (
              <div className="rounded-md border border-[var(--gc-border)] bg-[var(--gc-surface)] p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="flex items-center gap-2 text-sm font-semibold text-[var(--gc-text)]">
                    Analise ATS
                    {isStreaming ? (
                      <span className="flex items-center gap-1 text-[10px] font-normal text-[var(--gc-accent)]">
                        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[var(--gc-accent)]" />
                        atualizando...
                      </span>
                    ) : null}
                  </h3>
                  <span className={[
                    "rounded-full px-3 py-0.5 text-sm font-bold",
                    ats.score >= 70 ? "bg-[var(--gc-badge-success-bg)] text-[var(--gc-badge-success-text)]"
                      : ats.score >= 40 ? "bg-[var(--gc-badge-warning-bg)] text-[var(--gc-badge-warning-text)]"
                      : "bg-[var(--gc-badge-danger-bg)] text-[var(--gc-badge-danger-text)]"
                  ].join(" ")}>
                    Score: {ats.score}/100
                  </span>
                </div>
                {ats.keywordScore != null || ats.qualityScore != null ? (
                  <div className="flex flex-wrap gap-2 text-xs text-[var(--gc-text-muted)]">
                    {ats.keywordScore != null ? (
                      <span className="rounded-md bg-[var(--gc-canvas-subtle)] px-2 py-1">
                        Keywords: {ats.keywordScore}%
                      </span>
                    ) : null}
                    {ats.qualityScore != null ? (
                      <span className="rounded-md bg-[var(--gc-canvas-subtle)] px-2 py-1">
                        Qualidade: {ats.qualityScore}%
                      </span>
                    ) : null}
                    {ats.qualityReport ? (
                      <span className="rounded-md bg-[var(--gc-canvas-subtle)] px-2 py-1">
                        Metricas: {ats.qualityReport.bulletsWithMetrics}/{ats.qualityReport.totalBullets} bullets ({ats.qualityReport.metricPct}%)
                      </span>
                    ) : null}
                  </div>
                ) : null}
                {ats.qualityReport?.dimensions?.length ? (
                  <div className="space-y-2">
                    <p className="text-xs font-medium text-[var(--gc-text-muted)]">Qualidade profissional</p>
                    <div className="grid gap-2 sm:grid-cols-2">
                      {ats.qualityReport.dimensions.map(dim => (
                        <div
                          key={dim.id}
                          className="rounded-md border border-[var(--gc-border)] bg-[var(--gc-canvas-subtle)] px-3 py-2"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-xs font-medium text-[var(--gc-text)]">{dim.label}</span>
                            <span className={[
                              "text-xs font-bold",
                              dim.status === "ok"
                                ? "text-[var(--gc-badge-success-text)]"
                                : dim.status === "warning"
                                  ? "text-[var(--gc-badge-warning-text)]"
                                  : "text-[var(--gc-badge-danger-text)]"
                            ].join(" ")}>
                              {dim.score}%
                            </span>
                          </div>
                          {dim.issues.length > 0 ? (
                            <ul className="mt-1 space-y-0.5 text-[11px] text-[var(--gc-text-muted)]">
                              {dim.issues.slice(0, 2).map(issue => (
                                <li key={issue}>• {issue}</li>
                              ))}
                            </ul>
                          ) : null}
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}
                {ats.matchedKeywords.length > 0 ? (
                  <div>
                    <p className="mb-1 text-xs text-[var(--gc-text-muted)]">Keywords atendidas</p>
                    <div className="flex flex-wrap gap-1">
                      {ats.matchedKeywords.slice(0, 12).map((kw) => (
                        <span key={kw} className="rounded-full bg-[var(--gc-badge-success-bg)] px-2 py-0.5 text-xs text-[var(--gc-badge-success-text)]">{kw}</span>
                      ))}
                    </div>
                  </div>
                ) : null}
                {ats.missingKeywords.length > 0 ? (
                  <div>
                    <p className="mb-1 text-xs text-[var(--gc-text-muted)]">
                      {ats.gapsInResume.length > 0
                        ? "Faltam no curriculo (voce tem nos projetos)"
                        : "Lacunas identificadas"}
                    </p>
                    <div className="flex flex-wrap gap-1">
                      {(ats.gapsInResume.length > 0 ? ats.gapsInResume : ats.missingKeywords).slice(0, 10).map((kw) => (
                        <span
                          key={kw}
                          className={`rounded-full px-2 py-0.5 text-xs ${
                            ats.gapsInResume.includes(kw)
                              ? "bg-[var(--gc-badge-warning-bg)] text-[var(--gc-badge-warning-text)]"
                              : "bg-[var(--gc-badge-danger-bg)] text-[var(--gc-badge-danger-text)]"
                          }`}
                        >
                          {kw}
                        </span>
                      ))}
                    </div>
                  </div>
                ) : null}
                {ats.unavailableKeywords.length > 0 ? (
                  <div>
                    <p className="mb-1 text-xs text-[var(--gc-text-muted)]">Sem evidencia no perfil (nao inventar)</p>
                    <div className="flex flex-wrap gap-1">
                      {ats.unavailableKeywords.slice(0, 8).map((kw) => (
                        <span key={kw} className="rounded-full bg-[var(--gc-canvas-subtle)] px-2 py-0.5 text-xs text-[var(--gc-text-muted)]">
                          {kw}
                        </span>
                      ))}
                    </div>
                  </div>
                ) : null}
                {ats.evidencedKeywords.length > 0 ? (
                  <div>
                    <p className="mb-1 text-xs text-[var(--gc-text-muted)]">Com evidencia nos projetos</p>
                    <div className="flex flex-wrap gap-1">
                      {ats.evidencedKeywords.slice(0, 12).map((kw) => (
                        <span key={kw} className="rounded-full bg-[var(--gc-badge-success-bg)] px-2 py-0.5 text-xs text-[var(--gc-badge-success-text)]">
                          {kw}
                        </span>
                      ))}
                    </div>
                  </div>
                ) : null}
                {ats.suggestions.length > 0 ? (
                  <div>
                    <p className="mb-1 text-xs text-[var(--gc-text-muted)]">Sugestoes</p>
                    <ul className="space-y-1">
                      {ats.suggestions.map((s) => (
                        <li key={s} className="text-xs text-[var(--gc-text)]">· {s}</li>
                      ))}
                    </ul>
                  </div>
                ) : null}
                {ats.evidence.length > 0 ? (
                  <div className="rounded bg-[var(--gc-canvas-subtle)] px-3 py-2">
                    <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-[var(--gc-text-muted)]">Evidencias</p>
                    <ul className="space-y-0.5">
                      {ats.evidence.map((e) => (
                        <li key={e} className="text-[11px] text-[var(--gc-text-muted)]">• {e}</li>
                      ))}
                    </ul>
                  </div>
                ) : null}
                {!isStreaming && ats.score < 100 ? (
                  <div className="border-t border-[var(--gc-border)] pt-3 space-y-2">
                    <div>
                      <label className="mb-1 block text-xs font-medium text-[var(--gc-text)]">
                        Observacao para refazer curriculo
                        <span className="ml-1 font-normal text-[var(--gc-text-muted)]">opcional</span>
                      </label>
                      <Textarea
                        value={regenerateNotes}
                        onChange={(e) => setRegenerateNotes(e.target.value)}
                        placeholder="Ex: inclua shadcn e figma nos bullets da Room Company; nao mencione projetos privados..."
                        className="min-h-[70px] text-xs"
                        disabled={loading}
                      />
                    </div>
                    <button
                      onClick={regenerateWithAts}
                      disabled={loading}
                      className="flex items-center gap-1.5 rounded-md border border-[var(--gc-border)] bg-[var(--gc-canvas-subtle)] px-3 py-1.5 text-xs font-medium text-[var(--gc-text)] transition-colors hover:bg-[var(--gc-btn-default-hover)] disabled:opacity-40"
                    >
                      <RefreshCw size={12} />
                      Refazer curriculo corrigindo lacunas ATS
                    </button>
                    <p className="text-[10px] text-[var(--gc-text-subtle)]">
                      {ats.missingKeywords.length > 0
                        ? `Prioriza ${ats.missingKeywords.length} palavras-chave ausentes + sua observacao acima`
                        : "Melhora cobertura ATS usando sua observacao acima"}
                    </p>
                  </div>
                ) : null}
              </div>
            ) : null}

            {/* Streaming / final preview panel */}
            {(streamingMarkdown || editedMarkdown || coverLetterMarkdown) ? (() => {
              const resumeContent = editedMarkdown || streamingMarkdown;
              const displayContent = contentTab === "cover-letter" ? coverLetterMarkdown : resumeContent;
              const estimatedPages = Math.max(1, Math.ceil(
                displayContent.split("\n").filter(l => l.trim()).length / 52
              ));
              return (
                <div className="rounded-md border border-[var(--gc-border)] bg-[var(--gc-surface)]">
                  <div className="flex items-center gap-2 border-b border-[var(--gc-border)] px-3 py-2">
                    {isStreaming || isGeneratingCoverLetter ? (
                      <span className="flex items-center gap-1.5 text-xs text-[var(--gc-accent)]">
                        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[var(--gc-accent)]" />
                        Gerando...
                      </span>
                    ) : (
                      <>
                        <div className="flex overflow-hidden rounded border border-[var(--gc-border)] text-xs">
                          <button
                            onClick={() => setContentTab("resume")}
                            className={["px-2.5 py-1 transition-colors", contentTab === "resume" ? "bg-[var(--gc-btn-default-hover)] font-semibold text-[var(--gc-text)]" : "text-[var(--gc-text-muted)] hover:text-[var(--gc-text)]"].join(" ")}
                          >
                            Curriculo
                          </button>
                          <button
                            onClick={() => setContentTab("cover-letter")}
                            disabled={!coverLetterMarkdown}
                            className={["border-l border-[var(--gc-border)] px-2.5 py-1 transition-colors disabled:opacity-40", contentTab === "cover-letter" ? "bg-[var(--gc-btn-default-hover)] font-semibold text-[var(--gc-text)]" : "text-[var(--gc-text-muted)] hover:text-[var(--gc-text)]"].join(" ")}
                          >
                            Carta
                          </button>
                        </div>
                        {contentTab === "resume" ? (
                          <div className="flex overflow-hidden rounded border border-[var(--gc-border)] text-xs">
                            <button
                              onClick={() => setPreviewMode("raw")}
                              className={["flex items-center gap-1 px-2.5 py-1 transition-colors", previewMode === "raw" ? "bg-[var(--gc-btn-default-hover)] font-semibold text-[var(--gc-text)]" : "text-[var(--gc-text-muted)] hover:text-[var(--gc-text)]"].join(" ")}
                            >
                              <FileText size={11} /> Markdown
                            </button>
                            <button
                              onClick={() => setPreviewMode("preview")}
                              className={["flex items-center gap-1 border-l border-[var(--gc-border)] px-2.5 py-1 transition-colors", previewMode === "preview" ? "bg-[var(--gc-btn-default-hover)] font-semibold text-[var(--gc-text)]" : "text-[var(--gc-text-muted)] hover:text-[var(--gc-text)]"].join(" ")}
                            >
                              <Eye size={11} /> Preview
                            </button>
                          </div>
                        ) : null}
                        <span className="text-[11px] text-[var(--gc-text-subtle)]">
                          ~{estimatedPages} {estimatedPages === 1 ? "pagina" : "paginas"}
                        </span>
                        <div className="ml-auto flex items-center gap-3">
                          {contentTab === "resume" && editedMarkdown !== streamingMarkdown ? (
                            <button
                              onClick={() => void reanalyzeAts()}
                              className="flex items-center gap-1 text-xs text-[var(--gc-attention)] hover:underline"
                              title="Re-analisar keywords ATS com o texto editado"
                            >
                              <RefreshCw size={11} />
                              Re-analisar ATS
                            </button>
                          ) : null}
                          <button
                            onClick={() => void copyMarkdown()}
                            className="flex items-center gap-1 text-xs text-[var(--gc-accent)] hover:underline"
                          >
                            {copiedMd ? <Check size={12} /> : <Clipboard size={12} />}
                            {copiedMd ? "Copiado!" : "Copiar MD"}
                          </button>
                          {contentTab === "resume" ? (
                            <button
                              onClick={() => void exportPdf()}
                              disabled={!resume}
                              className="flex items-center gap-1 text-xs text-[var(--gc-accent)] hover:underline disabled:opacity-40"
                            >
                              Baixar PDF
                            </button>
                          ) : (
                            <button
                              onClick={() => void exportCoverLetterPdf()}
                              disabled={!coverLetterMarkdown.trim()}
                              className="flex items-center gap-1 text-xs text-[var(--gc-accent)] hover:underline disabled:opacity-40"
                            >
                              Baixar PDF
                            </button>
                          )}
                        </div>
                      </>
                    )}
                  </div>
                  <div className="max-h-[680px] overflow-y-auto">
                    {isStreaming ? (
                      <pre className="whitespace-pre-wrap px-4 py-4 font-mono text-xs leading-relaxed text-[var(--gc-text)]">
                        {streamingMarkdown}
                        <span className="animate-pulse">▋</span>
                      </pre>
                    ) : isGeneratingCoverLetter ? (
                      <pre className="whitespace-pre-wrap px-4 py-4 font-mono text-xs leading-relaxed text-[var(--gc-text)]">
                        {coverLetterMarkdown}
                        <span className="animate-pulse">▋</span>
                      </pre>
                    ) : contentTab === "cover-letter" ? (
                      previewMode === "preview" ? (
                        <MarkdownPreview content={coverLetterMarkdown} />
                      ) : (
                        <textarea
                          value={coverLetterMarkdown}
                          onChange={(e) => setCoverLetterMarkdown(e.target.value)}
                          spellCheck={false}
                          className="w-full resize-none bg-transparent px-4 py-4 font-mono text-xs leading-relaxed text-[var(--gc-text)] outline-none"
                          style={{ minHeight: "420px" }}
                        />
                      )
                    ) : previewMode === "preview" ? (
                      <MarkdownPreview content={editedMarkdown} />
                    ) : (
                      <textarea
                        value={editedMarkdown}
                        onChange={(e) => setEditedMarkdown(e.target.value)}
                        spellCheck={false}
                        className="w-full resize-none bg-transparent px-4 py-4 font-mono text-xs leading-relaxed text-[var(--gc-text)] outline-none"
                        style={{ minHeight: "420px" }}
                      />
                    )}
                  </div>
                </div>
              );
            })() : null}
          </div>
        ) : (
          /* ── Overview tab ── */
          <div className="space-y-6">
            {/* Activity summary */}
            {metrics ? (
              <div className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-md border border-[var(--gc-border)] bg-[var(--gc-surface)] px-4 py-3 text-sm">
                <span className="flex items-center gap-1.5 text-[var(--gc-text-muted)]">
                  <GitBranch size={14} />
                  <strong className="text-[var(--gc-text)]">{metrics.totalCommits}</strong> commits
                </span>
                <span className="flex items-center gap-1.5 text-[var(--gc-text-muted)]">
                  <GitPullRequest size={14} />
                  <strong className="text-[var(--gc-text)]">{metrics.totalPullRequests}</strong> PRs
                  <span className="hidden text-xs sm:inline">({metrics.mergedPullRequests} merged)</span>
                </span>
                <span className="flex items-center gap-1.5 text-[var(--gc-text-muted)]">
                  <GitMerge size={14} />
                  <strong className="text-[var(--gc-text)]">{metrics.activeRepos}</strong> repos ativos
                </span>
                <span className="ml-auto text-xs text-[var(--gc-text-muted)]">
                  <span className="hidden sm:inline">ultimos </span>{metrics.windowMonths}m
                </span>
              </div>
            ) : null}

            {/* Language bar */}
            {topLangs.length > 0 ? (
              <div>
                <h2 className="mb-3 text-sm font-semibold text-[var(--gc-text)]">Linguagens</h2>
                <div className="mb-2 flex h-2 w-full overflow-hidden rounded-full">
                  {topLangs.map((lang) => (
                    <div
                      key={lang.language}
                      style={{ width: `${(lang.share * 100).toFixed(1)}%`, backgroundColor: LANG_COLORS[lang.language] ?? "#8b949e" }}
                    />
                  ))}
                </div>
                <div className="flex flex-wrap gap-x-4 gap-y-1">
                  {topLangs.map((lang) => (
                    <span key={lang.language} className="flex items-center gap-1 text-xs text-[var(--gc-text)]">
                      <span className="inline-block h-3 w-3 rounded-full" style={{ backgroundColor: LANG_COLORS[lang.language] ?? "#8b949e" }} />
                      {lang.language}
                      <span className="text-[var(--gc-text-muted)]">{(lang.share * 100).toFixed(1)}%</span>
                    </span>
                  ))}
                </div>
              </div>
            ) : null}

            {/* Repo cards */}
            {topRepos.length > 0 ? (
              <div className="space-y-4">
                {selectedRepoProfile ? (
                  <RepoDetailPanel
                    profile={selectedRepoProfile}
                    onClose={() => void setSelectedRepo(null)}
                  />
                ) : null}

                <div>
                  <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                    <h2 className="text-sm font-semibold text-[var(--gc-text)]">
                      Repositorios ({topRepos.length})
                    </h2>
                    <div className="text-right text-xs text-[var(--gc-text-muted)]">
                      <p>Clique para ver commits, PRs e stack</p>
                      <p>
                        {resumeRepoNames.length > 0
                          ? `${resumeRepoNames.length} marcado(s) para o curriculo`
                          : "Marque os projetos que entram na secao Projetos"}
                      </p>
                    </div>
                  </div>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    {topRepos.map((repo) => {
                      const repoCommits = snapshot?.commits.filter(c => c.repoName === repo.name).length ?? 0;
                      const repoPrs = snapshot?.pullRequests.filter(pr => pr.repoName === repo.name).length ?? 0;
                      const isSelected = selectedRepo === repo.name;
                      const inResume = resumeRepoNames.includes(repo.name);
                      return (
                        <div
                          key={repo.id}
                          className={[
                            "flex flex-col gap-2 rounded-md border p-4 transition-colors",
                            isSelected
                              ? "border-[var(--gc-accent)] bg-[var(--gc-canvas-subtle)]"
                              : "border-[var(--gc-border)] bg-[var(--gc-surface)] hover:border-[var(--gc-accent)]"
                          ].join(" ")}
                        >
                          <button
                            type="button"
                            onClick={() => void setSelectedRepo(isSelected ? null : repo.name)}
                            className="flex flex-col gap-2 text-left"
                          >
                            <div className="flex items-start justify-between gap-2">
                              <span className="text-sm font-semibold text-[var(--gc-accent)] break-all">{repo.name}</span>
                              <span className="shrink-0 rounded-full border border-[var(--gc-border)] px-2 py-0.5 text-[10px] text-[var(--gc-text-muted)]">
                                {repo.private ? "Private" : "Public"}
                              </span>
                            </div>
                            {repo.description ? (
                              <p className="text-xs text-[var(--gc-text-muted)] line-clamp-2">{repo.description}</p>
                            ) : null}
                            <div className="mt-auto flex flex-wrap items-center gap-3 text-xs text-[var(--gc-text-muted)]">
                              {repo.language ? (
                                <span className="flex items-center gap-1">
                                  <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: LANG_COLORS[repo.language] ?? "#8b949e" }} />
                                  {repo.language}
                                </span>
                              ) : null}
                              <span className="flex items-center gap-1"><GitBranch size={11} />{repoCommits}</span>
                              <span className="flex items-center gap-1"><GitPullRequest size={11} />{repoPrs}</span>
                              {repo.stargazersCount > 0 ? (
                                <span className="flex items-center gap-1"><Star size={11} />{repo.stargazersCount}</span>
                              ) : null}
                            </div>
                          </button>
                          <label
                            className="flex cursor-pointer items-center gap-2 border-t border-[var(--gc-border)] pt-2 text-xs text-[var(--gc-text)]"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <input
                              type="checkbox"
                              checked={inResume}
                              onChange={(e) => toggleResumeRepo(repo.name, e.target.checked)}
                              className="rounded border-[var(--gc-border)]"
                            />
                            <span>Incluir no curriculo (secao Projetos)</span>
                          </label>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            ) : (
              !snapshot ? (
                <div className="rounded-md border border-dashed border-[var(--gc-border)] px-8 py-12 text-center">
                  <p className="text-sm text-[var(--gc-text-muted)]">
                    {isLoggedIn ? "Clique em Buscar novidades para carregar seu perfil GitHub." : "Faca login com GitHub para comecar."}
                  </p>
                  {!isLoggedIn ? (
                    <Button className="mt-4" onClick={() => void loginWithGitHub()} disabled={loading}>
                      Entrar com GitHub
                    </Button>
                  ) : null}
                </div>
              ) : null
            )}

            {/* Actions summary */}
            {snapshot?.actions && snapshot.actions.totalRuns > 0 ? (
              <div>
                <h2 className="mb-3 text-sm font-semibold text-[var(--gc-text)]">GitHub Actions</h2>
                <div className="flex flex-wrap gap-x-4 gap-y-2 rounded-md border border-[var(--gc-border)] bg-[var(--gc-surface)] px-4 py-3 text-xs">
                  <span><strong className="text-[var(--gc-text)]">{snapshot.actions.totalRuns}</strong> <span className="text-[var(--gc-text-muted)]">runs</span></span>
                  <span><strong className="text-[var(--gc-success)]">{snapshot.actions.successRuns}</strong> <span className="text-[var(--gc-text-muted)]">success</span></span>
                  <span><strong className="text-[var(--gc-danger)]">{snapshot.actions.failedRuns}</strong> <span className="text-[var(--gc-text-muted)]">failed</span></span>
                  <span><strong className="text-[var(--gc-text-muted)]">{snapshot.actions.cancelledRuns}</strong> <span className="text-[var(--gc-text-muted)]">cancelled</span></span>
                </div>
              </div>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );

  return (
    <GitHubLikeDashboardPage
      user={snapshot?.user}
      sidebar={sidebar}
      main={main}
    />
  );
}
