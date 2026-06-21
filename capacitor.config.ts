import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.wandreel.app",
  appName: "Wandreel",
  webDir: "dist",
  server: {
    url: "https://app.wandreel.com",
    cleartext: false,
  },
  android: {
    allowMixedContent: false,
  },
};

export default config;
