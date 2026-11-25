import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Check, Copy, ExternalLink } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import type { Playlist, ProvisionScreenResponse } from '@signage/shared';
import { Button } from '../ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../ui/dialog';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../ui/select';
import { api } from '../../lib/api';

const NONE_PLAYLIST_VALUE = '__none__';

interface ProvisionScreenDialogProps {
  open: boolean;
  playlists: Playlist[];
  onClose: () => void;
}

export function ProvisionScreenDialog({ open, playlists, onClose }: ProvisionScreenDialogProps) {
  const queryClient = useQueryClient();
  const [provName, setProvName] = useState('');
  const [provLocation, setProvLocation] = useState('');
  const [provPlaylistId, setProvPlaylistId] = useState(NONE_PLAYLIST_VALUE);
  const [provResult, setProvResult] = useState<ProvisionScreenResponse | null>(null);
  const [provError, setProvError] = useState<string | null>(null);
  const [copiedKey, setCopiedKey] = useState<'url' | 'code' | null>(null);

  const resetAndClose = () => {
    setProvName('');
    setProvLocation('');
    setProvPlaylistId(NONE_PLAYLIST_VALUE);
    setProvResult(null);
    setProvError(null);
    setCopiedKey(null);
    onClose();
  };

  const provisionMutation = useMutation({
    mutationFn: api.provisionScreen,
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['screens'] });
      setProvResult(res);
    },
    onError: (err) => {
      setProvError(err instanceof Error ? err.message : 'Pre-provisioning failed');
    },
  });

  const handleProvision = (e: FormEvent) => {
    e.preventDefault();
    setProvError(null);
    provisionMutation.mutate({
      name: provName.trim(),
      location: provLocation.trim() || undefined,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
      activePlaylistId: provPlaylistId === NONE_PLAYLIST_VALUE ? null : provPlaylistId,
      orientation: 'landscape',
    });
  };

  const copyText = (key: 'url' | 'code', value: string) => {
    navigator.clipboard?.writeText(value).catch(() => {});
    setCopiedKey(key);
    window.setTimeout(() => setCopiedKey(null), 2000);
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !next && resetAndClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Pre-Provision Display (Zero-Touch URL)</DialogTitle>
          <DialogDescription>
            Create a screen record up front and generate a single-use auto-pair link or setup code
            without exposing a public pairing code on the screen.
          </DialogDescription>
        </DialogHeader>

        {provResult ? (
          <div className="space-y-4">
            <div className="rounded-md border border-emerald-500/30 bg-emerald-500/10 p-3 text-xs text-emerald-300">
              Display <strong>{provResult.screen.name}</strong> pre-provisioned. Claim once within
              24 hours.
            </div>

            <div className="space-y-1.5">
              <Label>Setup Code (Enter on Android / Windows / Display)</Label>
              <div className="flex items-center gap-2">
                <Input readOnly value={provResult.provisionToken} className="font-mono text-sm font-semibold" />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => copyText('code', provResult.provisionToken)}
                >
                  {copiedKey === 'code' ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                </Button>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>Web Player Auto-Pair URL</Label>
              <div className="flex items-center gap-2">
                <Input
                  readOnly
                  value={`${window.location.origin}${provResult.provisionUrl}`}
                  className="font-mono text-xs"
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => copyText('url', `${window.location.origin}${provResult.provisionUrl}`)}
                >
                  {copiedKey === 'url' ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                </Button>
              </div>
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={resetAndClose}>
                Done
              </Button>
              <Button asChild>
                <a href={provResult.provisionUrl} target="_blank" rel="noreferrer">
                  <ExternalLink className="h-4 w-4" />
                  Launch Pre-Provisioned Web Player
                </a>
              </Button>
            </DialogFooter>
          </div>
        ) : (
          <form onSubmit={handleProvision} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="prov-name">Screen Name</Label>
              <Input
                id="prov-name"
                type="text"
                required
                placeholder="e.g. Mall Entrance Pre-Provisioned TV"
                value={provName}
                onChange={(e) => setProvName(e.target.value)}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="prov-location">Location (optional)</Label>
              <Input
                id="prov-location"
                type="text"
                placeholder="North Atrium Kiosk"
                value={provLocation}
                onChange={(e) => setProvLocation(e.target.value)}
              />
            </div>

            <div className="space-y-1.5">
              <Label>Fallback Playlist (optional)</Label>
              <Select value={provPlaylistId} onValueChange={setProvPlaylistId}>
                <SelectTrigger>
                  <SelectValue placeholder="— Assign later —" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE_PLAYLIST_VALUE}>— Assign later —</SelectItem>
                  {playlists.map((pl) => (
                    <SelectItem key={pl.id} value={pl.id}>
                      {pl.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {provError && (
              <div className="rounded-md border border-destructive/40 bg-destructive/15 px-3 py-2 text-xs text-red-300">
                {provError}
              </div>
            )}

            <DialogFooter>
              <Button type="button" variant="outline" onClick={resetAndClose}>
                Cancel
              </Button>
              <Button type="submit" disabled={provisionMutation.isPending || !provName.trim()}>
                {provisionMutation.isPending ? 'Generating...' : 'Generate Setup URL & Code'}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
