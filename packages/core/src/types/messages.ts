export const MESSAGE_CONTRACTS = {
  AUTH_GITHUB_LOGIN_REQUEST: "AUTH_GITHUB_LOGIN_REQUEST",
  AUTH_GITHUB_LOGIN_RESULT: "AUTH_GITHUB_LOGIN_RESULT",
  SYNC_TRIGGER: "SYNC_TRIGGER",
  RESUME_GENERATE: "RESUME_GENERATE",
  RESUME_EXPORT: "RESUME_EXPORT"
} as const;

export type MessageContract = (typeof MESSAGE_CONTRACTS)[keyof typeof MESSAGE_CONTRACTS];

export interface AppMessage<TPayload = unknown> {
  type: MessageContract;
  payload: TPayload;
}
