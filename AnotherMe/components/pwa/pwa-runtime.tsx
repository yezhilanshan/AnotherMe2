'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Download, RefreshCw, Share, X } from 'lucide-react';
import { Button } from '@/components/ui/button';

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
};

const INSTALL_DISMISSED_KEY = 'anotherme-pwa-install-dismissed-at';
const INSTALL_DISMISS_TTL = 7 * 24 * 60 * 60 * 1000;

function isStandaloneDisplay() {
  const navigatorWithStandalone = window.navigator as Navigator & { standalone?: boolean };

  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    window.matchMedia('(display-mode: fullscreen)').matches ||
    navigatorWithStandalone.standalone === true
  );
}

function installPromptDismissedRecently() {
  const dismissedAt = window.localStorage.getItem(INSTALL_DISMISSED_KEY);
  if (!dismissedAt) return false;

  const timestamp = Number(dismissedAt);
  return Number.isFinite(timestamp) && Date.now() - timestamp < INSTALL_DISMISS_TTL;
}

function isIosSafari() {
  const navigatorWithTouch = window.navigator as Navigator & { maxTouchPoints?: number };
  const userAgent = window.navigator.userAgent.toLowerCase();
  const isIos =
    /iphone|ipad|ipod/.test(userAgent) ||
    (window.navigator.platform === 'MacIntel' && Number(navigatorWithTouch.maxTouchPoints) > 1);
  const isSafari = /safari/.test(userAgent) && !/crios|fxios|edgios|chrome|android/.test(userAgent);

  return isIos && isSafari;
}

export function PwaRuntime() {
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [showInstallBanner, setShowInstallBanner] = useState(false);
  const [showIosInstallHint, setShowIosInstallHint] = useState(false);
  const [updateWaiting, setUpdateWaiting] = useState<ServiceWorker | null>(null);

  const canShowInstall = useMemo(() => Boolean(installPrompt && showInstallBanner), [installPrompt, showInstallBanner]);

  useEffect(() => {
    if (process.env.NODE_ENV !== 'production') {
      return;
    }

    if (!('serviceWorker' in navigator)) {
      return;
    }

    let mounted = true;
    let refreshing = false;

    const registerServiceWorker = () => {
      navigator.serviceWorker
        .register('/sw.js')
        .then((registration) => {
          if (!mounted) return;

          if (registration.waiting) {
            setUpdateWaiting(registration.waiting);
          }

          registration.addEventListener('updatefound', () => {
            const installingWorker = registration.installing;
            if (!installingWorker) return;

            installingWorker.addEventListener('statechange', () => {
              if (installingWorker.state === 'installed' && navigator.serviceWorker.controller) {
                setUpdateWaiting(installingWorker);
              }
            });
          });
        })
        .catch((error) => {
          console.warn('Service worker registration failed', error);
        });
    };

    const handleControllerChange = () => {
      if (refreshing) return;
      refreshing = true;
      window.location.reload();
    };

    if (document.readyState === 'complete') {
      registerServiceWorker();
    } else {
      window.addEventListener('load', registerServiceWorker);
    }

    navigator.serviceWorker.addEventListener('controllerchange', handleControllerChange);

    return () => {
      mounted = false;
      window.removeEventListener('load', registerServiceWorker);
      navigator.serviceWorker.removeEventListener('controllerchange', handleControllerChange);
    };
  }, []);

  useEffect(() => {
    const handleBeforeInstallPrompt = (event: Event) => {
      event.preventDefault();

      if (isStandaloneDisplay() || installPromptDismissedRecently()) {
        return;
      }

      setInstallPrompt(event as BeforeInstallPromptEvent);
      setShowInstallBanner(true);
    };

    const handleAppInstalled = () => {
      setInstallPrompt(null);
      setShowInstallBanner(false);
      window.localStorage.removeItem(INSTALL_DISMISSED_KEY);
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    window.addEventListener('appinstalled', handleAppInstalled);

    const iosHintTimer = window.setTimeout(() => {
      if (isIosSafari() && !isStandaloneDisplay() && !installPromptDismissedRecently()) {
        setShowIosInstallHint(true);
      }
    }, 1200);

    return () => {
      window.clearTimeout(iosHintTimer);
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
      window.removeEventListener('appinstalled', handleAppInstalled);
    };
  }, []);

  const dismissInstall = useCallback(() => {
    window.localStorage.setItem(INSTALL_DISMISSED_KEY, String(Date.now()));
    setShowInstallBanner(false);
    setShowIosInstallHint(false);
  }, []);

  const installApp = useCallback(async () => {
    if (!installPrompt) return;

    setShowInstallBanner(false);
    await installPrompt.prompt();
    await installPrompt.userChoice;
    setInstallPrompt(null);
  }, [installPrompt]);

  const activateUpdate = useCallback(() => {
    updateWaiting?.postMessage({ type: 'SKIP_WAITING' });
    setUpdateWaiting(null);
  }, [updateWaiting]);

  if (!canShowInstall && !showIosInstallHint && !updateWaiting) {
    return null;
  }

  return (
    <div className="fixed inset-x-3 bottom-3 pb-safe z-50 mx-auto flex max-w-md flex-col gap-2">
      {updateWaiting && (
        <div className="rounded-lg border border-border bg-popover p-3 text-popover-foreground shadow-lg">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm font-semibold">有新版本可用</p>
              <p className="mt-0.5 text-xs text-muted-foreground">刷新后即可使用最新内容。</p>
            </div>
            <Button size="sm" onClick={activateUpdate}>
              <RefreshCw className="h-4 w-4" />
              刷新
            </Button>
          </div>
        </div>
      )}

      {canShowInstall && (
        <div className="rounded-lg border border-border bg-popover p-3 text-popover-foreground shadow-lg">
          <div className="flex items-center gap-3">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold">安装镜我</p>
              <p className="mt-0.5 text-xs text-muted-foreground">添加到主屏幕后可独立窗口打开。</p>
            </div>
            <Button size="sm" onClick={installApp}>
              <Download className="h-4 w-4" />
              安装
            </Button>
            <Button size="icon-sm" variant="ghost" aria-label="关闭安装提示" onClick={dismissInstall}>
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}

      {showIosInstallHint && (
        <div className="rounded-lg border border-border bg-popover p-3 text-popover-foreground shadow-lg">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
              <Share className="h-4 w-4" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold">添加镜我到主屏幕</p>
              <p className="mt-0.5 text-xs text-muted-foreground">在 Safari 分享菜单中选择“添加到主屏幕”。</p>
            </div>
            <Button size="icon-sm" variant="ghost" aria-label="关闭安装提示" onClick={dismissInstall}>
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
