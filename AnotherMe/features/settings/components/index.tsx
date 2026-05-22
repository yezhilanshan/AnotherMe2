'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  X,
  Settings,
  Languages,
  Volume2,
  Mic,
  FileText,
  Image as ImageIcon,
  Video,
  Globe,
  Eye,
  EyeOff,
  Loader2,
  Zap,
  CheckCircle2,
  XCircle,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useI18n } from '@/lib/hooks/use-i18n';
import { useSettingsStore } from '@/lib/store/settings';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { SettingsSection } from '@/lib/types/settings';
import type { ProviderId } from '@/lib/types/provider';
import type { TTSProviderId } from '@/lib/audio/types';
import type { ASRProviderId } from '@/lib/audio/types';
import type { PDFProviderId } from '@/lib/pdf/types';
import type { ImageProviderId, VideoProviderId } from '@/lib/media/types';
import type { WebSearchProviderId } from '@/lib/web-search/types';
import { TTS_PROVIDERS } from '@/lib/audio/constants';
import { ASR_PROVIDERS } from '@/lib/audio/constants';
import { PDF_PROVIDERS } from '@/lib/pdf/constants';
import { IMAGE_PROVIDERS } from '@/lib/media/image-providers';
import { VIDEO_PROVIDERS } from '@/lib/media/video-providers';
import { WEB_SEARCH_PROVIDERS } from '@/lib/web-search/constants';
import { PROVIDERS } from '@/lib/ai/providers';
import { TTSSettings } from './tts-settings';
import { ASRSettings } from './asr-settings';
import { PDFSettings } from './pdf-settings';
import { ImageSettings } from './image-settings';
import { VideoSettings } from './video-settings';
import { WebSearchSettings } from './web-search-settings';

interface SettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialSection?: SettingsSection;
}

const SECTIONS: { id: SettingsSection; label: string; icon: React.ElementType }[] = [
  { id: 'providers', label: 'settings.section.providers', icon: Settings },
  { id: 'tts', label: 'settings.section.tts', icon: Volume2 },
  { id: 'asr', label: 'settings.section.asr', icon: Mic },
  { id: 'pdf', label: 'settings.section.pdf', icon: FileText },
  { id: 'image', label: 'settings.section.image', icon: ImageIcon },
  { id: 'video', label: 'settings.section.video', icon: Video },
  { id: 'web-search', label: 'settings.section.webSearch', icon: Globe },
  { id: 'general', label: 'settings.section.general', icon: Settings },
];

