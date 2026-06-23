import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BookOpenText, ChevronDown, Download, RefreshCw, RotateCw, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import type { PlatformId } from '../types/platform';
import type { PlatformPackageState } from '../types/platformPackage';
import {
  formatPlatformPackageSize,
  getPlatformPackageFromPackages,
  usePlatformPackageStore,
} from '../stores/usePlatformPackageStore';
import { useGlobalModal } from '../hooks/useGlobalModal';
import { getPlatformLabel, renderPlatformIcon } from '../utils/platformMeta';
import './PlatformPackageToolbar.css';

type PackageAction = 'install' | 'update' | 'uninstall';

interface PlatformPackageToolbarProps {
  platformId: PlatformId;
  className?: string;
}

export function getPlatformPackageShortStatus(
  state: PlatformPackageState | null | undefined,
  t: TFunction,
): { label: string; tone: 'warning' | 'info' | 'danger' | 'muted' } | null {
  if (!state || state.packageMode !== 'hotUpdate') {
    return null;
  }

  if (state.installStatus === 'notInstalled') {
    return {
      label: t('platformLayout.packageInstallRequired', '未安装'),
      tone: 'warning',
    };
  }
  if (state.installStatus === 'updateAvailable') {
    return {
      label: t('platformLayout.packageUpdateAvailableShort', '可更新'),
      tone: 'info',
    };
  }
  if (state.installStatus === 'incompatible') {
    return {
      label: t('platformLayout.packageIncompatibleShort', '不兼容'),
      tone: 'danger',
    };
  }
  if (state.installStatus === 'error' || !state.runtimeReady) {
    return {
      label: t('platformLayout.packageRepairRequired', '需修复'),
      tone: 'danger',
    };
  }
  if (
    state.installStatus === 'installing'
    || state.installStatus === 'updating'
    || state.installStatus === 'uninstalling'
  ) {
    return {
      label: t('platformLayout.packageOperating', '处理中'),
      tone: 'muted',
    };
  }
  return null;
}

export function getPlatformPackageStatusText(
  state: PlatformPackageState,
  t: TFunction,
): string {
  const version = state.installedVersion || state.latestVersion || '--';
  const installedSize = formatPlatformPackageSize(state.installedSizeBytes);
  const downloadSize = formatPlatformPackageSize(state.downloadSizeBytes);

  switch (state.installStatus) {
    case 'notInstalled':
      return t('platformLayout.packageNotInstalled', {
        size: downloadSize,
        defaultValue: '未下载 · {{size}}',
      });
    case 'updateAvailable':
      return t('platformLayout.packageUpdateAvailable', {
        version: state.latestVersion || '--',
        size: downloadSize,
        defaultValue: '可更新 {{version}} · {{size}}',
      });
    case 'incompatible':
      return t('platformLayout.packageIncompatible', '主应用版本不兼容');
    case 'error':
      return state.errorMessage || t('platformLayout.packageError', '状态异常');
    case 'installing':
    case 'updating':
    case 'uninstalling':
      return t('platformLayout.packageOperating', '处理中');
    default:
      return t('platformLayout.packageInstalled', {
        version,
        size: installedSize,
        defaultValue: '已安装 v{{version}} · {{size}}',
      });
  }
}

function dispatchPlatformPackageChanged(state: PlatformPackageState) {
  if (typeof window === 'undefined') {
    return;
  }
  window.dispatchEvent(
    new CustomEvent('agtools:platform-package-changed', {
      detail: state,
    }),
  );
}

