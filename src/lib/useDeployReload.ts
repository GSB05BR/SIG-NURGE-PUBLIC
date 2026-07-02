import { useEffect } from 'react';

interface VersionInfo {
  buildId?: string;
}

const VERSION_URL = `${import.meta.env.BASE_URL}version.json`;
const CHECK_INTERVAL_MS = 60_000;

async function readBuildId(): Promise<string | null> {
  const response = await fetch(`${VERSION_URL}?t=${Date.now()}`, {
    cache: 'no-store',
  });
  if (!response.ok) return null;
  const data = (await response.json()) as VersionInfo;
  return typeof data.buildId === 'string' ? data.buildId : null;
}

export function useDeployReload(): void {
  useEffect(() => {
    let active = true;
    let currentBuildId: string | null = null;

    async function checkVersion() {
      try {
        const nextBuildId = await readBuildId();
        if (!active || !nextBuildId) return;
        if (currentBuildId === null) {
          currentBuildId = nextBuildId;
          return;
        }
        if (nextBuildId !== currentBuildId) {
          window.location.reload();
        }
      } catch {
        // Offline/transition moments during deploy should not interrupt users.
      }
    }

    void checkVersion();
    const id = window.setInterval(checkVersion, CHECK_INTERVAL_MS);
    return () => {
      active = false;
      window.clearInterval(id);
    };
  }, []);
}
