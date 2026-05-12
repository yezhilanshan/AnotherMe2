import { Bell, Palette, Sparkles, UserCircle } from 'lucide-react';
import type { NotificationSettings, ProfileExtras } from './types';

export const PROFILE_EXTRA_STORAGE_KEY = 'anotherme:dashboard:profile:extra';
export const PROFILE_EXTRA_LEGACY_STORAGE_KEY = 'openmaic:dashboard:profile:extra';
export const NOTIFICATION_STORAGE_KEY = 'anotherme:dashboard:settings:notifications';
export const NOTIFICATION_LEGACY_STORAGE_KEY = 'openmaic:dashboard:settings:notifications';

export const DEFAULT_PROFILE_EXTRAS: ProfileExtras = {
  grade: '',
  email: '',
  phone: '',
};

export const DEFAULT_NOTIFICATIONS: NotificationSettings = {
  classReminder: true,
  messagePush: true,
  weeklyDigest: false,
  aiSuggestion: true,
};

export const sectionIcons = {
  profile: UserCircle,
  ai: Sparkles,
  notifications: Bell,
  appearance: Palette,
};

export const sectionLabels = {
  profile: '个人资料',
  ai: 'AI 偏好',
  notifications: '通知设置',
  appearance: '外观设置',
};

export const sectionDescriptions = {
  profile: '管理您的个人信息和头像',
  ai: '配置模型提供商和 API 设置',
  notifications: '自定义消息提醒方式',
  appearance: '调整界面主题和显示',
};
