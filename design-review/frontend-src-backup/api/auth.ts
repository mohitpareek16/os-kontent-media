import { adminApiClient, apiClient } from "./client";

export interface LoginPayload {
  email: string;
  password: string;
}

export async function login(payload: LoginPayload) {
  const { data } = await apiClient.post<{ access_token: string }>("/auth/login", payload);
  return data;
}

/** Sent as the real Owner (see `adminApiClient`), so switching from one
 * simulated account straight to another works without stopping first. */
export async function impersonateUser(userId: string) {
  const { data } = await adminApiClient.post<{ access_token: string }>(
    `/auth/impersonate/${userId}`,
  );
  return data;
}


export async function forgotPassword(email: string) {
  await apiClient.post("/auth/forgot-password", { email });
}

export async function resetPasswordWithToken(token: string, newPassword: string) {
  await apiClient.post("/auth/reset-password", { token, new_password: newPassword });
}
