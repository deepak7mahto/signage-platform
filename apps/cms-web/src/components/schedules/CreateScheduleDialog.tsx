import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState, type FormEvent } from 'react';
import type { Playlist, Schedule, ScheduleTargetType, Screen, ScreenGroup } from '@signage/shared';
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

export const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

interface CreateScheduleDialogProps {
  open: boolean;
  editingSchedule?: Schedule | null;
  screens: Screen[];
  groups: ScreenGroup[];
  playlists: Playlist[];
  onClose: () => void;
}

export function CreateScheduleDialog({
  open,
  editingSchedule = null,
  screens,
  groups,
  playlists,
  onClose,
}: CreateScheduleDialogProps) {
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [targetType, setTargetType] = useState<ScheduleTargetType>('group');
  const [targetId, setTargetId] = useState('');
  const [playlistId, setPlaylistId] = useState('');
  const [priority, setPriority] = useState('50');
  const [daysOfWeek, setDaysOfWeek] = useState<number[]>([0, 1, 2, 3, 4, 5, 6]);
  const [startTime, setStartTime] = useState('00:00');
  const [endTime, setEndTime] = useState('23:59');
  const [validFrom, setValidFrom] = useState('');
  const [validUntil, setValidUntil] = useState('');
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    if (editingSchedule) {
      setName(editingSchedule.name);
      setTargetType(editingSchedule.targetType);
      setTargetId(editingSchedule.targetId);
      setPlaylistId(editingSchedule.playlistId);
      setPriority(String(editingSchedule.priority));
      setDaysOfWeek(editingSchedule.daysOfWeek ?? [0, 1, 2, 3, 4, 5, 6]);
      setStartTime(editingSchedule.startTime);
      setEndTime(editingSchedule.endTime);
      setValidFrom(editingSchedule.validFrom ?? '');
      setValidUntil(editingSchedule.validUntil ?? '');
    } else {
      setName('');
      setTargetType('group');
      setTargetId('');
      setPlaylistId('');
      setPriority('50');
      setDaysOfWeek([0, 1, 2, 3, 4, 5, 6]);
      setStartTime('00:00');
      setEndTime('23:59');
      setValidFrom('');
      setValidUntil('');
    }
    setFormError(null);
  }, [editingSchedule, open]);

  const resetAndClose = () => {
    setFormError(null);
    onClose();
  };

  const saveMutation = useMutation({
    mutationFn: () => {
      const payload = {
        name: name.trim(),
        targetType,
        targetId,
        playlistId,
        priority: Number(priority) || 50,
        daysOfWeek: daysOfWeek.length > 0 ? daysOfWeek : [0, 1, 2, 3, 4, 5, 6],
        startTime,
        endTime,
        validFrom: validFrom || null,
        validUntil: validUntil || null,
      };
      return editingSchedule
        ? api.updateSchedule(editingSchedule.id, payload)
        : api.createSchedule({ ...payload, enabled: true });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['schedules'] });
      resetAndClose();
    },
    onError: (err) => {
      setFormError(err instanceof Error ? err.message : 'Could not save schedule');
    },
  });

  const toggleDay = (day: number) => {
    setDaysOfWeek((prev) => (prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day]));
  };

  const handleCreate = (e: FormEvent) => {
    e.preventDefault();
    if (!targetId || !playlistId) {
      setFormError('Select both a target and a playlist.');
      return;
    }
    setFormError(null);
    saveMutation.mutate();
  };

  const targetOptions = targetType === 'group' ? groups : screens;

  return (
    <Dialog open={open} onOpenChange={(next) => !next && resetAndClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{editingSchedule ? 'Edit Campaign Schedule' : 'Create Campaign Schedule'}</DialogTitle>
          <DialogDescription>
            Higher priority schedules override lower-priority campaigns and screen fallback loops.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleCreate} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="sched-name">Schedule Name</Label>
            <Input
              id="sched-name"
              type="text"
              required
              placeholder="e.g. Morning Rush Campaign"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Target Type</Label>
              <Select
                value={targetType}
                onValueChange={(v) => {
                  setTargetType(v as ScheduleTargetType);
                  setTargetId('');
                }}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="group">Screen Group</SelectItem>
                  <SelectItem value="screen">Single Screen</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label>{targetType === 'group' ? 'Group' : 'Screen'}</Label>
              <Select value={targetId} onValueChange={setTargetId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select target..." />
                </SelectTrigger>
                <SelectContent>
                  {targetOptions.map((opt) => (
                    <SelectItem key={opt.id} value={opt.id}>
                      {opt.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Playlist</Label>
              <Select value={playlistId} onValueChange={setPlaylistId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select playlist..." />
                </SelectTrigger>
                <SelectContent>
                  {playlists.map((pl) => (
                    <SelectItem key={pl.id} value={pl.id}>
                      {pl.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label>Priority Tier</Label>
              <Select value={priority} onValueChange={setPriority}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="10">Normal (10)</SelectItem>
                  <SelectItem value="50">Campaign (50)</SelectItem>
                  <SelectItem value="100">Emergency Override (100)</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Days of Week</Label>
            <div className="flex flex-wrap gap-1.5">
              {DAY_LABELS.map((label, idx) => {
                const active = daysOfWeek.includes(idx);
                return (
                  <button
                    key={label}
                    type="button"
                    onClick={() => toggleDay(idx)}
                    className={`cursor-pointer rounded-md border px-2.5 py-1 text-xs font-medium transition-colors ${
                      active
                        ? 'border-primary bg-primary text-primary-foreground'
                        : 'border-border bg-background text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="sched-start">Start Time</Label>
              <Input id="sched-start" type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="sched-end">End Time</Label>
              <Input id="sched-end" type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="sched-from">Flight Start (optional)</Label>
              <Input id="sched-from" type="date" value={validFrom} onChange={(e) => setValidFrom(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="sched-until">Flight End (optional)</Label>
              <Input id="sched-until" type="date" value={validUntil} onChange={(e) => setValidUntil(e.target.value)} />
            </div>
          </div>

          {formError && (
            <div className="rounded-md border border-destructive/40 bg-destructive/15 px-3 py-2 text-xs text-red-300">
              {formError}
            </div>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={resetAndClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={saveMutation.isPending}>
              {saveMutation.isPending
                ? 'Saving...'
                : editingSchedule
                  ? 'Save Changes'
                  : 'Create Schedule'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
