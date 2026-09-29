# UI Authentication Guide

This backend uses Google OAuth2 for login, an HttpOnly `refresh_token` cookie for long-lived sessions, and short-lived JWT access tokens for API calls.

## Local Origins

Default local setup:

```text
UI:      http://localhost:5174
Backend: http://localhost:8080
```

The backend must have `app.frontend-url` set to the UI origin. After a successful Google login, the backend redirects to:

```text
{app.frontend-url}/auth/callback
```

## Login Flow

The UI should not call Google directly. Start login by navigating the browser to the backend OAuth2 authorization endpoint:

```ts
export function loginWithGoogle() {
  window.location.href = "http://localhost:8080/oauth2/authorization/google";
}
```

Flow:

```text
UI login button
  -> GET /oauth2/authorization/google
  -> Google login
  -> GET /login/oauth2/code/google
  -> backend creates/updates user
  -> backend sets HttpOnly refresh_token cookie
  -> backend redirects to /auth/callback on the UI
```

The refresh token is not readable by JavaScript because it is stored in an HttpOnly cookie.

## Callback Page

The UI route `/auth/callback` should call the refresh endpoint once to get an access token.

```ts
type TokenResponse = {
  accessToken: string;
  tokenType: "Bearer";
  expiresIn: number;
};

export async function refreshAccessToken(): Promise<TokenResponse> {
  const response = await fetch("http://localhost:8080/api/v1/auth/refresh", {
    method: "POST",
    credentials: "include",
  });

  if (!response.ok) {
    throw new Error("Unable to refresh session");
  }

  return response.json();
}
```

Store the returned `accessToken` in memory, such as React state, context, Zustand, Redux, or another in-memory store. Avoid storing access tokens in `localStorage` unless you deliberately accept the XSS tradeoff.

Example callback behavior:

```ts
async function handleAuthCallback() {
  const tokenResponse = await refreshAccessToken();
  setAccessToken(tokenResponse.accessToken);
  navigate("/dashboard");
}
```

## Authenticated API Calls

Protected API requests should send the access token as a Bearer token:

```ts
export async function apiFetch(
  path: string,
  accessToken: string,
  init: RequestInit = {}
) {
  return fetch(`http://localhost:8080${path}`, {
    ...init,
    headers: {
      ...init.headers,
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
  });
}
```

Example:

```ts
await apiFetch("/api/v1/interviews", accessToken);
```

## Refresh On Page Load

Because the access token is stored in memory, a page reload loses it. On app startup, call `/api/v1/auth/refresh` with credentials included:

```ts
async function bootstrapAuth() {
  try {
    const tokenResponse = await refreshAccessToken();
    setAccessToken(tokenResponse.accessToken);
  } catch {
    setAccessToken(null);
  }
}
```

If the refresh cookie is missing, expired, revoked, or invalid, the backend returns `401` and clears the stale refresh cookie.

## Refresh On 401

When an API request returns `401`, try refreshing once and then retry the original request.

```ts
export async function apiFetchWithRefresh(
  path: string,
  getAccessToken: () => string | null,
  setAccessToken: (token: string | null) => void,
  init: RequestInit = {}
) {
  const firstToken = getAccessToken();

  let response = await apiFetch(path, firstToken ?? "", init);

  if (response.status !== 401) {
    return response;
  }

  try {
    const tokenResponse = await refreshAccessToken();
    setAccessToken(tokenResponse.accessToken);
    response = await apiFetch(path, tokenResponse.accessToken, init);
    return response;
  } catch {
    setAccessToken(null);
    throw new Error("Session expired");
  }
}
```

In a full app, make sure only one refresh request runs at a time. If multiple requests fail with `401` together, queue them behind a single refresh call.

## Logout

Logout revokes the refresh token server-side and clears the refresh cookie. The UI should also clear the in-memory access token.

```ts
export async function logout() {
  await fetch("http://localhost:8080/api/v1/auth/logout", {
    method: "POST",
    credentials: "include",
  });

  setAccessToken(null);
  navigate("/login");
}
```

JWT access tokens are not revoked on logout. They should be short-lived and removed from UI memory. The refresh token is what prevents the UI from getting more access tokens.

## Important Fetch Settings

Use `credentials: "include"` only when calling cookie-backed auth endpoints:

```text
POST /api/v1/auth/refresh
POST /api/v1/auth/logout
```

Use the Bearer access token for protected API endpoints:

```text
Authorization: Bearer {accessToken}
```

## Production Notes

- Use HTTPS in production.
- Set refresh cookies with `secure(true)` in production.
- Revisit `SameSite` based on deployment domains.
- Revisit CSRF before production because refresh/logout use cookies.
- Keep refresh tokens out of JavaScript-readable storage.
