import { useEffect, useState } from "react";

/** True cuando el sitio se abrió desde el acceso directo instalado (PWA). */
export function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    window.matchMedia("(display-mode: fullscreen)").matches ||
    window.matchMedia("(display-mode: minimal-ui)").matches ||
    (window.navigator as unknown as { standalone?: boolean }).standalone === true
  );
}

export function useStandalone(): boolean {
  const [value, setValue] = useState(false);
  useEffect(() => {
    setValue(isStandalone());
  }, []);
  return value;
}

const POST_AUTH_KEY = "laatu:post-auth";

export function rememberPostAuthRoute(path: string) {
  try {
    sessionStorage.setItem(POST_AUTH_KEY, path);
  } catch {
    /* noop */
  }
}

export function takePostAuthRoute(): string | null {
  try {
    const value = sessionStorage.getItem(POST_AUTH_KEY);
    if (value) sessionStorage.removeItem(POST_AUTH_KEY);
    return value && value.startsWith("/") ? value : null;
  } catch {
    return null;
  }
}