export function PlatformPackageToolbar({ platformId, className }: PlatformPackageToolbarProps) {
  const { t } = useTranslation();
  const { showModal } = useGlobalModal();
  const packages = usePlatformPackageStore((state) => state.packages);
  const loading = usePlatformPackageStore((state) => state.loading);
  const checkUpdate = usePlatformPackageStore((state) => state.checkUpdate);
  const installPackage = usePlatformPackageStore((state) => state.installPackage);
  const updatePackage = usePlatformPackageStore((state) => state.updatePackage);
  const uninstallPackage = usePlatformPackageStore((state) => state.uninstallPackage);
  const [actionKey, setActionKey] = useState<string | null>(null);
  const [operationError, setOperationError] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const actionPromisesRef = useRef<Map<string, Promise<PlatformPackageState>>>(new Map());
  const rootRef = useRef<HTMLDivElement | null>(null);

  const platformPackage = useMemo(
    () => getPlatformPackageFromPackages(packages, platformId),
    [packages, platformId],
  );

  const platformName = getPlatformLabel(platformId, t);

  const runAction = useCallback(async (
    action: PackageAction,
    options?: { requireRuntimeReady?: boolean },
  ): Promise<PlatformPackageState> => {
    const key = `${platformId}:${action}`;
    const existing = actionPromisesRef.current.get(key);
    if (existing) {
      return await existing;
    }

    const promise = (async () => {
      setActionKey(key);
      setOperationError(null);
      const nextState = action === 'install'
        ? await installPackage(platformId)
        : action === 'update'
          ? await updatePackage(platformId)
          : await uninstallPackage(platformId);
      dispatchPlatformPackageChanged(nextState);
      if (options?.requireRuntimeReady && !nextState.runtimeReady) {
        throw new Error(t('platformLayout.packageInstallNotReady', '平台包已处理，但运行组件尚未就绪'));
      }
      return nextState;
    })()
      .catch((error) => {
        const message = error instanceof Error ? error.message : String(error);
        setOperationError(message);
        throw error;
      })
      .finally(() => {
        actionPromisesRef.current.delete(key);
        setActionKey((current) => (current === key ? null : current));
      });

    actionPromisesRef.current.set(key, promise);
    return await promise;
  }, [installPackage, platformId, t, uninstallPackage, updatePackage]);

  const confirmAction = useCallback((action: PackageAction) => {
    if (!platformPackage) {
      return;
    }
    setMenuOpen(false);

    const version = action === 'update'
      ? platformPackage.latestVersion || '--'
      : platformPackage.latestVersion || platformPackage.installedVersion || '--';
    const size = action === 'uninstall'
      ? formatPlatformPackageSize(platformPackage.installedSizeBytes)
      : formatPlatformPackageSize(platformPackage.downloadSizeBytes);
    const isRepair = action === 'install' && platformPackage.installStatus === 'error';

    const title = action === 'uninstall'
      ? t('platformLayout.packageUninstallConfirmTitle', {
          platform: platformName,
          defaultValue: '卸载 {{platform}} 平台包',
        })
      : action === 'update'
        ? t('platformLayout.packageUpdateConfirmTitle', {
            platform: platformName,
            defaultValue: '更新 {{platform}} 平台包',
          })
        : isRepair
          ? t('platformLayout.packageRepairConfirmTitle', {
              platform: platformName,
              defaultValue: '修复 {{platform}} 平台包',
            })
          : t('platformLayout.packageInstallConfirmTitle', {
              platform: platformName,
              defaultValue: '安装 {{platform}} 平台包',
            });
    const description = action === 'uninstall'
      ? t('platformLayout.packageUninstallConfirmDesc', {
          platform: platformName,
          size,
          defaultValue: '将移除 {{platform}} 的平台包和运行组件，占用 {{size}}；已保存账号数据不会删除。',
        })
      : action === 'update'
        ? t('platformLayout.packageUpdateConfirmDesc', {
            platform: platformName,
            version,
            size,
            defaultValue: '将下载并切换到 {{platform}} 平台包 {{version}}，大小 {{size}}。',
          })
        : isRepair
          ? t('platformLayout.packageRepairConfirmDesc', {
              platform: platformName,
              version,
              size,
              defaultValue: '将重新下载并校验 {{platform}} 平台包 {{version}}，大小 {{size}}。',
            })
          : t('platformLayout.packageInstallConfirmDesc', {
              platform: platformName,
              version,
              size,
              defaultValue: '{{platform}} 需要先下载平台包。版本 {{version}}，大小 {{size}}。',
            });
    const actionLabel = action === 'uninstall'
      ? t('platformLayout.packageUninstall', '卸载')
      : action === 'update'
        ? t('platformLayout.packageUpdate', '更新')
        : isRepair
          ? t('platformLayout.packageRepair', '修复')
          : t('platformLayout.packageDownload', '下载');

    showModal({
      title,
      description,
      width: 'sm',
      actions: [
        {
          id: 'cancel',
          label: t('common.cancel', '取消'),
          variant: 'secondary',
        },
        {
          id: `platform-package-${action}`,
          label: actionLabel,
          variant: action === 'uninstall' ? 'danger' : 'primary',
          onClick: async () => {
            await runAction(action, { requireRuntimeReady: action !== 'uninstall' });
          },
        },
      ],
    });
  }, [platformName, platformPackage, runAction, showModal, t]);

  const handleCheckUpdate = useCallback(async () => {
    if (!platformPackage || actionKey) {
      return;
    }
    const key = `${platformId}:check`;
    setActionKey(key);
    setOperationError(null);
    try {
      const nextState = await checkUpdate(platformId);
      dispatchPlatformPackageChanged(nextState);
    } catch (error) {
      setOperationError(error instanceof Error ? error.message : String(error));
    } finally {
      setActionKey((current) => (current === key ? null : current));
    }
  }, [actionKey, checkUpdate, platformId, platformPackage]);

  const showChangelog = useCallback(() => {
    if (!platformPackage) {
      return;
    }
    setMenuOpen(false);
    const entries = platformPackage.changelog || [];
    showModal({
      title: t('platformLayout.packageChangelogTitle', {
        platform: platformName,
        defaultValue: '{{platform}} 更新日志',
      }),
      width: 'md',
      content: entries.length > 0 ? (
        <div className="platform-package-changelog-list">
          {entries.map((entry) => (
            <section className="platform-package-changelog-entry" key={`${entry.version}:${entry.date || ''}`}>
              <div className="platform-package-changelog-entry-head">
                <strong>v{entry.version}</strong>
                {entry.date ? <span>{entry.date}</span> : null}
              </div>
              {entry.notes.length > 0 ? (
                <ul>
                  {entry.notes.map((note, index) => (
                    <li key={`${entry.version}:${index}`}>{note}</li>
                  ))}
                </ul>
              ) : (
                <p>{t('platformLayout.packageChangelogEntryEmpty', '此版本暂无说明。')}</p>
              )}
            </section>
          ))}
        </div>
      ) : (
        <div className="platform-package-changelog-empty">
          {t('platformLayout.packageChangelogEmpty', '暂无更新日志。')}
        </div>
      ),
      actions: [
        {
          id: 'close',
          label: t('common.close', '关闭'),
          variant: 'primary',
        },
      ],
    });
  }, [platformName, platformPackage, showModal, t]);

  useEffect(() => {
    setOperationError(null);
  }, [platformPackage?.installStatus, platformPackage?.installedVersion, platformPackage?.latestVersion]);

  useEffect(() => {
    if (!menuOpen) {
      return undefined;
    }

    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target;
      if (target instanceof Node && rootRef.current?.contains(target)) {
        return;
      }
      setMenuOpen(false);
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setMenuOpen(false);
      }
    };

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [menuOpen]);

  if (!platformPackage || platformPackage.packageMode !== 'hotUpdate') {
    return null;
  }

  const operating = loading || Boolean(actionKey);
  const statusText = getPlatformPackageStatusText(platformPackage, t);
  const shortStatus = getPlatformPackageShortStatus(platformPackage, t);
  const canInstall = platformPackage.installStatus === 'notInstalled'
    || platformPackage.installStatus === 'error'
    || (!platformPackage.runtimeReady && platformPackage.installStatus !== 'incompatible');
  const canUpdate = platformPackage.installStatus === 'updateAvailable';
  const shouldShowRepairAction = platformPackage.installStatus === 'error'
    || (!platformPackage.runtimeReady && platformPackage.installStatus !== 'notInstalled');
  const hasInstalledPackage = Boolean(
    platformPackage.runtimeReady
    || platformPackage.installedVersion
    || platformPackage.installedSizeBytes,
  );
  const currentVersion = platformPackage.installedVersion || '--';
  const latestVersion = platformPackage.latestVersion || '--';
  const badgeValue = (() => {
    if (platformPackage.installStatus === 'updateAvailable') {
      return platformPackage.latestVersion
        ? `${t('platformLayout.packageUpdateAvailableShort', '可更新')} v${platformPackage.latestVersion}`
        : t('platformLayout.packageUpdateAvailableShort', '可更新');
    }
    if (platformPackage.installStatus === 'notInstalled') {
      return t('platformLayout.packageInstallRequired', '未安装');
    }
    if (
      platformPackage.installStatus === 'installing'
      || platformPackage.installStatus === 'updating'
      || platformPackage.installStatus === 'uninstalling'
    ) {
      return t('platformLayout.packageOperating', '处理中');
    }
    if (shortStatus) {
      return shortStatus.label;
    }
    return `v${currentVersion}`;
  })();
  const badgeTone = shortStatus?.tone || (
    platformPackage.installStatus === 'updateAvailable'
      ? 'info'
      : platformPackage.installStatus === 'notInstalled'
        ? 'warning'
        : platformPackage.installStatus === 'installed'
          ? 'ready'
          : 'muted'
  );

  return (
    <div className={`platform-package-toolbar ${className || ''}`.trim()} ref={rootRef}>
      <button
        type="button"
        className={`installed-version-badge platform-package-badge is-${badgeTone} is-${platformPackage.installStatus}${menuOpen ? ' is-open' : ''}`}
        title={statusText}
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        onClick={() => setMenuOpen((open) => !open)}
      >
        <span className="installed-version-dot platform-package-badge-dot" />
        <span className="installed-version-name platform-package-badge-name">{platformName}</span>
        <span className="installed-version-value platform-package-badge-value">{badgeValue}</span>
        <ChevronDown size={13} className="platform-package-badge-chevron" />
      </button>

      {menuOpen && (
        <div className="platform-package-menu" role="menu">
          <div className="platform-package-menu-head">
            <div className="platform-package-menu-title">
              <span className="platform-package-menu-icon">{renderPlatformIcon(platformId, 18)}</span>
              <span>{platformName}</span>
            </div>
            <div className="platform-package-menu-status" title={statusText}>{statusText}</div>
            <div className="platform-package-menu-meta">
              <span>
                {t('platformLayout.packageCurrentVersion', {
                  version: currentVersion,
                  defaultValue: '当前 {{version}}',
                })}
              </span>
              {platformPackage.installStatus === 'updateAvailable' && (
                <span>
                  {t('platformLayout.packageLatestVersion', {
                    version: latestVersion,
                    defaultValue: '最新 {{version}}',
                  })}
                </span>
              )}
            </div>
          </div>

          {operationError && (
            <div className="platform-package-menu-error" role="alert">
              {operationError}
            </div>
          )}

          <div className="platform-package-menu-actions">
            <button
              type="button"
              className="platform-package-menu-action"
              onClick={handleCheckUpdate}
              disabled={operating}
              role="menuitem"
              title={t('platformLayout.packageCheckUpdate', '检查更新')}
            >
              <RotateCw size={14} className={actionKey === `${platformId}:check` ? 'loading-spinner' : ''} />
              <span>{t('platformLayout.packageCheckUpdateShort', '检查')}</span>
            </button>
            <button
              type="button"
              className="platform-package-menu-action"
              onClick={showChangelog}
              disabled={operating}
              role="menuitem"
              title={t('platformLayout.packageChangelog', '更新日志')}
            >
              <BookOpenText size={14} />
              <span>{t('platformLayout.packageChangelogShort', '日志')}</span>
            </button>
            {canInstall && (
              <button
                type="button"
                className="platform-package-menu-action is-primary"
                onClick={() => confirmAction('install')}
                disabled={operating}
                role="menuitem"
                title={shouldShowRepairAction
                  ? t('platformLayout.packageRepair', '修复')
                  : t('platformLayout.packageDownload', '下载')}
              >
                {actionKey === `${platformId}:install`
                  ? <RefreshCw size={14} className="loading-spinner" />
                  : <Download size={14} />}
                <span>
                  {shouldShowRepairAction
                    ? t('platformLayout.packageRepair', '修复')
                    : t('platformLayout.packageDownload', '下载')}
                </span>
              </button>
            )}
            {canUpdate && (
              <button
                type="button"
                className="platform-package-menu-action is-primary"
                onClick={() => confirmAction('update')}
                disabled={operating}
                role="menuitem"
                title={t('platformLayout.packageUpdate', '更新')}
              >
                <RefreshCw size={14} className={actionKey === `${platformId}:update` ? 'loading-spinner' : ''} />
                <span>{t('platformLayout.packageUpdate', '更新')}</span>
              </button>
            )}
            {hasInstalledPackage && (
              <button
                type="button"
                className="platform-package-menu-action is-danger"
                onClick={() => confirmAction('uninstall')}
                disabled={operating}
                role="menuitem"
                title={t('platformLayout.packageUninstall', '卸载')}
              >
                {actionKey === `${platformId}:uninstall`
                  ? <RefreshCw size={14} className="loading-spinner" />
                  : <Trash2 size={14} />}
                <span>{t('platformLayout.packageUninstall', '卸载')}</span>
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
