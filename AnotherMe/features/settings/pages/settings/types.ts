export type SettingsSection = 'profile' | 'ai' | 'notifications' | 'appearance';

export interface ProviderMap {
  [providerId: string]: {
    baseUrl?: string;
    models?: string[];
  };
}

export interface ProvidersResponse {
  success: boolean;
  providers?: ProviderMap;
  tts?: ProviderMap;
  asr?: ProviderMap;
  pdf?: ProviderMap;
  image?: ProviderMap;
  video?: ProviderMap;
  webSearch?: ProviderMap;
  error?: string;
}

export interface HealthResponse {
  success: boolean;
  status?: string;
  version?: string;
  error?: string;
}

export interface ProfileExtras {
  grade: string;
  email: string;
  phone: string;
}

export interface NotificationSettings {
  classReminder: boolean;
  messagePush: boolean;
  weeklyDigest: boolean;
  aiSuggestion: boolean;
}
