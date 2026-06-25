// 正则文本过滤器 — 用于隐私脱敏、内容安全
// 来源：ChatterUI lib/hooks/TextFilter.tsx
// 适配：使用 AsyncStorage 替代 MMKV，去掉 Logger 依赖

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { getSafeStorage } from "../lib/safeStorage";

// ── Zustand Store ──
type TextFilterState = {
  /** 正则表达式数组（大小写不敏感） */
  filter: string[];
  /** 是否发送过滤后的文本（默认 true） */
  sendFilteredText: boolean;
  setFilter: (arr: string[]) => void;
  setSendFilteredText: (b: boolean) => void;
};

export const useTextFilterStore = create<TextFilterState>()(
  persist(
    (set) => ({
      filter: [
        // 默认规则：过滤常见 PII（个人身份信息）
        "\\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Z|a-z]{2,}\\b", // email
        "\\b1[3-9]\\d{9}\\b", // 中国大陆手机号
        "\\b\\d{15}(\\d{2}[0-9Xx])?\\b", // 中国大陆身份证号
      ],
      sendFilteredText: true,
      setFilter: (arr) => set({ filter: arr }),
      setSendFilteredText: (b) => set({ sendFilteredText: b }),
    }),
    {
      name: "@anotherme/text-filter",
      version: 1,
      storage: createJSONStorage(getSafeStorage),
    },
  ),
);

// ── Hook ──
type FilterResult = {
  /** 过滤后的文本 */
  result: string;
  /** 是否有内容被过滤 */
  found: boolean;
};

export function useTextFilter(text: string): FilterResult {
  const filters = useTextFilterStore((state) => state.filter);

  if (!text || filters.length === 0) {
    return { result: text, found: false };
  }

  let newText = text;
  try {
    for (const pattern of filters) {
      const regex = new RegExp(pattern, "gi");
      newText = newText.replace(regex, "***");
    }
  } catch (e) {
    console.warn("[TextFilter] Regex parse error:", e);
  }

  return {
    result: newText,
    found: newText.length !== text.length,
  };
}
