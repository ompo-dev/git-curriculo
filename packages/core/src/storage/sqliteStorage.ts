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

  constructor(options: BrowserSqliteStorageOptions = {}) {
    this.locateFileBaseUrl =
      options.locateFileBaseUrl ?? "https://cdn.jsdelivr.net/npm/sql.js@1.12.0/dist";
    this.locateFileResolver = options.locateFile;
    this.persistKey = options.persistKey ?? DB_BINARY_KEY;
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
          // sql.js browser loader may ask for `sql-wasm-browser.wasm` while older CDN tags only ship `sql-wasm.wasm`.
          const normalized = file.replace("sql-wasm-browser.wasm", "sql-wasm.wasm");
          return `${this.locateFileBaseUrl}/${normalized}`;
        });
      this.sql = await initSqlJs({ locateFile });
    }

    const saved = localStorage.getItem(this.persistKey);
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

    this.db?.run(
      `INSERT INTO snapshots(captured_at, payload_json) VALUES (?, ?);`,
      [parsed.capturedAt, JSON.stringify(parsed)]
    );
    this.persist();
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

    this.db?.run(`INSERT INTO metrics(captured_at, payload_json) VALUES (?, ?);`, [
      capturedAt,
      JSON.stringify(parsed)
    ]);
    this.persist();
  }

  async saveResume(capturedAt: string, resume: ResumeDocument): Promise<void> {
    await this.ensureInit();
    const parsed = ResumeDocumentSchema.parse(resume);

    this.db?.run(`INSERT INTO resumes(captured_at, payload_json) VALUES (?, ?);`, [
      capturedAt,
      JSON.stringify(parsed)
    ]);
    this.persist();
  }

  exportBinary(): Uint8Array {
    if (!this.db) {
      throw new Error("Banco nao inicializado");
    }
    return this.db.export();
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
    this.persist();
  }

  private persist(): void {
    if (!this.db) {
      return;
    }

    localStorage.setItem(this.persistKey, toBase64(this.db.export()));
  }

  private async ensureInit(): Promise<void> {
    if (!this.db) {
      await this.init();
    }
  }
}
