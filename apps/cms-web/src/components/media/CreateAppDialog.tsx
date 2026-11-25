import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState, type FormEvent } from 'react';
import { APP_CREATIVE_TYPES, getCreativeTypeDef } from '@signage/shared';
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { api } from '../../lib/api';
import { CreativeFieldsForm } from './CreativeFieldsForm';

interface CreateAppDialogProps {
  open: boolean;
  onClose: () => void;
}

function buildDefaults(type: string): Record<string, string> {
  const def = getCreativeTypeDef(type);
  const out: Record<string, string> = {};
  for (const field of def?.fields ?? []) {
    if (field.defaultValue !== undefined) out[field.key] = field.defaultValue;
  }
  return out;
}

export function CreateAppDialog({ open, onClose }: CreateAppDialogProps) {
  const queryClient = useQueryClient();
  const defaultType = APP_CREATIVE_TYPES[0]?.type ?? 'webpage';

  const [type, setType] = useState(defaultType);
  const [title, setTitle] = useState('');
  const [durationSec, setDurationSec] = useState('20');
  const [configValues, setConfigValues] = useState<Record<string, string>>(() =>
    buildDefaults(defaultType),
  );
  const [error, setError] = useState<string | null>(null);

  const selectedDef = getCreativeTypeDef(type) ?? APP_CREATIVE_TYPES[0];

  useEffect(() => {
    if (!open) return;
    setConfigValues(buildDefaults(type));
    const def = getCreativeTypeDef(type);
    if (def) setDurationSec(String(Math.round(def.defaultDurationMs / 1000)));
  }, [open, type]);

  const mutation = useMutation({
    mutationFn: api.createAppMedia,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['media'] });
      setTitle('');
      setError(null);
      onClose();
    },
    onError: (err) => {
      setError(err instanceof Error ? err.message : 'Failed to create app creative');
    },
  });

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    const sec = Math.max(3, Number.parseInt(durationSec, 10) || 20);
    mutation.mutate({
      title: title.trim(),
      type,
      durationMs: sec * 1000,
      appConfig: configValues,
    });
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add App / Addon Creative</DialogTitle>
          <DialogDescription>
            {selectedDef?.description ?? 'Create a dynamic creative item from the registry.'}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Creative Type</Label>
              <Select value={type} onValueChange={setType}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {APP_CREATIVE_TYPES.map((def) => (
                    <SelectItem key={def.type} value={def.type}>
                      {def.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="app-duration">Slot Duration (sec)</Label>
              <Input
                id="app-duration"
                type="number"
                min={3}
                max={3600}
                value={durationSec}
                onChange={(e) => setDurationSec(e.target.value)}
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="app-title">Title *</Label>
            <Input
              id="app-title"
              type="text"
              required
              placeholder={`e.g. ${selectedDef?.label ?? 'Live Widget'}`}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </div>

          <CreativeFieldsForm
            fields={selectedDef?.fields ?? []}
            values={configValues}
            onChange={(key, val) => setConfigValues((prev) => ({ ...prev, [key]: val }))}
          />

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
              {mutation.isPending ? 'Creating...' : 'Create Creative'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
