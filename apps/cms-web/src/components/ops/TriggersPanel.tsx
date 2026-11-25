import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Copy, Play, Plus, Trash2, Zap } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { api } from '../../lib/api';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Card } from '../ui/card';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../ui/table';

export function TriggersPanel() {
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [targetScreenId, setTargetScreenId] = useState('');
  const [playlistId, setPlaylistId] = useState('');
  const [durationSec, setDurationSec] = useState('300');
  const [createdSecret, setCreatedSecret] = useState<{ key: string; secret: string } | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const { data: triggersData, isLoading } = useQuery({ queryKey: ['triggers'], queryFn: api.listTriggers });
  const { data: screensData } = useQuery({ queryKey: ['screens'], queryFn: api.listScreens });
  const { data: playlistsData } = useQuery({ queryKey: ['playlists'], queryFn: api.listPlaylists });

  const createMutation = useMutation({
    mutationFn: api.createTrigger,
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['triggers'] });
      setName('');
      setCreatedSecret({ key: res.trigger.triggerKey, secret: res.triggerSecret });
      setErrorMsg(null);
    },
    onError: (err) => setErrorMsg(err instanceof Error ? err.message : 'Failed to create trigger'),
  });

  const deleteMutation = useMutation({
    mutationFn: api.deleteTrigger,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['triggers'] }),
  });

  const fireMutation = useMutation({
    mutationFn: ({ key, secret }: { key: string; secret: string }) => api.fireTrigger(key, secret),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['triggers'] });
      queryClient.invalidateQueries({ queryKey: ['schedules'] });
    },
  });

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!targetScreenId || !playlistId) return;
    setErrorMsg(null);
    createMutation.mutate({
      name: name.trim(),
      targetType: 'screen',
      targetId: targetScreenId,
      playlistId,
      durationSec: Math.max(15, Number(durationSec) || 300),
      priority: 950,
    });
  };

  const triggers = triggersData?.items ?? [];
  const screens = screensData?.items ?? [];
  const playlists = playlistsData?.items ?? [];

  return (
    <div className="space-y-6">
      <Card className="p-5">
        <form onSubmit={handleSubmit} className="grid gap-4 md:grid-cols-4 md:items-end">
          <div className="space-y-1.5">
            <Label htmlFor="trg-name">Trigger Name</Label>
            <Input
              id="trg-name"
              required
              placeholder="e.g. Gate 4 Boarding Call"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Target Screen</Label>
            <Select value={targetScreenId} onValueChange={setTargetScreenId}>
              <SelectTrigger><SelectValue placeholder="Choose screen..." /></SelectTrigger>
              <SelectContent>
                {screens.map((s) => (
                  <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Override Playlist</Label>
            <Select value={playlistId} onValueChange={setPlaylistId}>
              <SelectTrigger><SelectValue placeholder="Choose playlist..." /></SelectTrigger>
              <SelectContent>
                {playlists.map((p) => (
                  <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-end gap-2">
            <div className="w-24 space-y-1.5">
              <Label htmlFor="trg-dur">Dur (s)</Label>
              <Input
                id="trg-dur"
                type="number"
                min={15}
                value={durationSec}
                onChange={(e) => setDurationSec(e.target.value)}
              />
            </div>
            <Button type="submit" disabled={createMutation.isPending || !targetScreenId || !playlistId}>
              <Plus className="h-4 w-4" />
              Create
            </Button>
          </div>
        </form>
        {errorMsg && (
          <div className="mt-3 rounded-md border border-destructive/40 bg-destructive/15 px-3 py-2 text-xs text-red-300">
            {errorMsg}
          </div>
        )}
      </Card>

      {createdSecret && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-emerald-500/40 bg-emerald-500/10 px-4 py-3 text-xs text-emerald-200">
          <div>
            <strong>Trigger secret issued (shown once):</strong>{' '}
            <code className="font-mono text-white">{createdSecret.secret}</code> for{' '}
            <code className="font-mono">/api/v1/triggers/{createdSecret.key}/fire</code>
          </div>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void navigator.clipboard?.writeText(createdSecret.secret)}
            >
              <Copy className="h-3.5 w-3.5" />
              Copy Secret
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={() => fireMutation.mutate(createdSecret)}
              disabled={fireMutation.isPending}
            >
              <Play className="h-3.5 w-3.5" />
              Test Fire Now
            </Button>
          </div>
        </div>
      )}

      {isLoading ? (
        <div className="py-10 text-center text-sm text-muted-foreground">Loading triggers...</div>
      ) : triggers.length === 0 ? (
        <Card className="border-dashed p-10 text-center text-sm text-muted-foreground">
          <Zap className="mx-auto mb-2 h-7 w-7" />
          No external webhook triggers yet. POS, queue, or emergency systems can trigger instant playlist overrides.
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Name</TableHead>
                <TableHead>Trigger Endpoint Key</TableHead>
                <TableHead>Priority / Duration</TableHead>
                <TableHead>Last Fired</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {triggers.map((trg) => (
                <TableRow key={trg.id}>
                  <TableCell className="font-medium">{trg.name}</TableCell>
                  <TableCell className="font-mono text-xs">{trg.triggerKey}</TableCell>
                  <TableCell>
                    <Badge variant="outline">P{trg.priority} • {trg.durationSec}s</Badge>
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {trg.lastFiredAt ? new Date(trg.lastFiredAt).toLocaleString() : 'Never'}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-red-300 hover:bg-destructive/15"
                      onClick={() => deleteMutation.mutate(trg.id)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}
    </div>
  );
}
