import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useOfflineSync } from '../hooks/useOfflineSync';

export default function RootLayout() {
  // Initialize offline queue and auto-flush on network recovery
  useOfflineSync();

  return (
    <>
      <StatusBar style="dark" />
      <Stack
        screenOptions={{
          headerShown: false,
        }}
      />
    </>
  );
}
