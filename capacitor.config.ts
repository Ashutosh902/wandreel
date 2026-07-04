import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.wandreel.app",
  appName: "Wandreel",
  webDir: "dist",
  plugins: {
    SocialLogin: {
      providers: {
        google: true,
        facebook: false,
        apple: false,
        twitter: false,
      },
      logLevel: 1,
    },
  },
  server: {
    url: "https://app.wandreel.com",
    cleartext: false,
  },
  android: {
    allowMixedContent: false,
  },
};

export default config;
