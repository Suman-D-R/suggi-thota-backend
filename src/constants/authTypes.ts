// Authentication types - google, otp, password
export enum AuthTypes {
  GOOGLE = 'google',
  OTP = 'otp',
  PASSWORD = 'password',
}

// Authentication methods as object for consistency
export const AUTH_METHODS = {
  GOOGLE: 'google',
  OTP: 'otp',
  PASSWORD: 'password'
} as const;

export type AuthMethod = typeof AUTH_METHODS[keyof typeof AUTH_METHODS];

// OTP configuration
export const OTP_CONFIG = {
  LENGTH: 6,
  EXPIRY_MINUTES: 10,
  MAX_ATTEMPTS: 3
} as const;

// JWT configuration
export const JWT_CONFIG = {
  ACCESS_TOKEN_EXPIRY: '15m',
  REFRESH_TOKEN_EXPIRY: '7d',
  RESET_PASSWORD_EXPIRY: '1h'
} as const;

