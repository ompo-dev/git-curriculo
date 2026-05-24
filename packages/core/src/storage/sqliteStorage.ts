import initSqlJs, { type Database, type SqlJsStatic } from "sql.js";

import {
  AtsAnalysisSchema,
  GitHubProfileSnapshotSchema,
  ResumeDocumentSchema,
  type AtsAnalysis,
  type GitHubProfileSnapshot,
  type ResumeDocument
} from "../schemas";

const DB_BINARY_KEY = "git-curriculo:sqlite-binary";
const IDB_NAME = "git-curriculo";
const IDB_STORE = "kv";

const toBase64 = (value: Uint8Array): string => {
  if (typeof btoa === "function") {
    let binary = "";
    for (const byte of value) {
      binary += String.fromCharCode(byte);
    }
    return btoa(binary);
  }
  return Buffer.from(value).toString("base64");
};

const fromBase64 = (value: string): Uint8Array => {
  if (typeof atob === "function") {
    const raw = atob(value);
    const output = new Uint8Array(raw.length);
    for (let index = 0; index < raw.length; index += 1) {
      output[index] = raw.charCodeAt(index);
    }
    return output;
  }
  return new Uint8Array(Buffer.from(value, "base64"));
};

const openIdb = (): Promise<IDBDatabase> =>
  new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB indisponivel"));
      return;
    }
    const request = indexedDB.open(IDB_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(IDB_STORE)) {
        request.result.createObjectStore(IDB_STORE);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Falha ao abrir IndexedDB"));
  });

const idbGet = async (key: string): Promise<string | null> => {
  const db = await openIdb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, "readonly");
    const req = tx.objectStore(IDB_STORE).get(key);
    req.onsuccess = () => resolve((req.result as string | undefined) ?? null);
    req.onerror = () => reject(req.error ?? new Error("Falha ao ler IndexedDB"));
    tx.oncomplete = () => db.close();
  });
};

const idbSet = async (key: string, value: string): Promise<void> => {
  const db = await openIdb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, "readwrite");
    const req = tx.objectStore(IDB_STORE).put(value, key);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error ?? new Error("Falha ao gravar IndexedDB"));
    tx.oncomplete = () => db.close();
  });
};

export interface BrowserSqliteStorageOptions {
  locateFileBaseUrl?: string;
  locateFile?: (file: string) => string;
  persistKey?: string;
}

export class BrowserSqliteStorage {
  private readonly locateFileBaseUrl: string;
  private readonly locateFileResolver?: (file: string) => string;
  private readonly persistKey: string;
  private sql: SqlJsStatic | null = null;
  private db: Database | null = null;
  private persistWarning: string | null = null;

  constructor(options: BrowserSqliteStorageOptions = {}) {
    this.locateFileBaseUrl =
      options.locateFileBaseUrl ?? "https://cdn.jsdelivr.net/npm/sql.js@1.12.0/dist";
    this.locateFileResolver = options.locateFile;
    this.persistKey = options.persistKey ?? DB_BINARY_KEY;
  }

  getPersistWarning(): string | null {
    return this.persistWarning;
  }

  async init(): Promise<void> {
    if (this.db) {
      return;
    }

    if (typeof window === "undefined") {
      this.sql = await initSqlJs();
    } else {
      const locateFile =
        this.locateFileResolver ??
        ((file: string) => {
          const normalized = file.replace("sql-wasm-browser.wasm", "sql-wasm.wasm");
          return `${this.locateFileBaseUrl}/${normalized}`;
        });
      this.sql = await initSqlJs({ locateFile });
    }

    let saved: string | null = null;
    try {
      saved = await idbGet(this.persistKey);
    } catch {
      saved = null;
    }

    if (!saved && typeof localStorage !== "undefined") {
      saved = localStorage.getItem(this.persistKey);
      if (saved) {
        try {
          await idbSet(this.persistKey, saved);
          localStorage.removeItem(this.persistKey);
        } catch {
          // keep localStorage copy if migration fails
        }
      }
    }

    if (saved) {
      this.db = new this.sql.Database(fromBase64(saved));
    } else {
      this.db = new this.sql.Database();
    }

    this.runMigrations();
  }

  async saveSnapshot(snapshot: GitHubProfileSnapshot): Promise<void> {
    await this.ensureInit();
    const parsed = GitHubProfileSnapshotSchema.parse(snapshot);

    this.db?.run(`DELETE FROM snapshots;`);
    this.db?.run(`INSERT INTO snapshots(captured_at, payload_json) VALUES (?, ?);`, [
      parsed.capturedAt,
      JSON.stringify(parsed)
    ]);
    await this.persist();
  }

  async getLatestSnapshot(): Promise<GitHubProfileSnapshot | null> {
    await this.ensureInit();
    const result = this.db?.exec(
      `SELECT payload_json FROM snapshots ORDER BY captured_at DESC LIMIT 1;`
    );

    const row = result?.[0]?.values?.[0]?.[0];
    if (!row || typeof row !== "string") {
      return null;
    }

    return GitHubProfileSnapshotSchema.parse(JSON.parse(row));
  }

  async saveMetrics(capturedAt: string, analysis: AtsAnalysis): Promise<void> {
    await this.ensureInit();
    const parsed = AtsAnalysisSchema.parse(analysis);

    this.pruneTable("metrics", 5);
    this.db?.run(`INSERT INTO metrics(captured_at, payload_json) VALUES (?, ?);`, [
      capturedAt,
      JSON.stringify(parsed)
    ]);
    await this.persist();
  }

  async saveResume(capturedAt: string, resume: ResumeDocument): Promise<void> {
    await this.ensureInit();
    const parsed = ResumeDocumentSchema.parse(resume);

    this.pruneTable("resumes", 5);
    this.db?.run(`INSERT INTO resumes(captured_at, payload_json) VALUES (?, ?);`, [
      capturedAt,
      JSON.stringify(parsed)
    ]);
    await this.persist();
  }

  exportBinary(): Uint8Array {
    if (!this.db) {
      throw new Error("Banco nao inicializado");
    }
    return this.db.export();
  }

  private pruneTable(table: "metrics" | "resumes", keep: number): void {
    this.db?.run(
      `DELETE FROM ${table} WHERE id NOT IN (SELECT id FROM ${table} ORDER BY captured_at DESC LIMIT ?);`,
      [keep]
    );
  }

  private runMigrations(): void {
    this.db?.run(`
      CREATE TABLE IF NOT EXISTS snapshots (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        captured_at TEXT NOT NULL,
        payload_json TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS metrics (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        captured_at TEXT NOT NULL,
        payload_json TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS resumes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        captured_at TEXT NOT NULL,
        payload_json TEXT NOT NULL
      );
    `);
    void this.persist();
  }

  private async persist(): Promise<void> {
    if (!this.db) {
      return;
    }

    const payload = toBase64(this.db.export());
    this.persistWarning = null;

    try {
      await idbSet(this.persistKey, payload);
      if (typeof localStorage !== "undefined") {
        localStorage.removeItem(this.persistKey);
      }
      return;
    } catch {
      // fallback to localStorage only if IndexedDB fails
    }

    if (typeof localStorage === "undefined") {
      this.persistWarning = "Nao foi possivel persistir dados localmente.";
      return;
    }

    try {
      localStorage.setItem(this.persistKey, payload);
    } catch {
      this.persistWarning =
        "Armazenamento local cheio. Sincronize novamente apos limpar dados do site no navegador.";
    }
  }

  private async ensureInit(): Promise<void> {
    if (!this.db) {
      await this.init();
    }
  }
}
