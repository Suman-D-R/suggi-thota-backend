// User roles constants
export enum Roles {
  USER = 'user',
  ADMIN = 'admin',
  DELIVERY_PARTNER = 'delivery_partner'
}

// User roles as object for backward compatibility
export const USER_ROLES = {
  ADMIN: 'admin',
  USER: 'user',
  DELIVERY_PARTNER: 'delivery_partner'
} as const;

export type UserRole = typeof USER_ROLES[keyof typeof USER_ROLES];

