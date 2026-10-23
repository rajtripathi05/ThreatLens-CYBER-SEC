import { useSyncExternalStore } from "react";

/** Service-worker registration and a tiny observable for UI. Only active in production builds served over https/localhost. */
export interface PwaState {
  supported: boolean;
  /** Service worker is active and has finished precaching the application shell. */
  offlineReady: boolean;
  updateAvailable: boolean;
}

let state: PwaState = { supported: typeof navigator !== "undefined" && "serviceWorker" in navigator, offlineReady: false, updateAvailable: false };
const listeners = new Set<() => void>();
let waiting: ServiceWorker | null = null;

function set(p: Partial<PwaState>) { state = { ...state, ...p }; listeners.forEach((l) => l()); }

export function registerServiceWorker(): void {
  if (!import.meta.env.PROD || !state.supported) return;
  window.addEventListener("load", () => {
    navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).then((reg) => {
      const track = (w: ServiceWorker | null) => w?.addEventListener("statechange", () => {
        if (w.state === "installed" && navigator.serviceWorker.controller) { waiting = w; set({ updateAvailable: true }); }
      });
      track(reg.installing);
      reg.addEventListener("updatefound", () => track(reg.installing));
      void navigator.serviceWorker.ready.then(() => askReady());
    }).catch(() => set({ supported: false }));
    navigator.serviceWorker.addEventListener("message", (e) => { if (e.data?.type === "PRECACHE_DONE") set({ offlineReady: Boolean(e.data.ok) }); });
    navigator.serviceWorker.addEventListener("controllerchange", () => { if (waiting) window.location.reload(); });
  });
}

function askReady() { navigator.serviceWorker.controller?.postMessage({ type: "PRECACHE_STATUS" }); }

/** User-initiated: activate the waiting worker and reload. */
export function applyUpdate(): void { waiting?.postMessage({ type: "SKIP_WAITING" }); }

export function usePwa(): PwaState {
  return useSyncExternalStore((fn) => { listeners.add(fn); return () => { listeners.delete(fn); }; }, () => state);
}
