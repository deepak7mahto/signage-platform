import { KeyRound, Monitor } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import type { PairRequestResponse } from '@signage/shared';

interface PairingViewProps {
  slot: string;
  compact: boolean;
  claimingProvision: boolean;
  pairData: PairRequestResponse | null;
  pairError: string | null;
  onClaimProvision: (token: string) => void;
}

export function PairingView({
  slot,
  compact,
  claimingProvision,
  pairData,
  pairError,
  onClaimProvision,
}: PairingViewProps) {
  const [manualProvisionCode, setManualProvisionCode] = useState('');

  const handleManualProvision = (e: FormEvent) => {
    e.preventDefault();
    onClaimProvision(manualProvisionCode);
  };

  return (
    <div
      className={`flex h-screen w-screen flex-col items-center justify-center bg-background text-center text-foreground ${
        compact ? 'p-4' : 'p-8'
      }`}
    >
      <div
        className={`flex items-center justify-center rounded-lg border border-border bg-card ${
          compact ? 'mb-3 h-9 w-9' : 'mb-6 h-14 w-14'
        }`}
      >
        <Monitor className={compact ? 'h-4 w-4' : 'h-7 w-7'} />
      </div>
      <h1 className={`font-bold tracking-tight ${compact ? 'text-base' : 'text-2xl'}`}>
        SignageOS Virtual Screen
      </h1>
      {slot !== 'default' && (
        <div className="mt-1.5 rounded-full border border-border bg-card px-2.5 py-0.5 font-mono text-[11px] text-muted-foreground">
          slot: {slot}
        </div>
      )}
      {!compact && (
        <p className="mt-2 max-w-md text-sm text-muted-foreground">
          {claimingProvision
            ? 'Claiming zero-touch provisioning token...'
            : 'Enter a CMS setup code below, use a pre-provisioned URL, or claim this 6-digit pairing code in the CMS.'}
        </p>
      )}

      <div
        className={`rounded-lg border border-border bg-card shadow-xl ${
          compact ? 'mt-4 px-5 py-3' : 'mt-6 px-10 py-5'
        }`}
      >
        <div className="text-[11px] font-medium tracking-widest text-muted-foreground uppercase">
          Pairing Code
        </div>
        <div
          className={`mt-1.5 font-mono font-bold tracking-[0.25em] text-primary ${
            compact ? 'text-3xl' : 'mt-2 text-5xl'
          }`}
        >
          {pairData ? pairData.code : '------'}
        </div>
      </div>

      {!compact && (
        <form
          onSubmit={handleManualProvision}
          className="mt-6 flex w-full max-w-sm items-center gap-2 rounded-lg border border-border bg-card p-2"
        >
          <KeyRound className="ml-2 h-4 w-4 shrink-0 text-muted-foreground" />
          <input
            type="text"
            placeholder="Enter setup code (e.g. PROV-A1B2...)"
            value={manualProvisionCode}
            onChange={(e) => setManualProvisionCode(e.target.value)}
            className="flex-1 bg-transparent px-1 py-1 font-mono text-xs text-foreground placeholder:text-muted-foreground focus:outline-none"
          />
          <button
            type="submit"
            disabled={claimingProvision || manualProvisionCode.trim().length < 6}
            className="cursor-pointer rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {claimingProvision ? 'Claiming...' : 'Activate'}
          </button>
        </form>
      )}

      {pairError && <div className="mt-3 text-xs text-red-300">{pairError}</div>}
    </div>
  );
}
