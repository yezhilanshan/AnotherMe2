type StorageLike = {
  getItem: (key: string) => Promise<string | null>;
  setItem: (key: string, value: string) => Promise<void>;
  removeItem: (key: string) => Promise<void>;
};

const memoryStore = new Map<string, string>();
let useMemory = false;
let cachedStorage: StorageLike | null | undefined;
const NATIVE_STORAGE_TIMEOUT_MS = 3000;

function loadNativeStorage(): StorageLike | null {
  if (cachedStorage !== undefined) return cachedStorage ?? null;
  try {
    cachedStorage = require('@react-native-async-storage/async-storage').default;
  } catch {
    cachedStorage = null;
  }
  const storage = cachedStorage ?? null;
  if (!storage) useMemory = true;
  return storage;
}

export function getSafeStorage(): StorageLike {
  const nativeStorage = loadNativeStorage();

  async function runNative<T>(operation: Promise<T>, fallback: () => T): Promise<T> {
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        operation,
        new Promise<never>((_, reject) => {
          timeoutId = setTimeout(
            () => reject(new Error('AsyncStorage operation timed out')),
            NATIVE_STORAGE_TIMEOUT_MS,
          );
        }),
      ]);
    } catch {
      useMemory = true;
      return fallback();
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
    }
  }

  return {
    getItem: async (key: string) => {
      if (useMemory || !nativeStorage) return memoryStore.get(key) ?? null;
      return runNative(
        nativeStorage.getItem(key),
        () => memoryStore.get(key) ?? null,
      );
    },
    setItem: async (key: string, value: string) => {
      if (useMemory || !nativeStorage) {
        memoryStore.set(key, value);
        return;
      }
      await runNative(
        nativeStorage.setItem(key, value),
        () => {
          memoryStore.set(key, value);
        },
      );
    },
    removeItem: async (key: string) => {
      if (useMemory || !nativeStorage) {
        memoryStore.delete(key);
        return;
      }
      await runNative(
        nativeStorage.removeItem(key),
        () => {
          memoryStore.delete(key);
        },
      );
    },
  };
}
