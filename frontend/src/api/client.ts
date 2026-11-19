import axios from "axios";

/** Multi-select filters go out as repeated params (`?stage=qc1&stage=qc2`),
 * which is what FastAPI reads a `list[...]` query param from. Axios' default
 * would send `stage[]=qc1`, and the server would see no `stage` at all — the
 * filter would silently do nothing rather than fail loudly. */
const paramsSerializer = { indexes: null } as const;

// Every request/mutation in the app goes through this instance — never a
// bare fetch/axios call in a component or hook. See docs/06-frontend-rules.md.
export const apiClient = axios.create({
  baseURL: "/api",
  paramsSerializer,
});

apiClient.interceptors.request.use((config) => {
  const token = localStorage.getItem("access_token");
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

/** The same API, authenticated as the *real* signed-in Owner rather than as
 * whoever they are currently simulating.
 *
 * Impersonation swaps `access_token` for the target's token, which means an
 * Owner simulating a VE was, for every request, a VE — including the two
 * requests impersonation itself needs (`POST /auth/impersonate` and the
 * `GET /users` behind the "viewing as" picker, both owner-gated). Switching
 * straight from one person to another therefore 403'd, and the only way out
 * was to stop impersonating first. These two calls — and only these — go out
 * as the admin. */
export const adminApiClient = axios.create({ baseURL: "/api", paramsSerializer });

/* Demo build (VITE_DEMO=true): answer every request from an in-memory mock
 * instead of the network. The import is lazy and this whole branch is removed
 * from a normal build, so the real app is unchanged. See src/demo/. */
if (import.meta.env.VITE_DEMO === "true") {
  const demoAdapter: typeof axios.defaults.adapter = (config) =>
    import("@/demo/server").then((m) => m.demoAdapter(config));
  apiClient.defaults.adapter = demoAdapter;
  adminApiClient.defaults.adapter = demoAdapter;
}

adminApiClient.interceptors.request.use((config) => {
  const token = localStorage.getItem("admin_token") || localStorage.getItem("access_token");
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

/** End the session and land on login with an explanation.
 *
 * Exported because the chat stream can't go through the interceptor below —
 * it uses `fetch` to read a response body incrementally, which axios can't
 * do — and "what happens on a 401" must stay a single decision, not one per
 * transport. See docs/06-frontend-rules.md § Session expiry. */
export function endExpiredSession() {
  if (!localStorage.getItem("access_token")) return;
  localStorage.removeItem("access_token");
  localStorage.removeItem("admin_token");
  if (window.location.pathname !== "/login") {
    window.location.replace("/login?expired=1");
  }
}

// A token that has expired (or an account that's been deactivated) used to
// leave the app looking signed in while every request quietly failed —
// ProtectedRoute only checks that a token *string* exists, not that it still
// works. Any 401 now ends the session properly and lands on the login page.
function attachSessionExpiryHandler(instance: typeof apiClient) {
  instance.interceptors.response.use(
    (response) => response,
    (error) => {
      const status = error?.response?.status;
      const url = String(error?.config?.url ?? "");
      const isLoginAttempt = url.includes("/auth/login");
      if (status === 401 && !isLoginAttempt) {
        endExpiredSession();
      }
      return Promise.reject(error);
    },
  );
}

attachSessionExpiryHandler(apiClient);
attachSessionExpiryHandler(adminApiClient);
