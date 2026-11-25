import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import type { Playlist } from '@signage/shared';
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

interface PairScreenDialogProps {
  open: boolean;
  playlists: Playlist[];
  onClose: () => void;
}

export function PairScreenDialog({ open, playlists, onClose }: PairScreenDialogProps) {
  const queryClient = useQueryClient();
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [location, setLocation] = useState('');
  const [activePlaylistId, setActivePlaylistId] = useState(NONE_PLAYLIST_VALUE);
  const [pairError, setPairError] = useState<string | null>(null);

  const resetAndClose = () => {
    setCode('');
    setName('');
    setLocation('');
    setActivePlaylistId(NONE_PLAYLIST_VALUE);
    setPairError(null);
    onClose();
  };

  const pairMutation = useMutation({
    mutationFn: api.pairScreen,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['screens'] });
      resetAndClose();
    },
    onError: (err) => {
      setPairError(err instanceof Error ? err.message : 'Pairing failed');
    },
  });

  const handlePair = (e: FormEvent) => {
    e.preventDefault();
    setPairError(null);
    pairMutation.mutate({
      code: code.trim(),
      name: name.trim(),
      location: location.trim() || undefined,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
      activePlaylistId: activePlaylistId === NONE_PLAYLIST_VALUE ? null : activePlaylistId,
    });
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !next && resetAndClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Pair New Screen</DialogTitle>
          <DialogDescription>
            Enter the 6-digit pairing code shown on your display to issue a scoped device token.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handlePair} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="pair-code">6-Digit Code from Display</Label>
            <Input
              id="pair-code"
              type="text"
              required
              maxLength={6}
              pattern="\d{6}"
              placeholder="123456"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              className="h-11 text-center font-mono text-xl tracking-[0.3em]"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="pair-name">Screen Name</Label>
            <Input
              id="pair-name"
              type="text"
              required
              placeholder="e.g. Reception 4K Display"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="pair-location">Location (optional)</Label>
            <Input
              id="pair-location"
              type="text"
              placeholder="Ground Floor Lobby"
              value={location}
              onChange={(e) => setLocation(e.target.value)}
            />
          </div>

          <div className="space-y-1.5">
            <Label>Fallback Playlist (optional)</Label>
            <Select value={activePlaylistId} onValueChange={setActivePlaylistId}>
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

          {pairError && (
            <div className="rounded-md border border-destructive/40 bg-destructive/15 px-3 py-2 text-xs text-red-300">
              {pairError}
            </div>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={resetAndClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={pairMutation.isPending || code.length !== 6}>
              {pairMutation.isPending ? 'Pairing...' : 'Pair Display'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
