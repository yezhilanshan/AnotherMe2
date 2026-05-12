import type { ProviderId } from '@/lib/ai/providers';
import { createLogger } from '@/lib/logger';
import {
  DEFAULT_SELECTED_AGENT_IDS,
  getDefaultProvidersConfig,
} from '@/lib/store/settings/defaults';

const log = createLogger('Settings');

// Migrate from old localStorage format
export const migrateFromOldStorage = () => {
  if (typeof window === 'undefined') return null;

  // Check if new storage already exists
  const newStorage = localStorage.getItem('settings-storage');
  if (newStorage) return null; // Already migrated or new install

  // Read old localStorage keys
  const oldLlmModel = localStorage.getItem('llmModel');
  const oldProvidersConfig = localStorage.getItem('providersConfig');
  const oldTtsModel = localStorage.getItem('ttsModel');
  const oldSelectedAgents = localStorage.getItem('selectedAgentIds');
  const oldMaxTurns = localStorage.getItem('maxTurns');

  if (!oldLlmModel && !oldProvidersConfig) return null; // No old data

  // Parse model selection
  let providerId: ProviderId = 'openai';
  let modelId = 'gpt-4o-mini';
  if (oldLlmModel) {
    const [pid, mid] = oldLlmModel.split(':');
    if (pid && mid) {
      providerId = pid as ProviderId;
      modelId = mid;
    }
  }

  // Parse providers config
  let providersConfig = getDefaultProvidersConfig();
  if (oldProvidersConfig) {
    try {
      const parsed = JSON.parse(oldProvidersConfig);
      providersConfig = { ...providersConfig, ...parsed };
    } catch (e) {
      log.error('Failed to parse old providersConfig:', e);
    }
  }

  // Parse other settings
  let ttsModel = 'openai-tts';
  if (oldTtsModel) ttsModel = oldTtsModel;

  let selectedAgentIds = [...DEFAULT_SELECTED_AGENT_IDS];
  if (oldSelectedAgents) {
    try {
      const parsed = JSON.parse(oldSelectedAgents);
      if (Array.isArray(parsed) && parsed.length > 0) {
        selectedAgentIds = parsed;
      }
    } catch (e) {
      log.error('Failed to parse old selectedAgentIds:', e);
    }
  }

  let maxTurns = '10';
  if (oldMaxTurns) maxTurns = oldMaxTurns;

  return {
    providerId,
    modelId,
    providersConfig,
    ttsModel,
    selectedAgentIds,
    maxTurns,
  };
};
