import { Stack } from "expo-router";
import { router } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useEffect } from "react";
import { useColorScheme } from "react-native";
import { useOfflineSync } from "../hooks/useOfflineSync";
import { debugError, debugLog } from "../lib/debug";
import { addNotificationResponseListener } from "../lib/notifications";
import {
  initGatewayConfig,
  getGatewayHost,
  getGatewayUrl,
} from "../lib/runtime-gateway-config";
import { syncRuntimeConfig } from "../lib/config";

export default function RootLayout() {
  // Initialize offline queue and auto-flush on network recovery
  useOfflineSync();
  const colorScheme = useColorScheme();

  // Load persisted Gateway config from AsyncStorage on startup.
  // This must run before any API calls so the correct IP is used.
  useEffect(() => {
    initGatewayConfig().then(() => {
      syncRuntimeConfig();
      debugLog("runtime", "gateway_config_loaded", {
        host: getGatewayHost(),
        url: getGatewayUrl(),
      });
    });
  }, []);

  useEffect(() => {
    debugLog("runtime", "root_layout_mount", { colorScheme });
    const errorUtils = (globalThis as any).ErrorUtils;
    const previousHandler =
      typeof errorUtils?.getGlobalHandler === "function"
        ? errorUtils.getGlobalHandler()
        : undefined;
    if (typeof errorUtils?.setGlobalHandler === "function") {
      errorUtils.setGlobalHandler((error: Error, isFatal?: boolean) => {
        debugError("runtime", "global_js_error", {
          isFatal,
          message: error?.message,
          stack: error?.stack,
        });
        previousHandler?.(error, isFatal);
      });
    }
    const rejectionHandler = (event: any) => {
      const reason = event?.reason;
      debugError("runtime", "unhandled_rejection", {
        message: reason?.message || String(reason),
        stack: reason?.stack,
      });
    };
    globalThis.addEventListener?.("unhandledrejection", rejectionHandler);

    let subscription: { remove: () => void } | null = null;
    addNotificationResponseListener((response) => {
      const url = (
        response as {
          notification?: {
            request?: { content?: { data?: { url?: unknown } } };
          };
        }
      )?.notification?.request?.content?.data?.url;
      if (typeof url === "string" && url.startsWith("/")) {
        router.push(url);
      }
    }).then((sub) => {
      subscription = sub;
    });
    return () => {
      subscription?.remove();
      globalThis.removeEventListener?.("unhandledrejection", rejectionHandler);
      if (
        typeof errorUtils?.setGlobalHandler === "function" &&
        previousHandler
      ) {
        errorUtils.setGlobalHandler(previousHandler);
      }
    };
  }, [colorScheme]);

  return (
    <>
      <StatusBar style={colorScheme === "dark" ? "light" : "dark"} />
      <Stack
        screenOptions={{
          headerShown: false,
        }}
      />
    </>
  );
}
