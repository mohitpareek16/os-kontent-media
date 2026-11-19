import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";

import { impersonateUser, login, type LoginPayload } from "@/api/auth";
import { fetchMe } from "@/api/users";

export function useLogin() {
  const navigate = useNavigate();
  return useMutation({
    mutationFn: (payload: LoginPayload) => login(payload),
    onSuccess: (data) => {
      localStorage.setItem("access_token", data.access_token);
      localStorage.removeItem("admin_token");
      navigate("/");
    },
  });
}

/** Only `me` was invalidated when the identity changed, so every other cached
 * list — jobs, pods, notifications, capacity — was still the previous
 * account's rows until something happened to refetch them. Whose data it is
 * has changed, so all of it is stale. */
function resetCachedIdentity(queryClient: ReturnType<typeof useQueryClient>) {
  queryClient.clear();
}

export function useImpersonate() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (userId: string) => impersonateUser(userId),
    onSuccess: (data) => {
      const currentToken = localStorage.getItem("access_token");
      // Only the *first* hop stores an admin token — hopping straight from
      // one simulated account to another must not overwrite the Owner's real
      // token with the token of the account they were just simulating.
      if (!localStorage.getItem("admin_token") && currentToken) {
        localStorage.setItem("admin_token", currentToken);
      }
      localStorage.setItem("access_token", data.access_token);
      resetCachedIdentity(queryClient);
    },
  });
}

export function useStopImpersonating() {
  const queryClient = useQueryClient();
  return () => {
    const adminToken = localStorage.getItem("admin_token");
    if (adminToken) {
      localStorage.setItem("access_token", adminToken);
      localStorage.removeItem("admin_token");
      resetCachedIdentity(queryClient);
    }
  };
}

export function useCurrentUser() {
  return useQuery({
    queryKey: ["me"],
    queryFn: fetchMe,
    enabled: Boolean(localStorage.getItem("access_token")),
    retry: false,
  });
}

export function useLogout() {
  const navigate = useNavigate();
  return () => {
    localStorage.removeItem("access_token");
    localStorage.removeItem("admin_token");
    navigate("/login");
  };
}

