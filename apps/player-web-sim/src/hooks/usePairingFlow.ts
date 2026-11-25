import { useCallback, useEffect, useState } from 'react';
import type { ClaimProvisionResponse, PairPollResponse, PairRequestResponse } from '@signage/shared';
import { loadCredentials, type DeviceCredentials } from '../types';

export function usePairingFlow(
  slot: string,
  storageKey: string,
  previewScreenId: string | null,
  provisionTokenParam: string | null,
) {
  const [creds, setCreds] = useState<DeviceCredentials | null>(() => loadCredentials(slot));
  const [pairData, setPairData] = useState<PairRequestResponse | null>(null);
  const [pairError, setPairError] = useState<string | null>(null);
  const [claimingProvision, setClaimingProvision] = useState(false);

  const claimProvisionToken = useCallback(
    async (token: string) => {
      const cleaned = token.trim();
      if (!cleaned) return;
      setClaimingProvision(true);
      setPairError(null);
      try {
        const res = await fetch('/api/v1/device/provision/claim', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ provisionToken: cleaned }),
        });
        if (!res.ok) {
          const payload = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(payload.error ?? `Provision claim failed (${res.status})`);
        }
        const data = (await res.json()) as ClaimProvisionResponse;
        const nextCreds: DeviceCredentials = {
          deviceToken: data.deviceToken,
          screenId: data.screenId,
          screenName: data.screenName,
        };
        localStorage.setItem(storageKey, JSON.stringify(nextCreds));
        setCreds(nextCreds);

        const url = new URL(window.location.href);
        if (url.searchParams.has('provision')) {
          url.searchParams.delete('provision');
          window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`);
        }
      } catch (err) {
        setPairError(err instanceof Error ? err.message : 'Provision claim failed');
      } finally {
        setClaimingProvision(false);
      }
    },
    [storageKey],
  );

  useEffect(() => {
    if (!previewScreenId && !creds && provisionTokenParam) {
      claimProvisionToken(provisionTokenParam);
    }
  }, [claimProvisionToken, creds, previewScreenId, provisionTokenParam]);

  useEffect(() => {
    if (previewScreenId || creds || provisionTokenParam) return;
    let cancelled = false;
    let pollTimer: number | undefined;

    async function startPairing() {
      try {
        setPairError(null);
        const res = await fetch('/api/v1/device/pair/request', { method: 'POST' });
        if (!res.ok) throw new Error('Could not request pairing code');
        const data = (await res.json()) as PairRequestResponse;
        if (cancelled) return;
        setPairData(data);

        const poll = async () => {
          if (cancelled) return;
          try {
            const pollRes = await fetch('/api/v1/device/pair/poll', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ code: data.code, claimSecret: data.claimSecret }),
            });
            if (pollRes.ok) {
              const status = (await pollRes.json()) as PairPollResponse;
              if (status.status === 'claimed' && status.deviceToken && status.screenId) {
                const nextCreds = {
                  deviceToken: status.deviceToken,
                  screenId: status.screenId,
                  screenName: status.screenName,
                };
                localStorage.setItem(storageKey, JSON.stringify(nextCreds));
                setCreds(nextCreds);
                return;
              }
              if (status.status === 'expired') {
                startPairing();
                return;
              }
            }
          } catch {
            // retry next interval
          }
          pollTimer = window.setTimeout(poll, 3000);
        };
        pollTimer = window.setTimeout(poll, 2500);
      } catch (err) {
        if (!cancelled) {
          setPairError(err instanceof Error ? err.message : 'Pairing error');
          pollTimer = window.setTimeout(startPairing, 5000);
        }
      }
    }

    startPairing();
    return () => {
      cancelled = true;
      if (pollTimer) clearTimeout(pollTimer);
    };
  }, [creds, previewScreenId, provisionTokenParam, storageKey]);

  return { creds, setCreds, pairData, pairError, claimingProvision, claimProvisionToken };
}
