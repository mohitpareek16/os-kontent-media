import { useEffect, useMemo, useState } from "react";

export type Platform = "ios" | "android" | "other";

/** Which phone chrome to draw. iPadOS reports itself as a Mac, so a Mac with a
 * touch screen is an iPad. */
export function detectPlatform(): Platform {
  if (typeof navigator === "undefined") return "other";
  const ua = navigator.userAgent;
  if (/iPhone|iPad|iPod/i.test(ua)) return "ios";
  if (/Macintosh/i.test(ua) && navigator.maxTouchPoints > 1) return "ios";
  if (/Android/i.test(ua)) return "android";
  return "other";
}

/** True when launched from the home screen (no browser bars). */
export function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  const nav = window.navigator as Navigator & { standalone?: boolean };
  return Boolean(nav.standalone) || Boolean(window.matchMedia?.("(display-mode: standalone)").matches);
}

export function usePlatform(): Platform {
  return useMemo(detectPlatform, []);
}

/* `beforeinstallprompt` (Chrome / Edge / Samsung Internet on Android) is a
 * one-shot event; keep the deferred prompt at module level so any component can
 * offer the install button, however late it mounts. */
interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

let deferredPrompt: InstallPromptEvent | null = null;
const listeners = new Set<() => void>();

if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    deferredPrompt = event as InstallPromptEvent;
    listeners.forEach((fn) => fn());
  });
  window.addEventListener("appinstalled", () => {
    deferredPrompt = null;
    listeners.forEach((fn) => fn());
  });
}

/** What the app can offer for installing itself on this device. */
export function useInstall() {
  const [, bump] = useState(0);
  useEffect(() => {
    const fn = () => bump((n) => n + 1);
    listeners.add(fn);
    return () => {
      listeners.delete(fn);
    };
  }, []);

  const platform = usePlatform();
  const installed = isStandalone();
  return {
    platform,
    installed,
    /** Android/desktop Chrome: a native install dialog is available. */
    canPrompt: deferredPrompt !== null && !installed,
    /** iPhone/iPad Safari: no prompt exists — show Share → Add to Home Screen. */
    needsManualSteps: platform === "ios" && !installed,
    async promptInstall() {
      if (!deferredPrompt) return false;
      await deferredPrompt.prompt();
      const choice = await deferredPrompt.userChoice;
      deferredPrompt = null;
      listeners.forEach((fn) => fn());
      return choice.outcome === "accepted";
    },
  };
}
