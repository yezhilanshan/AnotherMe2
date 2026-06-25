import { create } from 'zustand';

interface TabBarState {
  hidden: boolean;
  hide: () => void;
  show: () => void;
}

export const useTabBarStore = create<TabBarState>((set) => ({
  hidden: false,
  hide: () => set({ hidden: true }),
  show: () => set({ hidden: false }),
}));
