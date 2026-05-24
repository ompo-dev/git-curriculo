// Message type constants inlined to avoid importing @gitcurriculo/core (which pulls sql.js)
const AUTH_EXTENSION_PING = "AUTH_EXTENSION_PING";
const AUTH_EXTENSION_PONG = "AUTH_EXTENSION_PONG";
const AUTH_EXPORT_TOKEN = "AUTH_EXPORT_TOKEN";
const AUTH_GITHUB_LOGIN_REQUEST = "AUTH_GITHUB_LOGIN_REQUEST";
const AUTH_GITHUB_LOGIN_RESULT = "AUTH_GITHUB_LOGIN_RESULT";

chrome.runtime.onMessage.addListener((message) => {
  if (!message?.type) return;
  window.postMessage(message, "*");
});

window.addEventListener("message", (event) => {
  if (event.source !== window) return;

  if (event.data?.type === AUTH_EXTENSION_PING) {
    window.postMessage(
      { type: AUTH_EXTENSION_PONG, payload: { requestId: event.data?.payload?.requestId ?? null } },
      "*"
    );
    return;
  }

  if (event.data?.type !== AUTH_GITHUB_LOGIN_REQUEST) return;

  void chrome.runtime
    .sendMessage(event.data)
    .then((result) => {
      window.postMessage(
        {
          type: AUTH_GITHUB_LOGIN_RESULT,
          payload: { ...(result ?? {}), requestId: event.data?.payload?.requestId ?? null }
        },
        "*"
      );

      if (result?.ok && result?.token) {
        window.postMessage(
          {
            type: AUTH_EXPORT_TOKEN,
            payload: { token: result.token, requestId: event.data?.payload?.requestId ?? null }
          },
          "*"
        );
      }
    })
    .catch((error: unknown) => {
      window.postMessage(
        {
          type: AUTH_GITHUB_LOGIN_RESULT,
          payload: {
            ok: false,
            requestId: event.data?.payload?.requestId ?? null,
            error: error instanceof Error ? error.message : "Falha no login via extensao."
          }
        },
        "*"
      );
    });
});