export function SettingsDialog({ open, onOpenChange, initialSection = 'providers' }: SettingsDialogProps) {
  const { t, locale, setLocale } = useI18n();
  const [activeSection, setActiveSection] = useState<SettingsSection>(initialSection);
  const [mounted, setMounted] = useState(false);

  // Provider selection states
  const providerId = useSettingsStore((s) => s.providerId);
  const modelId = useSettingsStore((s) => s.modelId);
  const providersConfig = useSettingsStore((s) => s.providersConfig);
  const setProviderId = useSettingsStore((s) => s.setProvider);
  const setModel = useSettingsStore((s) => s.setModel);
  const setProviderConfig = useSettingsStore((s) => s.setProviderConfig);

  const ttsProviderId = useSettingsStore((s) => s.ttsProviderId);
  const ttsProvidersConfig = useSettingsStore((s) => s.ttsProvidersConfig);
  const setTTSProviderId = useSettingsStore((s) => s.setTTSProvider);

  const asrProviderId = useSettingsStore((s) => s.asrProviderId);
  const asrProvidersConfig = useSettingsStore((s) => s.asrProvidersConfig);
  const setASRProviderId = useSettingsStore((s) => s.setASRProvider);

  const pdfProviderId = useSettingsStore((s) => s.pdfProviderId);
  const pdfProvidersConfig = useSettingsStore((s) => s.pdfProvidersConfig);
  const setPDFProviderId = useSettingsStore((s) => s.setPDFProvider);

  const imageProviderId = useSettingsStore((s) => s.imageProviderId);
  const imageProvidersConfig = useSettingsStore((s) => s.imageProvidersConfig);
  const setImageProviderId = useSettingsStore((s) => s.setImageProvider);

  const videoProviderId = useSettingsStore((s) => s.videoProviderId);
  const videoProvidersConfig = useSettingsStore((s) => s.videoProvidersConfig);
  const setVideoProviderId = useSettingsStore((s) => s.setVideoProvider);

  const webSearchProviderId = useSettingsStore((s) => s.webSearchProviderId);
  const webSearchProvidersConfig = useSettingsStore((s) => s.webSearchProvidersConfig);
  const setWebSearchProviderId = useSettingsStore((s) => s.setWebSearchProvider);

  const asrLanguage = useSettingsStore((s) => s.asrLanguage);
  const setASRLanguage = useSettingsStore((s) => s.setASRLanguage);

  const ttsVoice = useSettingsStore((s) => s.ttsVoice);
  const setTTSVoice = useSettingsStore((s) => s.setTTSVoice);
  const ttsSpeed = useSettingsStore((s) => s.ttsSpeed);
  const setTTSSpeed = useSettingsStore((s) => s.setTTSSpeed);

  const providerConfig = providersConfig[providerId];
  const providerModels = providerConfig?.models ?? [];
  const providerFallbackModel = providerModels[0]?.id || providerConfig?.serverModels?.[0] || '';
  const isProviderServerConfigured = !!providerConfig?.isServerConfigured;

  const [showProviderApiKey, setShowProviderApiKey] = useState(false);
  const [providerModelDraft, setProviderModelDraft] = useState('');
  const [providerTestStatus, setProviderTestStatus] = useState<'idle' | 'testing' | 'success' | 'error'>('idle');
  const [providerTestMessage, setProviderTestMessage] = useState('');

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (open) {
      setActiveSection(initialSection);
    }
  }, [open, initialSection]);

  useEffect(() => {
    setProviderModelDraft(modelId || providerFallbackModel);
    setShowProviderApiKey(false);
    setProviderTestStatus('idle');
    setProviderTestMessage('');
  }, [providerId, modelId, providerFallbackModel]);

  const handleProviderModelCommit = () => {
    const trimmed = providerModelDraft.trim();
    if (!trimmed) return;
    const existing = providerConfig?.models ?? [];
    if (!existing.some((model) => model.id === trimmed)) {
      setProviderConfig(providerId, {
        models: [...existing, { id: trimmed, name: trimmed }],
      });
    }
    setModel(providerId, trimmed);
  };

  const handleTestProviderConnection = async () => {
    setProviderTestStatus('testing');
    setProviderTestMessage('');

    handleProviderModelCommit();

    const testModelId = providerModelDraft.trim() || providerFallbackModel;
    if (!testModelId) {
      setProviderTestStatus('error');
      setProviderTestMessage(t('settings.noModelsAvailable'));
      return;
    }

    try {
      const response = await fetch('/api/verify-model', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          apiKey: providerConfig?.apiKey || '',
          baseUrl: providerConfig?.baseUrl || '',
          model: `${providerId}:${testModelId}`,
          providerType: providerConfig?.type || PROVIDERS[providerId]?.type,
          requiresApiKey: providerConfig?.requiresApiKey ?? PROVIDERS[providerId]?.requiresApiKey,
        }),
      });
      const data = await response.json();
      if (data.success) {
        setProviderTestStatus('success');
        setProviderTestMessage(t('settings.connectionSuccess'));
      } else {
        setProviderTestStatus('error');
        setProviderTestMessage(data.error || t('settings.connectionFailed'));
      }
    } catch (_error) {
      setProviderTestStatus('error');
      setProviderTestMessage(t('settings.connectionFailed'));
    }
  };

  const providerIds = useMemo(
    () =>
      (Object.keys(providersConfig) as ProviderId[]).sort((a, b) =>
        (providersConfig[a]?.name || a).localeCompare(providersConfig[b]?.name || b, 'zh-CN'),
      ),
    [providersConfig],
  );

  const ttsProviderIds = useMemo(
    () =>
      (Object.keys(TTS_PROVIDERS) as TTSProviderId[]).sort((a, b) =>
        (TTS_PROVIDERS[a]?.name || a).localeCompare(TTS_PROVIDERS[b]?.name || b, 'zh-CN'),
      ),
    [],
  );

  const asrProviderIds = useMemo(
    () =>
      (Object.keys(ASR_PROVIDERS) as ASRProviderId[]).sort((a, b) =>
        (ASR_PROVIDERS[a]?.name || a).localeCompare(ASR_PROVIDERS[b]?.name || b, 'zh-CN'),
      ),
    [],
  );

  const pdfProviderIds = useMemo(
    () =>
      (Object.keys(PDF_PROVIDERS) as PDFProviderId[]).sort((a, b) =>
        (PDF_PROVIDERS[a]?.name || a).localeCompare(PDF_PROVIDERS[b]?.name || b, 'zh-CN'),
      ),
    [],
  );

  const imageProviderIds = useMemo(
    () =>
      (Object.keys(IMAGE_PROVIDERS) as ImageProviderId[]).sort((a, b) =>
        (IMAGE_PROVIDERS[a]?.name || a).localeCompare(IMAGE_PROVIDERS[b]?.name || b, 'zh-CN'),
      ),
    [],
  );

  const videoProviderIds = useMemo(
    () =>
      (Object.keys(VIDEO_PROVIDERS) as VideoProviderId[]).sort((a, b) =>
        (VIDEO_PROVIDERS[a]?.name || a).localeCompare(VIDEO_PROVIDERS[b]?.name || b, 'zh-CN'),
      ),
    [],
  );

  const webSearchProviderIds = useMemo(
    () =>
      (Object.keys(WEB_SEARCH_PROVIDERS) as WebSearchProviderId[]).sort((a, b) =>
        (WEB_SEARCH_PROVIDERS[a]?.name || a).localeCompare(WEB_SEARCH_PROVIDERS[b]?.name || b, 'zh-CN'),
      ),
    [],
  );

  const currentTTSProvider = TTS_PROVIDERS[ttsProviderId];
  const currentTTSVoice = currentTTSProvider?.voices.find((v) => v.id === ttsVoice);

  if (!mounted) return null;

  return (
    <>
      {open && (
        <div className="fixed inset-0 z-50 flex items-start justify-center pt-12 sm:pt-16">
          <div
            className="absolute inset-0 bg-[rgba(61,43,16,0.35)] backdrop-blur-sm"
            onClick={() => onOpenChange(false)}
          />
          <div className="relative z-10 flex w-full max-w-6xl mx-4 h-[calc(var(--app-dvh)-6rem)] max-h-[800px] rounded-3xl overflow-hidden shadow-[0_48px_120px_rgba(61,43,16,0.28)]">
            {/* Sidebar */}
            <div className="w-60 shrink-0 bg-[rgba(255,252,247,0.98)] border-r border-[rgba(133,88,34,0.1)] flex flex-col">
              <div className="p-5 border-b border-[rgba(133,88,34,0.08)]">
                <h2 className="text-base font-bold text-[rgba(46,39,33,0.92)] tracking-tight">{t('settings.title')}</h2>
                <p className="text-xs text-[rgba(123,111,99,0.65)] mt-1 leading-relaxed">{t('settings.subtitle')}</p>
              </div>
              <nav className="flex-1 overflow-y-auto p-3 space-y-0.5">
                {SECTIONS.map((section) => {
                  const Icon = section.icon;
                  const isActive = activeSection === section.id;
                  return (
                    <button
                      key={section.id}
                      onClick={() => setActiveSection(section.id)}
                      className={cn(
                        'w-full flex items-center gap-3 px-3.5 py-2.5 rounded-lg text-sm font-medium transition-all duration-200',
                        isActive
                          ? 'bg-[rgba(71,54,31,0.92)] text-white shadow-[0_4px_12px_rgba(71,54,31,0.18)]'
                          : 'text-[rgba(93,80,68,0.75)] hover:bg-[rgba(248,242,234,0.72)] hover:text-[rgba(46,39,33,0.92)]'
                      )}
                    >
                      <span className={cn(
                        'flex items-center justify-center w-7 h-7 rounded-md transition-colors',
                        isActive ? 'bg-white/15' : 'bg-[rgba(133,88,34,0.06)]'
                      )}>
                        <Icon className="h-3.5 w-3.5" />
                      </span>
                      <span className="truncate">{t(section.label)}</span>
                    </button>
                  );
                })}
              </nav>
            </div>

            {/* Content */}
            <div className="flex-1 bg-[rgba(255,252,247,0.95)] flex flex-col min-w-0">
              {/* Header */}
              <div className="flex items-center justify-between px-6 py-4 border-b border-[rgba(133,88,34,0.08)]">
                <h3 className="text-sm font-semibold text-[rgba(46,39,33,0.92)] tracking-wide">
                  {t(SECTIONS.find((s) => s.id === activeSection)?.label || '')}
                </h3>
                <button
                  onClick={() => onOpenChange(false)}
                  className="p-1.5 rounded-lg text-[rgba(120,106,93,0.55)] hover:text-[rgba(93,80,68,0.92)] hover:bg-[rgba(248,242,234,0.85)] transition-all"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              {/* Scrollable content */}
              <div className="flex-1 overflow-y-auto p-6 scrollbar-thin">
                {activeSection === 'providers' && (
                  <div className="space-y-5 max-w-3xl">
                    <div className="rounded-2xl border border-[rgba(133,88,34,0.12)] bg-[rgba(255,252,247,0.85)] p-5 shadow-[0_8px_24px_rgba(61,43,16,0.04)] backdrop-blur-sm">
                      <div className="space-y-3">
                        <Label className="text-sm font-semibold text-[rgba(93,80,68,0.92)] tracking-wide block">
                          {t('settings.selectProvider')}
                        </Label>
                        <Select value={providerId} onValueChange={(v) => setProviderId(v as ProviderId)}>
                          <SelectTrigger className="h-11 rounded-xl border-[rgba(133,88,34,0.14)] bg-[rgba(255,253,250,0.95)] text-sm text-[rgba(46,39,33,0.92)] focus:border-[rgba(193,154,110,0.6)] focus:ring-2 focus:ring-[rgba(193,154,110,0.12)]">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent className="rounded-xl border-[rgba(133,88,34,0.14)] bg-[rgba(255,252,247,0.98)]">
                            {providerIds.map((id) => (
                              <SelectItem
                                key={id}
                                value={id}
                                className="text-sm text-[rgba(46,39,33,0.92)] focus:bg-[rgba(248,242,234,0.85)]"
                              >
                                {providersConfig[id]?.name || id}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    </div>

                    <div className="rounded-2xl border border-[rgba(133,88,34,0.12)] bg-[rgba(255,252,247,0.85)] p-5 shadow-[0_8px_24px_rgba(61,43,16,0.04)] backdrop-blur-sm">
                      {isProviderServerConfigured && (
                        <div className="mb-4 rounded-2xl border border-[rgba(100,130,180,0.25)] bg-[rgba(235,245,255,0.72)] p-4 text-sm text-[rgba(60,90,130,0.92)] backdrop-blur-sm">
                          <div className="flex items-start gap-3">
                            <div className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[rgba(100,130,180,0.18)]">
                              <CheckCircle2 className="h-3 w-3 text-[rgba(60,90,130,0.92)]" />
                            </div>
                            <p className="leading-relaxed">{t('settings.serverConfiguredNotice')}</p>
                          </div>
                        </div>
                      )}

                      <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
                        <div className="space-y-2.5">
                          <Label className="text-sm font-semibold text-[rgba(93,80,68,0.92)] tracking-wide block">
                            {t('settings.modelName')}
                          </Label>
                          <Input
                            name={`llm-model-${providerId}`}
                            autoComplete="off"
                            autoCapitalize="none"
                            autoCorrect="off"
                            spellCheck={false}
                            placeholder={providerFallbackModel || '输入模型名'}
                            value={providerModelDraft}
                            onChange={(e) => setProviderModelDraft(e.target.value)}
                            onBlur={handleProviderModelCommit}
                            className="h-11 rounded-xl border-[rgba(133,88,34,0.14)] bg-[rgba(255,253,250,0.95)] text-sm text-[rgba(46,39,33,0.92)] placeholder:text-[rgba(115,102,88,0.5)] focus:border-[rgba(193,154,110,0.6)] focus:ring-2 focus:ring-[rgba(193,154,110,0.12)]"
                            list={`llm-models-${providerId}`}
                          />
                          {providerModels.length > 0 && (
                            <datalist id={`llm-models-${providerId}`}>
                              {providerModels.map((model) => (
                                <option key={model.id} value={model.id} />
                              ))}
                            </datalist>
                          )}
                        </div>

                        <div className="space-y-2.5">
                          <Label className="text-sm font-semibold text-[rgba(93,80,68,0.92)] tracking-wide block">
                            {t('settings.apiKey')}
                          </Label>
                          <div className="relative">
                            <Input
                              name={`llm-api-key-${providerId}`}
                              type={showProviderApiKey ? 'text' : 'password'}
                              autoComplete="new-password"
                              autoCapitalize="none"
                              autoCorrect="off"
                              spellCheck={false}
                              placeholder={
                                isProviderServerConfigured ? t('settings.optionalOverride') : t('settings.enterApiKey')
                              }
                              value={providerConfig?.apiKey || ''}
                              onChange={(e) =>
                                setProviderConfig(providerId, {
                                  apiKey: e.target.value,
                                })
                              }
                              className="h-11 rounded-xl border-[rgba(133,88,34,0.14)] bg-[rgba(255,253,250,0.95)] pr-10 text-sm font-mono text-[rgba(46,39,33,0.92)] placeholder:text-[rgba(115,102,88,0.5)] focus:border-[rgba(193,154,110,0.6)] focus:ring-2 focus:ring-[rgba(193,154,110,0.12)]"
                            />
                            <button
                              type="button"
                              onClick={() => setShowProviderApiKey(!showProviderApiKey)}
                              className="absolute right-3 top-1/2 -translate-y-1/2 text-[rgba(120,106,93,0.65)] hover:text-[rgba(93,80,68,0.92)] transition-colors"
                            >
                              {showProviderApiKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                            </button>
                          </div>
                        </div>

                        <div className="space-y-2.5">
                          <Label className="text-sm font-semibold text-[rgba(93,80,68,0.92)] tracking-wide block">
                            {t('settings.baseUrl')}
                          </Label>
                          <Input
                            name={`llm-base-url-${providerId}`}
                            type="url"
                            autoComplete="off"
                            autoCapitalize="none"
                            autoCorrect="off"
                            spellCheck={false}
                            placeholder={providerConfig?.defaultBaseUrl || PROVIDERS[providerId]?.defaultBaseUrl}
                            value={providerConfig?.baseUrl || ''}
                            onChange={(e) =>
                              setProviderConfig(providerId, {
                                baseUrl: e.target.value,
                              })
                            }
                            className="h-11 rounded-xl border-[rgba(133,88,34,0.14)] bg-[rgba(255,253,250,0.95)] text-sm text-[rgba(46,39,33,0.92)] placeholder:text-[rgba(115,102,88,0.5)] focus:border-[rgba(193,154,110,0.6)] focus:ring-2 focus:ring-[rgba(193,154,110,0.12)]"
                          />
                        </div>
                      </div>

                      {(() => {
                        const effectiveBaseUrl =
                          providerConfig?.baseUrl || providerConfig?.defaultBaseUrl || PROVIDERS[providerId]?.defaultBaseUrl || '';
                        if (!effectiveBaseUrl) return null;
                        let endpointPath = '';
                        switch (providerConfig?.type || PROVIDERS[providerId]?.type) {
                          case 'openai':
                            endpointPath = '/chat/completions';
                            break;
                          case 'anthropic':
                            endpointPath = '/messages';
                            break;
                          case 'google':
                            endpointPath = '/models/[model]';
                            break;
                        }
                        if (!endpointPath) return null;
                        return (
                          <div className="mt-4 rounded-xl bg-[rgba(248,242,234,0.72)] px-4 py-3">
                            <p className="text-xs text-[rgba(123,111,99,0.78)] break-all">
                              <span className="font-medium text-[rgba(93,80,68,0.85)]">{t('settings.requestUrl')}:</span>{' '}
                              <span className="font-mono text-[rgba(100,85,70,0.72)]">{effectiveBaseUrl + endpointPath}</span>
                            </p>
                          </div>
                        );
                      })()}

                      <div className="mt-4 flex items-center gap-3">
                        <Button
                          variant="outline"
                          onClick={handleTestProviderConnection}
                          disabled={
                            providerTestStatus === 'testing' ||
                            ((providerConfig?.requiresApiKey ?? PROVIDERS[providerId]?.requiresApiKey) &&
                              !providerConfig?.apiKey?.trim() &&
                              !isProviderServerConfigured)
                          }
                          className="gap-2 h-10 px-4 rounded-xl border-[rgba(133,88,34,0.14)] bg-[rgba(255,253,250,0.95)] text-[rgba(71,54,31,0.92)] hover:bg-[rgba(248,242,234,0.85)] transition-all"
                        >
                          {providerTestStatus === 'testing' ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <Zap className="h-4 w-4" />
                          )}
                          {t('settings.testConnection')}
                        </Button>
                      </div>

                      {providerTestMessage && (
                        <div
                          className={cn(
                            'mt-3 rounded-xl p-4 text-sm overflow-hidden backdrop-blur-sm',
                            providerTestStatus === 'success' &&
                              'bg-[rgba(220,245,220,0.72)] text-[rgba(50,110,50,0.92)] border border-[rgba(120,180,120,0.25)]',
                            providerTestStatus === 'error' &&
                              'bg-[rgba(255,230,230,0.72)] text-[rgba(150,60,60,0.92)] border border-[rgba(220,140,140,0.25)]',
                          )}
                        >
                          <div className="flex items-start gap-3 min-w-0">
                            <div
                              className={cn(
                                'mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full',
                                providerTestStatus === 'success'
                                  ? 'bg-[rgba(120,180,120,0.2)]'
                                  : 'bg-[rgba(220,140,140,0.2)]',
                              )}
                            >
                              {providerTestStatus === 'success' && <CheckCircle2 className="h-3 w-3" />}
                              {providerTestStatus === 'error' && <XCircle className="h-3 w-3" />}
                            </div>
                            <p className="flex-1 min-w-0 break-all leading-relaxed">{providerTestMessage}</p>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {activeSection === 'tts' && (
                  <div className="space-y-5">
                    <div className="rounded-2xl border border-[rgba(133,88,34,0.12)] bg-[rgba(255,252,247,0.85)] p-5 shadow-[0_8px_24px_rgba(61,43,16,0.04)] backdrop-blur-sm">
                      <div className="space-y-3">
                        <label className="text-sm font-semibold text-[rgba(93,80,68,0.92)] tracking-wide block">
                          {t('settings.selectTTSProvider')}
                        </label>
                        <Select value={ttsProviderId} onValueChange={(v) => setTTSProviderId(v as TTSProviderId)}>
                          <SelectTrigger className="h-11 rounded-xl border-[rgba(133,88,34,0.14)] bg-[rgba(255,253,250,0.95)] text-sm text-[rgba(46,39,33,0.92)] focus:border-[rgba(193,154,110,0.6)] focus:ring-2 focus:ring-[rgba(193,154,110,0.12)]">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent className="rounded-xl border-[rgba(133,88,34,0.14)] bg-[rgba(255,252,247,0.98)]">
                            {ttsProviderIds.map((id) => (
                              <SelectItem
                                key={id}
                                value={id}
                                className="text-sm text-[rgba(46,39,33,0.92)] focus:bg-[rgba(248,242,234,0.85)]"
                              >
                                {TTS_PROVIDERS[id]?.name || id}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    </div>

                    {/* TTS Voice Selection */}
                    {currentTTSProvider && currentTTSProvider.voices.length > 0 && (
                      <div className="rounded-2xl border border-[rgba(133,88,34,0.12)] bg-[rgba(255,252,247,0.85)] p-5 shadow-[0_8px_24px_rgba(61,43,16,0.04)] backdrop-blur-sm">
                        <div className="space-y-3">
                          <label className="text-sm font-semibold text-[rgba(93,80,68,0.92)] tracking-wide block">
                            {t('settings.ttsVoice')}
                          </label>
                          <Select value={ttsVoice} onValueChange={setTTSVoice}>
                            <SelectTrigger className="h-11 rounded-xl border-[rgba(133,88,34,0.14)] bg-[rgba(255,253,250,0.95)] text-sm text-[rgba(46,39,33,0.92)] focus:border-[rgba(193,154,110,0.6)] focus:ring-2 focus:ring-[rgba(193,154,110,0.12)]">
                              <SelectValue placeholder={t('settings.selectVoice')} />
                            </SelectTrigger>
                            <SelectContent className="rounded-xl border-[rgba(133,88,34,0.14)] bg-[rgba(255,252,247,0.98)] max-h-[280px]">
                              {currentTTSProvider.voices.map((voice) => (
                                <SelectItem
                                  key={voice.id}
                                  value={voice.id}
                                  className="text-sm text-[rgba(46,39,33,0.92)] focus:bg-[rgba(248,242,234,0.85)]"
                                >
                                  {voice.name}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          {currentTTSVoice && (
                            <p className="text-xs text-[rgba(123,111,99,0.55)] leading-relaxed">
                              {currentTTSVoice.description}
                            </p>
                          )}
                        </div>
                      </div>
                    )}

                    {/* TTS Speed Control */}
                    <div className="rounded-2xl border border-[rgba(133,88,34,0.12)] bg-[rgba(255,252,247,0.85)] p-5 shadow-[0_8px_24px_rgba(61,43,16,0.04)] backdrop-blur-sm">
                      <div className="space-y-4">
                        <div className="flex items-center justify-between">
                          <label className="text-sm font-semibold text-[rgba(93,80,68,0.92)] tracking-wide">
                            {t('settings.ttsSpeed')}
                          </label>
                          <span className="text-sm font-medium text-[rgba(71,54,31,0.92)] px-3 py-1 rounded-lg bg-[rgba(248,242,234,0.85)]">
                            {ttsSpeed.toFixed(1)}x
                          </span>
                        </div>
                        <input
                          type="range"
                          min="0.5"
                          max="2.0"
                          step="0.1"
                          value={ttsSpeed}
                          onChange={(e) => setTTSSpeed(parseFloat(e.target.value))}
                          className="w-full h-2 bg-[rgba(133,88,34,0.12)] rounded-lg appearance-none cursor-pointer accent-[rgba(71,54,31,0.92)]"
                        />
                        <div className="flex justify-between text-xs text-[rgba(123,111,99,0.55)]">
                          <span>0.5x</span>
                          <span>1.0x</span>
                          <span>1.5x</span>
                          <span>2.0x</span>
                        </div>
                      </div>
                    </div>

                    <TTSSettings selectedProviderId={ttsProviderId} />
                  </div>
                )}

                {activeSection === 'asr' && (
                  <div className="space-y-5">
                    <div className="rounded-2xl border border-[rgba(133,88,34,0.12)] bg-[rgba(255,252,247,0.85)] p-5 shadow-[0_8px_24px_rgba(61,43,16,0.04)] backdrop-blur-sm">
                      <div className="space-y-3">
                        <label className="text-sm font-semibold text-[rgba(93,80,68,0.92)] tracking-wide block">
                          {t('settings.selectASRProvider')}
                        </label>
                        <Select value={asrProviderId} onValueChange={(v) => setASRProviderId(v as ASRProviderId)}>
                          <SelectTrigger className="h-11 rounded-xl border-[rgba(133,88,34,0.14)] bg-[rgba(255,253,250,0.95)] text-sm text-[rgba(46,39,33,0.92)] focus:border-[rgba(193,154,110,0.6)] focus:ring-2 focus:ring-[rgba(193,154,110,0.12)]">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent className="rounded-xl border-[rgba(133,88,34,0.14)] bg-[rgba(255,252,247,0.98)]">
                            {asrProviderIds.map((id) => (
                              <SelectItem
                                key={id}
                                value={id}
                                className="text-sm text-[rgba(46,39,33,0.92)] focus:bg-[rgba(248,242,234,0.85)]"
                              >
                                {ASR_PROVIDERS[id]?.name || id}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    </div>

                    <div className="rounded-2xl border border-[rgba(133,88,34,0.12)] bg-[rgba(255,252,247,0.85)] p-5 shadow-[0_8px_24px_rgba(61,43,16,0.04)] backdrop-blur-sm">
                      <div className="space-y-3">
                        <label className="text-sm font-semibold text-[rgba(93,80,68,0.92)] tracking-wide block">
                          {t('settings.asrLanguage')}
                        </label>
                        <Select value={asrLanguage} onValueChange={setASRLanguage}>
                          <SelectTrigger className="h-11 rounded-xl border-[rgba(133,88,34,0.14)] bg-[rgba(255,253,250,0.95)] text-sm text-[rgba(46,39,33,0.92)] focus:border-[rgba(193,154,110,0.6)] focus:ring-2 focus:ring-[rgba(193,154,110,0.12)]">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent className="rounded-xl border-[rgba(133,88,34,0.14)] bg-[rgba(255,252,247,0.98)]">
                            <SelectItem value="zh-CN" className="text-sm text-[rgba(46,39,33,0.92)] focus:bg-[rgba(248,242,234,0.85)]">
                              {t('settings.languageZhCN')}
                            </SelectItem>
                            <SelectItem value="en-US" className="text-sm text-[rgba(46,39,33,0.92)] focus:bg-[rgba(248,242,234,0.85)]">
                              {t('settings.languageEnUS')}
                            </SelectItem>
                            <SelectItem value="ja-JP" className="text-sm text-[rgba(46,39,33,0.92)] focus:bg-[rgba(248,242,234,0.85)]">
                              {t('settings.languageJaJP')}
                            </SelectItem>
                            <SelectItem value="ko-KR" className="text-sm text-[rgba(46,39,33,0.92)] focus:bg-[rgba(248,242,234,0.85)]">
                              {t('settings.languageKoKR')}
                            </SelectItem>
                            <SelectItem value="fr-FR" className="text-sm text-[rgba(46,39,33,0.92)] focus:bg-[rgba(248,242,234,0.85)]">
                              {t('settings.languageFrFR')}
                            </SelectItem>
                            <SelectItem value="de-DE" className="text-sm text-[rgba(46,39,33,0.92)] focus:bg-[rgba(248,242,234,0.85)]">
                              {t('settings.languageDeDE')}
                            </SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>

                    <ASRSettings selectedProviderId={asrProviderId} />
                  </div>
                )}

                {activeSection === 'pdf' && (
                  <div className="space-y-5">
                    <div className="rounded-2xl border border-[rgba(133,88,34,0.12)] bg-[rgba(255,252,247,0.85)] p-5 shadow-[0_8px_24px_rgba(61,43,16,0.04)] backdrop-blur-sm">
                      <div className="space-y-3">
                        <label className="text-sm font-semibold text-[rgba(93,80,68,0.92)] tracking-wide block">
                          {t('settings.selectPDFProvider')}
                        </label>
                        <Select value={pdfProviderId} onValueChange={(v) => setPDFProviderId(v as PDFProviderId)}>
                          <SelectTrigger className="h-11 rounded-xl border-[rgba(133,88,34,0.14)] bg-[rgba(255,253,250,0.95)] text-sm text-[rgba(46,39,33,0.92)] focus:border-[rgba(193,154,110,0.6)] focus:ring-2 focus:ring-[rgba(193,154,110,0.12)]">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent className="rounded-xl border-[rgba(133,88,34,0.14)] bg-[rgba(255,252,247,0.98)]">
                            {pdfProviderIds.map((id) => (
                              <SelectItem
                                key={id}
                                value={id}
                                className="text-sm text-[rgba(46,39,33,0.92)] focus:bg-[rgba(248,242,234,0.85)]"
                              >
                                {PDF_PROVIDERS[id]?.name || id}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    </div>

                    <PDFSettings selectedProviderId={pdfProviderId} />
                  </div>
                )}

                {activeSection === 'image' && (
                  <div className="space-y-5">
                    <div className="rounded-2xl border border-[rgba(133,88,34,0.12)] bg-[rgba(255,252,247,0.85)] p-5 shadow-[0_8px_24px_rgba(61,43,16,0.04)] backdrop-blur-sm">
                      <div className="space-y-3">
                        <label className="text-sm font-semibold text-[rgba(93,80,68,0.92)] tracking-wide block">
                          {t('settings.selectImageProvider')}
                        </label>
                        <Select
                          value={imageProviderId}
                          onValueChange={(v) => setImageProviderId(v as ImageProviderId)}
                        >
                          <SelectTrigger className="h-11 rounded-xl border-[rgba(133,88,34,0.14)] bg-[rgba(255,253,250,0.95)] text-sm text-[rgba(46,39,33,0.92)] focus:border-[rgba(193,154,110,0.6)] focus:ring-2 focus:ring-[rgba(193,154,110,0.12)]">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent className="rounded-xl border-[rgba(133,88,34,0.14)] bg-[rgba(255,252,247,0.98)]">
                            {imageProviderIds.map((id) => (
                              <SelectItem
                                key={id}
                                value={id}
                                className="text-sm text-[rgba(46,39,33,0.92)] focus:bg-[rgba(248,242,234,0.85)]"
                              >
                                {IMAGE_PROVIDERS[id]?.name || id}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    </div>

                    <ImageSettings selectedProviderId={imageProviderId} />
                  </div>
                )}

                {activeSection === 'video' && (
                  <div className="space-y-5">
                    <div className="rounded-2xl border border-[rgba(133,88,34,0.12)] bg-[rgba(255,252,247,0.85)] p-5 shadow-[0_8px_24px_rgba(61,43,16,0.04)] backdrop-blur-sm">
                      <div className="space-y-3">
                        <label className="text-sm font-semibold text-[rgba(93,80,68,0.92)] tracking-wide block">
                          {t('settings.selectVideoProvider')}
                        </label>
                        <Select
                          value={videoProviderId}
                          onValueChange={(v) => setVideoProviderId(v as VideoProviderId)}
                        >
                          <SelectTrigger className="h-11 rounded-xl border-[rgba(133,88,34,0.14)] bg-[rgba(255,253,250,0.95)] text-sm text-[rgba(46,39,33,0.92)] focus:border-[rgba(193,154,110,0.6)] focus:ring-2 focus:ring-[rgba(193,154,110,0.12)]">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent className="rounded-xl border-[rgba(133,88,34,0.14)] bg-[rgba(255,252,247,0.98)]">
                            {videoProviderIds.map((id) => (
                              <SelectItem
                                key={id}
                                value={id}
                                className="text-sm text-[rgba(46,39,33,0.92)] focus:bg-[rgba(248,242,234,0.85)]"
                              >
                                {VIDEO_PROVIDERS[id]?.name || id}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    </div>

                    <VideoSettings selectedProviderId={videoProviderId} />
                  </div>
                )}

                {activeSection === 'web-search' && (
                  <div className="space-y-5">
                    <div className="rounded-2xl border border-[rgba(133,88,34,0.12)] bg-[rgba(255,252,247,0.85)] p-5 shadow-[0_8px_24px_rgba(61,43,16,0.04)] backdrop-blur-sm">
                      <div className="space-y-3">
                        <label className="text-sm font-semibold text-[rgba(93,80,68,0.92)] tracking-wide block">
                          {t('settings.selectWebSearchProvider')}
                        </label>
                        <Select
                          value={webSearchProviderId}
                          onValueChange={(v) => setWebSearchProviderId(v as WebSearchProviderId)}
                        >
                          <SelectTrigger className="h-11 rounded-xl border-[rgba(133,88,34,0.14)] bg-[rgba(255,253,250,0.95)] text-sm text-[rgba(46,39,33,0.92)] focus:border-[rgba(193,154,110,0.6)] focus:ring-2 focus:ring-[rgba(193,154,110,0.12)]">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent className="rounded-xl border-[rgba(133,88,34,0.14)] bg-[rgba(255,252,247,0.98)]">
                            {webSearchProviderIds.map((id) => (
                              <SelectItem
                                key={id}
                                value={id}
                                className="text-sm text-[rgba(46,39,33,0.92)] focus:bg-[rgba(248,242,234,0.85)]"
                              >
                                {WEB_SEARCH_PROVIDERS[id]?.name || id}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    </div>

                    <WebSearchSettings selectedProviderId={webSearchProviderId} />
                  </div>
                )}

                {activeSection === 'general' && (
                  <div className="space-y-5 max-w-3xl">
                    <div className="rounded-2xl border border-[rgba(133,88,34,0.12)] bg-[rgba(255,252,247,0.85)] p-5 shadow-[0_8px_24px_rgba(61,43,16,0.04)] backdrop-blur-sm">
                      <div className="space-y-3">
                        <label className="text-sm font-semibold text-[rgba(93,80,68,0.92)] tracking-wide flex items-center gap-2">
                          <Languages className="h-4 w-4" />
                          {t('settings.language')}
                        </label>
                        <Select value={locale} onValueChange={(v) => setLocale(v as 'zh-CN' | 'en-US')}>
                          <SelectTrigger className="h-11 rounded-xl border-[rgba(133,88,34,0.14)] bg-[rgba(255,253,250,0.95)] text-sm text-[rgba(46,39,33,0.92)] focus:border-[rgba(193,154,110,0.6)] focus:ring-2 focus:ring-[rgba(193,154,110,0.12)]">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent className="rounded-xl border-[rgba(133,88,34,0.14)] bg-[rgba(255,252,247,0.98)]">
                            <SelectItem value="zh-CN" className="text-sm text-[rgba(46,39,33,0.92)] focus:bg-[rgba(248,242,234,0.85)]">
                              简体中文
                            </SelectItem>
                            <SelectItem value="en-US" className="text-sm text-[rgba(46,39,33,0.92)] focus:bg-[rgba(248,242,234,0.85)]">
                              English
                            </SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
