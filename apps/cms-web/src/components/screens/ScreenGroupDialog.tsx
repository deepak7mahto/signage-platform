import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState, type FormEvent } from 'react';
import type { Screen, ScreenGroup } from '@signage/shared';
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

interface ScreenGroupDialogProps {
  open: boolean;
  editingGroup: ScreenGroup | null;
  screens: Screen[];
  onClose: () => void;
}

export function ScreenGroupDialog({ open, editingGroup, screens, onClose }: ScreenGroupDialogProps) {
  const queryClient = useQueryClient();
  const [groupName, setGroupName] = useState('');
  const [groupDesc, setGroupDesc] = useState('');
  const [groupScreenIds, setGroupScreenIds] = useState<string[]>([]);
  const [groupError, setGroupError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setGroupName(editingGroup?.name ?? '');
    setGroupDesc(editingGroup?.description ?? '');
    setGroupScreenIds(editingGroup?.screenIds ?? []);
    setGroupError(null);
  }, [editingGroup, open]);

  const saveGroupMutation = useMutation({
    mutationFn: () => {
      if (editingGroup) {
        return api.updateGroup(editingGroup.id, {
          name: groupName.trim(),
          description: groupDesc.trim() || null,
          screenIds: groupScreenIds,
        });
      }
      return api.createGroup({
        name: groupName.trim(),
        description: groupDesc.trim() || undefined,
        screenIds: groupScreenIds,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['groups'] });
      onClose();
    },
    onError: (err) => {
      setGroupError(err instanceof Error ? err.message : 'Could not save group');
    },
  });

  const toggleGroupScreen = (screenId: string) => {
    setGroupScreenIds((prev) =>
      prev.includes(screenId) ? prev.filter((id) => id !== screenId) : [...prev, screenId],
    );
  };

  const handleSave = (e: FormEvent) => {
    e.preventDefault();
    if (!groupName.trim()) return;
    setGroupError(null);
    saveGroupMutation.mutate();
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{editingGroup ? 'Edit Screen Group' : 'Create Screen Group'}</DialogTitle>
          <DialogDescription>
            Select member displays for group-level campaign schedules.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSave} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="group-name">Group Name</Label>
            <Input
              id="group-name"
              type="text"
              required
              placeholder="e.g. Ground Floor Displays"
              value={groupName}
              onChange={(e) => setGroupName(e.target.value)}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="group-desc">Description (optional)</Label>
            <Input
              id="group-desc"
              type="text"
              placeholder="All atrium and reception screens"
              value={groupDesc}
              onChange={(e) => setGroupDesc(e.target.value)}
            />
          </div>

          <div className="space-y-1.5">
            <Label>Member Screens</Label>
            <div className="max-h-48 space-y-1.5 overflow-y-auto rounded-md border border-border bg-background p-2">
              {screens.length === 0 ? (
                <div className="p-2 text-xs text-muted-foreground">No paired screens available.</div>
              ) : (
                screens.map((s) => (
                  <label
                    key={s.id}
                    className="flex cursor-pointer items-center gap-2.5 rounded-sm px-2 py-1.5 text-xs hover:bg-accent"
                  >
                    <input
                      type="checkbox"
                      checked={groupScreenIds.includes(s.id)}
                      onChange={() => toggleGroupScreen(s.id)}
                      className="h-3.5 w-3.5 accent-white"
                    />
                    <span className="font-medium">{s.name}</span>
                    {s.location && <span className="text-muted-foreground">({s.location})</span>}
                  </label>
                ))
              )}
            </div>
          </div>

          {groupError && (
            <div className="rounded-md border border-destructive/40 bg-destructive/15 px-3 py-2 text-xs text-red-300">
              {groupError}
            </div>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={saveGroupMutation.isPending}>
              {saveGroupMutation.isPending ? 'Saving...' : 'Save Group'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
