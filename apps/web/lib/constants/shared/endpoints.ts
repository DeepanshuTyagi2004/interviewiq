/** Auth / platform API paths (not owned by any single feature module). */
export const AUTH_ENDPOINTS = {
  refresh: "/api/v1/auth/refresh",
  logout: "/api/v1/auth/logout",
  register: "/api/v1/auth/register",
  login: "/api/v1/auth/login",
  verifyEmail: "/api/v1/auth/verify-email",
  resendVerification: "/api/v1/auth/resend-verification",
  forgotPassword: "/api/v1/auth/forgot-password",
  resetPassword: "/api/v1/auth/reset-password",
} as const;

/** Current-user / platform user paths. */
export const USER_ENDPOINTS = {
  me: "/api/v1/users/me",
} as const;
