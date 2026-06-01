export const API_BASE = "/api";

export async function apiPost<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `HTTP ${response.status}`);
  }
  return response.json() as Promise<T>;
}

export function apiPostSse(
  path: string,
  body: unknown,
  handlers: {
    onEvent: (event: string, data: unknown) => void;
    onError?: (message: string) => void;
  }
): () => void {
  const controller = new AbortController();

  void (async () => {
    const response = await fetch(`${API_BASE}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
      body: JSON.stringify(body),
      signal: controller.signal
    });

    if (!response.ok || !response.body) {
      handlers.onError?.(`HTTP ${response.status}`);
      return;
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const parts = buffer.split("\n\n");
      buffer = parts.pop() ?? "";
      for (const part of parts) {
        const lines = part.split("\n");
        let event = "message";
        let dataLine = "";
        for (const line of lines) {
          if (line.startsWith("event:")) event = line.slice(6).trim();
          if (line.startsWith("data:")) dataLine = line.slice(5).trim();
        }
        if (dataLine) {
          try {
            handlers.onEvent(event, JSON.parse(dataLine));
          } catch {
            handlers.onEvent(event, dataLine);
          }
        }
      }
    }
  })().catch((error) => {
    if (!controller.signal.aborted) {
      handlers.onError?.(error instanceof Error ? error.message : "Erro de rede");
    }
  });

  return () => controller.abort();
}
