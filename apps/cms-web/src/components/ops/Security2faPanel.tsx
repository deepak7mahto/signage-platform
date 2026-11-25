import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { KeyRound, ShieldCheck, ShieldOff } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import type { TotpSetupResponse } from '@signage/shared';
import { api } from '../../lib/api';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../ui/card';
import { Input } from '../ui/input';
import { Label } from '../ui/label';

export function Security2faPanel() {
  const queryClient = useQueryClient();
  const [setupInfo, setSetupInfo] = useState<TotpSetupResponse | null>(null);
  const [code, setCode] = useState('');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const { data: statusData } = useQuery({ queryKey: ['auth', '2fa'], queryFn: api.get2faStatus });

  const setupMutation = useMutation({
    mutationFn: api.setup2fa,
    onSuccess: (res) => {
      setSetupInfo(res);
      setErrorMsg(null);
    },
    onError: (err) => setErrorMsg(err instanceof Error ? err.message : '2FA setup failed'),
  });

  const enableMutation = useMutation({
    mutationFn: (totp: string) => api.enable2fa(totp),
    onSuccess: () => {
      setSetupInfo(null);
      setCode('');
      setErrorMsg(null);
      queryClient.invalidateQueries({ queryKey: ['auth', '2fa'] });
      queryClient.invalidateQueries({ queryKey: ['auth', 'me'] });
    },
    onError: (err) => setErrorMsg(err instanceof Error ? err.message : 'Invalid TOTP code'),
  });

  const disableMutation = useMutation({
    mutationFn: (totp: string) => api.disable2fa(totp),
    onSuccess: () => {
      setCode('');
      setErrorMsg(null);
      queryClient.invalidateQueries({ queryKey: ['auth', '2fa'] });
      queryClient.invalidateQueries({ queryKey: ['auth', 'me'] });
    },
    onError: (err) => setErrorMsg(err instanceof Error ? err.message : 'Invalid TOTP code'),
  });

  const enabled = statusData?.enabled ?? false;

  const handleEnable = (e: FormEvent) => {
    e.preventDefault();
    enableMutation.mutate(code.trim());
  };

  const handleDisable = (e: FormEvent) => {
    e.preventDefault();
    disableMutation.mutate(code.trim());
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-4">
          <div>
            <CardTitle className="flex items-center gap-2">
              <KeyRound className="h-4 w-4" />
              Two-Factor Authentication (RFC 6238 TOTP)
            </CardTitle>
            <CardDescription>
              Protect CMS accounts with any standard authenticator app (Google Authenticator, 1Password, Authy).
            </CardDescription>
          </div>
          <Badge variant={enabled ? 'success' : 'secondary'}>
            {enabled ? <ShieldCheck className="h-3 w-3" /> : <ShieldOff className="h-3 w-3" />}
            {enabled ? 'Enabled' : 'Disabled'}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {!enabled && !setupInfo && (
          <Button type="button" onClick={() => setupMutation.mutate()} disabled={setupMutation.isPending}>
            {setupMutation.isPending ? 'Generating Secret...' : 'Begin TOTP Setup'}
          </Button>
        )}

        {setupInfo && !enabled && (
          <form onSubmit={handleEnable} className="space-y-4 rounded-md border border-border bg-background/60 p-4">
            <div className="space-y-1 text-xs">
              <div className="text-muted-foreground">Base32 Secret Key (Enter manually in Authenticator App):</div>
              <div className="font-mono text-sm font-semibold text-foreground">{setupInfo.secret}</div>
            </div>
            <div className="space-y-1 text-xs">
              <div className="text-muted-foreground">otpauth URI:</div>
              <div className="break-all font-mono text-[11px] text-muted-foreground">{setupInfo.otpauthUri}</div>
            </div>
            <div className="max-w-xs space-y-1.5">
              <Label htmlFor="totp-verify">Verify 6-Digit Code</Label>
              <Input
                id="totp-verify"
                required
                maxLength={6}
                pattern="\d{6}"
                placeholder="123456"
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                className="font-mono tracking-widest"
              />
            </div>
            <Button type="submit" disabled={enableMutation.isPending || code.length !== 6}>
              {enableMutation.isPending ? 'Verifying...' : 'Activate 2FA'}
            </Button>
          </form>
        )}

        {enabled && (
          <form onSubmit={handleDisable} className="max-w-sm space-y-3 rounded-md border border-border bg-background/60 p-4">
            <div className="space-y-1.5">
              <Label htmlFor="totp-disable">Enter current 6-digit code to disable 2FA</Label>
              <Input
                id="totp-disable"
                required
                maxLength={6}
                pattern="\d{6}"
                placeholder="123456"
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                className="font-mono tracking-widest"
              />
            </div>
            <Button type="submit" variant="destructive" size="sm" disabled={disableMutation.isPending || code.length !== 6}>
              {disableMutation.isPending ? 'Disabling...' : 'Disable 2FA'}
            </Button>
          </form>
        )}

        {errorMsg && (
          <div className="rounded-md border border-destructive/40 bg-destructive/15 px-3 py-2 text-xs text-red-300">
            {errorMsg}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
