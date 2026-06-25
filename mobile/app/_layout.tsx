import { Stack } from 'expo-router';
import { router } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { useColorScheme } from 'react-native';
import { useOfflineSync } from '../hooks/useOfflineSync';
import { addNotificationResponseListener } from '../lib/notifications';

export default function RootLayout() {
  // Initialize offline queue and auto-flush on network recovery
  useOfflineSync();
  const colorScheme = useColorScheme();

  useEffect(() => {
    let subscription: { remove: () => void } | null = null;
    addNotificationResponseListener((response) => {
      const url = (response as {
        notification?: {
          request?: { content?: { data?: { url?: unknown } } };
        };
      })?.notification?.request?.content?.data?.url;
      if (typeof url === 'string' && url.startsWith('/')) {
        router.push(url);
      }
    }).then((sub) => {
      subscription = sub;
    });
    return () => {
      subscription?.remove();
    };
  }, []);

  return (
    <>
      <StatusBar style={colorScheme === 'dark' ? 'light' : 'dark'} />
      <Stack
        screenOptions={{
          headerShown: false,
        }}
      />
    </>
  );
}
