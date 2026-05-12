export interface ProblemVideoModelRoleConfig {
  providerId: string;
  model: string;
  apiKey?: string;
  baseUrl?: string;
  providerType?: string;
  requiresApiKey?: boolean;
  isServerConfigured?: boolean;
}

export interface ProblemVideoModelConfig {
  text: ProblemVideoModelRoleConfig;
  vision: ProblemVideoModelRoleConfig;
  ocr: ProblemVideoModelRoleConfig;
}
