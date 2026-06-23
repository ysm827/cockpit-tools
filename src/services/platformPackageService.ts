import { invoke } from '@tauri-apps/api/core';
import { PlatformId } from '../types/platform';
import { PlatformPackageState, PlatformPackageUiEntry } from '../types/platformPackage';

export async function listPlatformPackages(): Promise<PlatformPackageState[]> {
  return await invoke('list_platform_packages');
}

export async function checkPlatformPackageUpdate(platformId: PlatformId): Promise<PlatformPackageState> {
  return await invoke('check_platform_package_update', { platformId });
}

export async function installPlatformPackage(platformId: PlatformId): Promise<PlatformPackageState> {
  return await invoke('install_platform_package', { platformId });
}

export async function updatePlatformPackage(platformId: PlatformId): Promise<PlatformPackageState> {
  return await invoke('update_platform_package', { platformId });
}

export async function uninstallPlatformPackage(platformId: PlatformId): Promise<PlatformPackageState> {
  return await invoke('uninstall_platform_package', { platformId });
}

export async function getPlatformPackageUiEntry(
  platformId: PlatformId,
): Promise<PlatformPackageUiEntry> {
  return await invoke('get_platform_package_ui_entry', { platformId });
}
