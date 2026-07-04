/** Auth / platform API paths (not owned by any single feature module). */
export const AUTH_ENDPOINTS = {
  refresh: "/api/v1/auth/refresh",
  logout: "/api/v1/auth/logout",
} as const;

/** Current-user / platform user paths. */
export const USER_ENDPOINTS = {
  me: "/api/v1/users/me",
} as const;
