import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState, type FormEvent } from 'react';
import { getCreativeTypeDef, isBinaryMediaType, type MediaAsset } from '@signage/shared';
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
import { api } from '../../lib/api';
import { CreativeFieldsForm } from './CreativeFieldsForm';

interface EditMediaDialogProps {
  asset: MediaAsset | null;
  onClose: () => void;
}

export function EditMediaDialog({ asset, onClose }: EditMediaDialogProps) {
  const queryClient = useQueryClient();
  const [title, setTitle] = useState('');
  const [durationSec, setDurationSec] = useState('15');
  const [configValues, setConfigValues] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!asset) return;
    setTitle(asset.title);
    setDurationSec(String(Math.max(1, Math.round((asset.durationMs ?? 15_000) / 1000))));
    const nextVals: Record<string, string> = {};
    for (const [k, v] of Object.entries(asset.appConfig ?? {})) {
      if (typeof v === 'string') nextVals[k] = v;
    }
    setConfigValues(nextVals);
    setError(null);
  }, [asset]);

  const mutation = useMutation({
    mutationFn: (payload: { id: string; title: string; durationMs: number; appConfig?: Record<string, unknown> }) =>
      api.updateMedia(payload.id, {
        title: payload.title,
        durationMs: payload.durationMs,
        ...(payload.appConfig ? { appConfig: payload.appConfig } : {}),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['media'] });
      onClose();
    },
    onError: (err) => {
      setError(err instanceof Error ? err.message : 'Failed to update creative');
    },
  });

  const typeDef = asset ? getCreativeTypeDef(asset.type) : undefined;
  const isApp = asset ? !isBinaryMediaType(asset.type) : false;

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!asset) return;
    const sec = Math.max(1, Number.parseInt(durationSec, 10) || 15);
    mutation.mutate({
      id: asset.id,
      title: title.trim(),
      durationMs: sec * 1000,
      ...(isApp ? { appConfig: configValues } : {}),
    });
  };

  return (
    <Dialog open={Boolean(asset)} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit Creative</DialogTitle>
          <DialogDescription>
            Update metadata{isApp ? ' and app configuration' : ''} for {typeDef?.label ?? asset?.type}.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="edit-media-title">Title *</Label>
            <Input
              id="edit-media-title"
              type="text"
              required
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="edit-media-duration">Default Duration (seconds)</Label>
            <Input
              id="edit-media-duration"
              type="number"
              min={1}
              max={3600}
              value={durationSec}
              onChange={(e) => setDurationSec(e.target.value)}
            />
          </div>

          {isApp && typeDef && (
            <CreativeFieldsForm
              fields={typeDef.fields}
              values={configValues}
              onChange={(key, val) => setConfigValues((prev) => ({ ...prev, [key]: val }))}
            />
          )}

          {error && (
            <div className="rounded-md border border-destructive/40 bg-destructive/15 px-3 py-2 text-xs text-red-300">
              {error}
            </div>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={mutation.isPending}>
              {mutation.isPending ? 'Saving...' : 'Save Changes'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
