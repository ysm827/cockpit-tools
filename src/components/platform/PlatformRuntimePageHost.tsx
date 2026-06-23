import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { PlatformId } from '../../types/platform';
import type { PlatformPackageState, PlatformPackageUiEntry } from '../../types/platformPackage';
import { getPlatformPackageUiEntry } from '../../services/platformPackageService';
import './PlatformRuntimePageHost.css';

interface PlatformRuntimePageHostProps {
  platformId: PlatformId;
  state: PlatformPackageState;
  className?: string;
  tabsSlotId?: string;
  runtimeParams?: Record<string, unknown>;
}

type PlatformRemoteHostApi = {
  platformId: PlatformId;
  packageVersion: string | null;
  locale: string;
  theme: string;
  state: PlatformPackageState;
  tabsSlotId?: string;
  runtimeParams?: Record<string, unknown>;
};

type PlatformRemoteModule = {
  mount?: (
    container: HTMLElement,
    hostApi: PlatformRemoteHostApi,
  ) =>
    | void
    | (() => void)
    | { unmount?: () => void }
    | Promise<void | (() => void) | { unmount?: () => void }>;
  unmount?: (container: HTMLElement) => void;
};

function buildRemoteModuleUrl(source: string): string {
  const blob = new Blob([source], { type: 'text/javascript;charset=utf-8' });
  return URL.createObjectURL(blob);
}

function getPlatformRootClass(platformId: PlatformId): string {
  return `${platformId}-platform-ui-root`;
}

function installRemoteStyle(
  platformId: PlatformId,
  version: string,
  style: string | null | undefined,
): HTMLStyleElement | null {
  document.head.querySelectorAll('style[data-platform-remote-style]').forEach((element) => {
    if ((element as HTMLStyleElement).dataset.platformRemoteStyle === platformId) {
      element.remove();
    }
  });

  if (!style) return null;
  const element = document.createElement('style');
  element.dataset.platformRemoteStyle = platformId;
  element.dataset.platformRemoteVersion = version;
  element.textContent = style;
  document.head.appendChild(element);
  return element;
}

function resolveCleanup(
  remote: PlatformRemoteModule,
  container: HTMLElement,
  mounted: void | (() => void) | { unmount?: () => void },
): () => void {
  if (typeof mounted === 'function') {
    return mounted;
  }
  if (mounted && typeof mounted === 'object' && typeof mounted.unmount === 'function') {
    return () => mounted.unmount?.();
  }
  if (typeof remote.unmount === 'function') {
    return () => remote.unmount?.(container);
  }
  return () => {
    container.replaceChildren();
  };
}

export function PlatformRuntimePageHost({
  platformId,
  state,
  className,
  tabsSlotId,
  runtimeParams,
}: PlatformRuntimePageHostProps) {
  const { t, i18n } = useTranslation();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const cleanupRef = useRef<(() => void) | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const locale = i18n.language || 'zh-cn';

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let cancelled = false;
    let moduleUrl: string | null = null;
    let styleElement: HTMLStyleElement | null = null;
    let tabsSlotElement: HTMLElement | null = null;
    const platformRootClass = getPlatformRootClass(platformId);

    const cleanupInjectedAssets = () => {
      styleElement?.remove();
      styleElement = null;
      if (moduleUrl) {
        URL.revokeObjectURL(moduleUrl);
        moduleUrl = null;
      }
    };

    const cleanupTabsSlot = () => {
      tabsSlotElement?.classList.remove(platformRootClass);
      tabsSlotElement = null;
    };

    const cleanupMounted = () => {
      if (cleanupRef.current) {
        try {
          cleanupRef.current();
        } catch (cleanupError) {
          console.warn('Platform remote cleanup failed:', cleanupError);
        }
        cleanupRef.current = null;
      }
    };

    setLoading(true);
    setError(null);
    cleanupMounted();
    container.replaceChildren();
    tabsSlotElement = tabsSlotId ? document.getElementById(tabsSlotId) : null;
    tabsSlotElement?.classList.add(platformRootClass);

    void getPlatformPackageUiEntry(platformId)
      .then(async (entry: PlatformPackageUiEntry) => {
        if (cancelled) return;
        if (entry.protocol !== 'react-remote-esm-v1') {
          throw new Error(`Unsupported platform UI protocol: ${entry.protocol}`);
        }
        if (!entry.exports.includes('mount')) {
          throw new Error('Platform remote UI is missing mount export');
        }

        styleElement = installRemoteStyle(platformId, entry.version, entry.style);
        moduleUrl = buildRemoteModuleUrl(entry.source);
        const remote = await import(/* @vite-ignore */ moduleUrl) as PlatformRemoteModule;
        if (cancelled) {
          return;
        }
        if (typeof remote.mount !== 'function') {
          throw new Error('Platform remote UI mount export is not a function');
        }

        const hostApi: PlatformRemoteHostApi = {
          platformId,
          packageVersion: entry.version,
          locale,
          theme: document.documentElement.dataset.theme || 'light',
          state,
          tabsSlotId,
          runtimeParams,
        };
        const mounted = await remote.mount(container, hostApi);
        if (cancelled) {
          resolveCleanup(remote, container, mounted)();
          return;
        }
        cleanupRef.current = resolveCleanup(remote, container, mounted);
      })
      .catch((loadError) => {
        if (cancelled) return;
        cleanupMounted();
        cleanupInjectedAssets();
        cleanupTabsSlot();
        container.replaceChildren();
        const message = loadError instanceof Error ? loadError.message : String(loadError);
        setError(message);
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
      cleanupMounted();
      cleanupInjectedAssets();
      cleanupTabsSlot();
    };
  }, [
    locale,
    platformId,
    state,
    state.installStatus,
    state.installedVersion,
    state.runtimeReady,
    tabsSlotId,
    runtimeParams,
  ]);

  return (
    <div className={`platform-runtime-page-host ${className || ''}`.trim()}>
      {loading ? (
        <div className="platform-runtime-placeholder">
          {t('common.loading', '加载中...')}
        </div>
      ) : null}
      {error ? (
        <div className="platform-runtime-placeholder is-error">
          <strong>{t('platformLayout.packageError', '状态异常')}</strong>
          <span>{error}</span>
        </div>
      ) : null}
      <div
        ref={containerRef}
        className={`platform-runtime-remote-root ${loading || error ? 'is-hidden' : ''}`}
      />
    </div>
  );
}
