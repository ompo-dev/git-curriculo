import axios, { AxiosError } from "axios";

const wait = async (ms: number): Promise<void> => {
  await new Promise((resolve) => setTimeout(resolve, ms));
};

export interface RetryOptions {
  retries?: number;
  initialDelayMs?: number;
  maxDelayMs?: number;
}

const shouldRetry = (error: unknown): boolean => {
  if (!axios.isAxiosError(error)) {
    return true;
  }

  const status = error.response?.status;
  if (status === 429) {
    return true;
  }

  if (status !== undefined && status >= 500) {
    return true;
  }

  return !status;
};

export async function withRetry<T>(
  factory: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const retries = options.retries ?? 3;
  const initialDelayMs = options.initialDelayMs ?? 800;
  const maxDelayMs = options.maxDelayMs ?? 5_000;

  let attempt = 0;
  let delayMs = initialDelayMs;

  while (true) {
    try {
      return await factory();
    } catch (error) {
      attempt += 1;
      if (attempt > retries || !shouldRetry(error)) {
        throw error;
      }

      if (axios.isAxiosError(error)) {
        const retryAfter = parseInt(error.response?.headers["retry-after"] as string, 10);
        if (!Number.isNaN(retryAfter) && retryAfter > 0) {
          delayMs = retryAfter * 1_000;
        }
      }

      await wait(delayMs);
      delayMs = Math.min(Math.round(delayMs * 1.8), maxDelayMs);
    }
  }
}

export const asAxiosErrorMessage = (error: unknown): string => {
  if (axios.isAxiosError(error)) {
    const axiosError = error as AxiosError<{ message?: string }>;
    return axiosError.response?.data?.message ?? axiosError.message;
  }

  return error instanceof Error ? error.message : "Erro desconhecido";
};

export const delay = wait;