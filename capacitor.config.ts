import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.laatuwellness.app",
  appName: "Läätu Wellness",
  webDir: "dist",
  bundledWebRuntime: false,
  server: process.env.CAPACITOR_SERVER_URL
    ? {
        url: process.env.CAPACITOR_SERVER_URL,
        cleartext: process.env.CAPACITOR_SERVER_URL.startsWith("http://"),
      }
    : undefined,
  android: {
    allowMixedContent: false,
  },
};

export default config;
