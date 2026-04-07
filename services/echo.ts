import Constants from "expo-constants";
import Echo from "laravel-echo";
import Pusher from "pusher-js";

(global as any).Pusher = Pusher;

const BASE_URL =
  Constants.expoConfig?.extra?.BASE_URL || process.env.EXPO_PUBLIC_BASE_URL;

//  Environment
const IS_PROD = !__DEV__;
// 🚨 FIX: Use your computer's IP for local, and your raw domain for Prod
const WS_HOST = IS_PROD ? "api.techstrota.com" : "192.168.1.8";

export function initEcho(token: string) {
  return new Echo({
    broadcaster: "reverb",
    key: process.env.EXPO_PUBLIC_REVERB_APP_KEY, // Match your backend .env

    wsHost: WS_HOST,
    wsPort: IS_PROD ? 443 : 8080,
    wssPort: IS_PROD ? 443 : 8080,

    forceTLS: IS_PROD,

    // 🚨 FIX: Use undefined for local to prevent path resolution bugs
    wsPath: IS_PROD ? "/app" : undefined,

    // 🚨 FIX: Prevent pusher-js from making assumptions
    cluster: undefined,

    enabledTransports: ["ws", "wss"],
    disableStats: true,
    authEndpoint: `${BASE_URL}/api/broadcasting/auth`,
    auth: {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
      },
    },
  });
}
