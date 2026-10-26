import { Capacitor } from "@capacitor/core";

/** True when Läätu is running inside the native iOS/Android Capacitor shell. */
export function isNativeApp(): boolean {
  return Capacitor.isNativePlatform();
}

/** Platform reported by Capacitor, or "web" when running in a browser. */
export function getAppPlatform(): "ios" | "android" | "web" {
  const platform = Capacitor.getPlatform();
  return platform === "ios" || platform === "android" ? platform : "web";
}
