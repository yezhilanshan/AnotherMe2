// ── 莫兰迪配色主题系统 ──
// 低饱和莫兰迪色系：浅蓝、薄荷绿、暖杏色为主，搭配柔光渐变
// 支持 light / dark（护眼）双模式

import { useColorScheme } from 'react-native';

// ────────────────────────────────
// 莫兰迪 Light 主题
// ────────────────────────────────
const light = {
  // ─ 主色 ─
  primary:       '#7EA8BE',   // 浅蓝灰 — 主按钮、链接、激活态
  primaryLight:  '#C5D8E4',   // 浅蓝灰淡 — 选中背景、图标底
  primaryDark:   '#5E8CA5',   // 浅蓝灰深 — 按下态

  // ─ 辅助色 ─
  mint:          '#A8D5BA',   // 薄荷绿 — 成功、知识追踪
  mintLight:     '#D6EEDD',   // 薄荷绿淡
  apricot:       '#F2C6A0',   // 暖杏色 — 警告、诊断
  apricotLight:  '#FAEADB',   // 暖杏色淡
  lavender:      '#B8A9C9',   // 淡紫灰 — 特殊强调
  lavenderLight: '#E4DEEF',   // 淡紫灰淡

  // ─ 页面背景 ─
  bgPage:        '#F7F5F2',   // 暖灰白页面底
  bgCard:        '#FEFCF9',   // 卡片/模块底
  bgInput:       '#F0EDEA',   // 输入框底
  bgElevated:    '#FFFFFF',   // 浮起元素底（弹窗、header）

  // ─ 文字 ─
  textPrimary:   '#3D3D3D',   // 主文字 — 标题、正文
  textSecondary: '#7A7A7A',   // 副文字 — 说明、标签
  textMuted:     '#A8A8A8',   // 弱文字 — 时间戳、占位符
  textInverse:   '#FEFCF9',   // 反色文字 — 用于深色背景上

  // ─ 边框 / 分割线 ─
  border:        '#E5E0DB',   // 暖灰边框
  borderLight:   '#EFEAE5',   // 淡边框
  divider:       '#EBE6E1',   // 分割线

  // ─ 状态色（莫兰迪化，低饱和） ─
  success:       '#8FBF9F',   // 柔绿
  successLight:  '#E2F0E7',   // 柔绿底
  warning:       '#E8B86D',   // 柔橙
  warningLight:  '#FBF0DB',   // 柔橙底
  error:         '#D4836A',   // 柔红
  errorLight:    '#F8E5DF',   // 柔红底
  info:          '#7EA8BE',   // 柔蓝
  infoLight:     '#DCE9F0',   // 柔蓝底

  // ─ 特殊区域 ─
  reasoning:     '#F5EFE6',   // 思考框底
  reasoningText: '#6B5C4A',   // 思考框文字
  codeBg:        '#2E3440',   // 代码块底色（柔和暗色）
  codeText:      '#D8DEE9',   // 代码文字
  quoteBg:       '#F5F2EF',   // 引用块底
  quoteBorder:   '#C5D8E4',   // 引用块左边线

  // ─ Tab 栏 ─
  tabBg:         '#FEFCF9',
  tabActive:     '#7EA8BE',
  tabInactive:   '#A8A8A8',
  tabBorder:     '#EBE6E1',

  // ─ 阴影 ─
  shadowColor:   '#00000010',
  shadowTint:    '#7EA8BE',
};

// ────────────────────────────────
// 莫兰迪 Dark（护眼）主题
// 深咖 + 米黄配色，降低屏幕灰度
// ────────────────────────────────
const dark = {
  // ─ 主色 ─
  primary:       '#8FB5C9',   // 浅蓝灰（暗模式下略提亮）
  primaryLight:  '#3A4A54',   // 选中背景
  primaryDark:   '#A8C8D8',

  // ─ 辅助色 ─
  mint:          '#7DAF93',
  mintLight:     '#2E3F34',
  apricot:       '#D4A878',
  apricotLight:  '#3F3428',
  lavender:      '#A496B4',
  lavenderLight: '#342E3E',

  // ─ 页面背景 ─
  bgPage:        '#1E1B18',   // 深咖页面底
  bgCard:        '#2A2520',   // 卡片底
  bgInput:       '#332E28',   // 输入框底
  bgElevated:    '#352F29',   // 浮起元素底

  // ─ 文字 ─
  textPrimary:   '#F5EDE0',   // 米黄主文字
  textSecondary: '#B8AFA4',   // 副文字
  textMuted:     '#807870',   // 弱文字
  textInverse:   '#1E1B18',   // 反色文字

  // ─ 边框 / 分割线 ─
  border:        '#3D3730',
  borderLight:   '#332E28',
  divider:       '#353028',

  // ─ 状态色（暗模式莫兰迪） ─
  success:       '#7DAF93',
  successLight:  '#263028',
  warning:       '#D4A878',
  warningLight:  '#332A1E',
  error:         '#C47B64',
  errorLight:    '#332220',
  info:          '#8FB5C9',
  infoLight:     '#243038',

  // ─ 特殊区域 ─
  reasoning:     '#2E2920',
  reasoningText: '#C8BBA8',
  codeBg:        '#1A1E24',
  codeText:      '#D8DEE9',
  quoteBg:       '#282420',
  quoteBorder:   '#5E8CA5',

  // ─ Tab 栏 ─
  tabBg:         '#2A2520',
  tabActive:     '#8FB5C9',
  tabInactive:   '#807870',
  tabBorder:     '#3D3730',

  // ─ 阴影 ─
  shadowColor:   '#00000030',
  shadowTint:    '#8FB5C9',
};

/** 主题类型 */
export type ThemeColors = typeof light;

/** 获取主题色 */
export function getTheme(darkMode: boolean): ThemeColors {
  return darkMode ? dark : light;
}

/**
 * useTheme hook — 根据系统配色返回对应主题
 * 用法：const colors = useTheme();
 */
export function useTheme(): ThemeColors {
  const scheme = useColorScheme();
  return scheme === 'dark' ? dark : light;
}

/**
 * 静态导出默认亮色主题（用于 StyleSheet.create 等非 hook 场景）
 * 如需动态切换，请使用 useTheme()
 */
export const colors = light;

/** 导出暗色主题常量（用于 StyleSheet.create 中引用暗色值） */
export const darkColors = dark;
