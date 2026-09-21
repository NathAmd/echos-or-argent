export const AUTHENTICATION_SESSION_REVOKED_CLOSE_CODE = 4001;

export interface RealtimeIdentity {
  readonly authenticationSessionId?: string;
  readonly userId: string;
}
