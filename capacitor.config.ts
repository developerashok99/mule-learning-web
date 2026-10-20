import type { CapacitorConfig } from "@capacitor/cli";

/**
 * Android app: the study site built for the app (npm run build:app → dist-app/, base "/") is bundled into the APK,
 * so lessons, notes, flashcards and search work offline. See MOBILE.md.
 */
const config: CapacitorConfig = {
  appId: "io.github.developerashok99.mulelearning",
  appName: "Mule Learning Hub",
  webDir: "dist-app",
  android: {
    // keep audio playing and the WebView responsive when the screen is off
    backgroundColor: "#0f1723",
  },
  server: {
    androidScheme: "https",
  },
};

export default config;
