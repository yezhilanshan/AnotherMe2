type StorageLike = {
  getItem: (key: string) => Promise<string | null>;
  setItem: (key: string, value: string) => Promise<void>;
  removeItem: (key: string) => Promise<void>;
};

const memoryStore = new Map<string, string>();
let useMemory = false;
let cachedStorage: StorageLike | null | undefined;

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

  return {
    getItem: async (key: string) => {
      if (useMemory || !nativeStorage) return memoryStore.get(key) ?? null;
      try {
        return await nativeStorage.getItem(key);
      } catch {
        useMemory = true;
        return memoryStore.get(key) ?? null;
      }
    },
    setItem: async (key: string, value: string) => {
      if (useMemory || !nativeStorage) {
        memoryStore.set(key, value);
        return;
      }
      try {
        await nativeStorage.setItem(key, value);
      } catch {
        useMemory = true;
        memoryStore.set(key, value);
      }
    },
    removeItem: async (key: string) => {
      if (useMemory || !nativeStorage) {
        memoryStore.delete(key);
        return;
      }
      try {
        await nativeStorage.removeItem(key);
      } catch {
        useMemory = true;
        memoryStore.delete(key);
      }
    },
  };
}
