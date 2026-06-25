import Constants from "expo-constants";
import { Platform } from "react-native";
import { getSafeStorage } from "./safeStorage";
import type { ReviewPlanItem } from "./types";

const REVIEW_NOTIFICATION_KEY = "@anotherme/review-notification/";

// expo-notifications push functionality is unavailable in Expo Go since SDK 53.
// Skip loading the module entirely when running in Expo Go to avoid
// the synchronous error thrown during module initialization.
const IS_EXPO_GO = Constants.appOwnership === "expo";

type ExpoNotifications = typeof import("expo-notifications");

let notificationsPromise: Promise<ExpoNotifications | null> | null = null;
let handlerConfigured = false;

async function loadNotifications(): Promise<ExpoNotifications | null> {
  if (IS_EXPO_GO) {
    return null;
  }
  if (!notificationsPromise) {
    notificationsPromise = import("expo-notifications").catch((err) => {
      console.warn("[notifications] expo-notifications unavailable:", err);
      return null;
    });
  }
  return notificationsPromise;
}

async function ensureNotificationHandler(
  Notifications: ExpoNotifications,
): Promise<void> {
  if (!handlerConfigured) {
    Notifications.setNotificationHandler({
      handleNotification: async () => ({
        shouldPlaySound: false,
        shouldSetBadge: false,
        shouldShowBanner: true,
        shouldShowList: true,
      }),
    });
    handlerConfigured = true;
  }

  if (Platform.OS === "android") {
    await Notifications.setNotificationChannelAsync("review-reminders", {
      name: "学习复习提醒",
      importance: Notifications.AndroidImportance.DEFAULT,
      vibrationPattern: [0, 180, 120, 180],
      lightColor: "#7EA8BE",
    });
  }
}

async function ensureNotificationPermission(
  Notifications: ExpoNotifications,
): Promise<boolean> {
  const current = await Notifications.getPermissionsAsync();
  let status = current.status;
  if (status !== "granted") {
    const requested = await Notifications.requestPermissionsAsync();
    status = requested.status;
  }
  return status === "granted";
}

export async function registerForPushNotifications(): Promise<string | null> {
  const Notifications = await loadNotifications();
  if (!Notifications) return null;
  await ensureNotificationHandler(Notifications);
  await ensureNotificationPermission(Notifications);
  return null;
}

export async function scheduleLocalNotification(
  title: string,
  body: string,
  data?: Record<string, unknown>,
  seconds = 3,
): Promise<void> {
  const Notifications = await loadNotifications();
  if (!Notifications) return;

  await ensureNotificationHandler(Notifications);
  const granted = await ensureNotificationPermission(Notifications);
  if (!granted) return;

  await Notifications.scheduleNotificationAsync({
    content: { title, body, data },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
      seconds,
    },
  });
}

export async function scheduleReviewNotification(
  item: ReviewPlanItem,
): Promise<void> {
  const today = new Date().toISOString().slice(0, 10);
  const storageKey = `${REVIEW_NOTIFICATION_KEY}${today}:${item.knowledgePointId}`;
  const storage = getSafeStorage();
  const existing = await storage.getItem(storageKey);
  if (existing) return;

  await scheduleLocalNotification(
    "今日复习",
    `「${item.name}」到了复习间隔，先做一道小检查题。`,
    {
      url: `/chat?reviewKnowledgePointId=${encodeURIComponent(item.knowledgePointId)}&reviewTitle=${encodeURIComponent(item.name)}`,
      knowledgePointId: item.knowledgePointId,
      source: "review-reminder",
    },
    8,
  );
  await storage.setItem(storageKey, "scheduled");
}

export async function addNotificationResponseListener(
  callback: (response: unknown) => void,
): Promise<{ remove: () => void }> {
  const Notifications = await loadNotifications();
  if (!Notifications) return { remove: () => {} };
  await ensureNotificationHandler(Notifications);
  return Notifications.addNotificationResponseReceivedListener(callback);
}
