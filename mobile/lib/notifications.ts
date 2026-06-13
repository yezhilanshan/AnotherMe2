// expo-notifications removed from app.json to avoid Expo Go crash (SDK 53+)
// When building a development build, re-add the plugin and restore the full implementation.

// No-op stubs — local notifications won't fire in Expo Go, but app won't crash

export async function registerForPushNotifications(): Promise<string | null> {
  return null;
}

export async function scheduleLocalNotification(
  _title: string,
  _body: string,
  _data?: Record<string, unknown>,
): Promise<void> {
  // no-op in Expo Go
}

export function addNotificationResponseListener(
  _callback: (response: unknown) => void,
): Promise<{ remove: () => void }> {
  return Promise.resolve({ remove: () => {} });
}
