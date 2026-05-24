import axios, { AxiosInstance } from "axios";

import type { DeviceFlowStartResponse, DeviceFlowTokenResponse } from "../types/domain";
import { delay } from "../utils/retry";

export interface GitHubAuthServiceOptions {
  clientId: string;
  httpClient?: AxiosInstance;
}

export interface GitHubWebAuthorizeInput {
  scopes: string[];
  redirectUri: string;
  state: string;
  prompt?: "select_account";
  allowSignup?: boolean;
  codeChallenge?: string;
  codeChallengeMethod?: "S256";
}

export interface GitHubExchangeCodeInput {
  code: string;
  clientSecret: string;
  redirectUri: string;
  codeVerifier?: string;
}

export interface GitHubCallbackParams {
  code: string | null;
  state: string | null;
  error: string | null;
  errorDescription: string | null;
}

export class GitHubAuthService {
  private readonly clientId: string;
  private readonly httpClient: AxiosInstance;

  constructor(options: GitHubAuthServiceOptions) {
    this.clientId = options.clientId;
    this.httpClient =
      options.httpClient ??
      axios.create({
        headers: {
          Accept: "application/json",
          "Content-Type": "application/x-www-form-urlencoded"
        }
      });
  }

  createState(size = 16): string {
    const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
    const random = crypto.getRandomValues(new Uint8Array(size));
    return Array.from(random, (value) => alphabet[value % alphabet.length]).join("");
  }

  buildWebAuthorizeUrl(input: GitHubWebAuthorizeInput): string {
    const params = new URLSearchParams({
      client_id: this.clientId,
      redirect_uri: input.redirectUri,
      scope: input.scopes.join(" "),
      state: input.state
    });

    if (input.prompt) {
      params.set("prompt", input.prompt);
    }

    if (typeof input.allowSignup === "boolean") {
      params.set("allow_signup", input.allowSignup ? "true" : "false");
    }

    if (input.codeChallenge) {
      params.set("code_challenge", input.codeChallenge);
      params.set("code_challenge_method", input.codeChallengeMethod ?? "S256");
    }

    return `https://github.com/login/oauth/authorize?${params.toString()}`;
  }

  extractCallbackParams(callbackUrl: string): GitHubCallbackParams {
    const url = new URL(callbackUrl);
    return {
      code: url.searchParams.get("code"),
      state: url.searchParams.get("state"),
      error: url.searchParams.get("error"),
      errorDescription: url.searchParams.get("error_description")
    };
  }

  async exchangeWebCodeForToken(input: GitHubExchangeCodeInput): Promise<DeviceFlowTokenResponse> {
    const body = new URLSearchParams({
      client_id: this.clientId,
      client_secret: input.clientSecret,
      code: input.code,
      redirect_uri: input.redirectUri
    });

    if (input.codeVerifier) {
      body.set("code_verifier", input.codeVerifier);
    }

    const response = await this.httpClient.post<
      DeviceFlowTokenResponse & { error?: string; error_description?: string }
    >("https://github.com/login/oauth/access_token", body);

    if (response.data.error || !response.data.access_token) {
      throw new Error(response.data.error_description ?? response.data.error ?? "Falha ao trocar code por token.");
    }

    return response.data;
  }

  async startDeviceFlow(scopes: string[]): Promise<DeviceFlowStartResponse> {
    const body = new URLSearchParams({
      client_id: this.clientId,
      scope: scopes.join(" ")
    });

    const response = await this.httpClient.post<DeviceFlowStartResponse>(
      "https://github.com/login/device/code",
      body
    );

    return response.data;
  }

  async pollDeviceFlow(
    deviceCode: string,
    intervalSeconds: number,
    timeoutMs = 15 * 60 * 1_000
  ): Promise<DeviceFlowTokenResponse> {
    const startedAt = Date.now();
    let interval = Math.max(intervalSeconds, 1);

    while (Date.now() - startedAt < timeoutMs) {
      await delay(interval * 1_000);

      const body = new URLSearchParams({
        client_id: this.clientId,
        device_code: deviceCode,
        grant_type: "urn:ietf:params:oauth:grant-type:device_code"
      });

      const response = await this.httpClient.post<
        DeviceFlowTokenResponse & { error?: string; error_description?: string }
      >("https://github.com/login/oauth/access_token", body);

      if (response.data.access_token) {
        return response.data;
      }

      const error = response.data.error;
      if (error === "authorization_pending") {
        continue;
      }

      if (error === "slow_down") {
        interval += 5;
        continue;
      }

      if (error === "expired_token") {
        throw new Error("O codigo de dispositivo expirou. Inicie a autenticacao novamente.");
      }

      if (error === "access_denied") {
        throw new Error("A autenticacao foi cancelada pelo usuario.");
      }

      throw new Error(response.data.error_description ?? "Falha na autenticacao com GitHub.");
    }

    throw new Error("Tempo limite excedido para conclusao do Device Flow.");
  }

  async revokeToken(): Promise<boolean> {
    // OAuth app token revocation needs client_secret on GitHub server side.
    // In this local-only MVP we only clear local persisted token.
    return true;
  }
}