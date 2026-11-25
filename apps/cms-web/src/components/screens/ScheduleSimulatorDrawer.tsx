import { useMutation } from '@tanstack/react-query';
import { CalendarSearch, Play } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { ScheduleSimulationResponse } from '@signage/shared';
import { api } from '../../lib/api';
import { Badge } from '../ui/badge';
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../ui/table';

function toLocalInputValue(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(
    date.getHours(),
  )}:${pad(date.getMinutes())}`;
}

interface ScheduleSimulatorDrawerProps {
  open: boolean;
  screenId: string;
  screenName: string;
  timezone: string;
  onClose: () => void;
}

export function ScheduleSimulatorDrawer({
  open,
  screenId,
  screenName,
  timezone,
  onClose,
}: ScheduleSimulatorDrawerProps) {
  const [atLocal, setAtLocal] = useState(() => toLocalInputValue(new Date()));
  const [simResult, setSimResult] = useState<ScheduleSimulationResponse | null>(null);
  const [simError, setSimError] = useState<string | null>(null);

  const simMutation = useMutation({
    mutationFn: (isoAt?: string) => api.simulateScreenSchedule(screenId, isoAt),
    onSuccess: (res) => {
      setSimResult(res);
      setSimError(null);
    },
    onError: (err) => {
      setSimError(err instanceof Error ? err.message : 'Simulation failed');
    },
  });

  const runSimulation = (localValue: string) => {
    const parsed = new Date(localValue);
    const iso = Number.isFinite(parsed.getTime()) ? parsed.toISOString() : undefined;
    simMutation.mutate(iso);
  };

  useEffect(() => {
    if (open) {
      const nowStr = toLocalInputValue(new Date());
      setAtLocal(nowStr);
      runSimulation(nowStr);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, screenId]);

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CalendarSearch className="h-4 w-4" />
            Schedule Dry-Run Simulator — {screenName}
          </DialogTitle>
          <DialogDescription>
            Evaluate which playlist wins at any timestamp in display timezone ({timezone}) and
            inspect why higher/lower schedules matched or were skipped.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-wrap items-end gap-3">
          <div className="flex-1 space-y-1.5">
            <Label htmlFor="sim-at">Evaluate At (Local Browser Time)</Label>
            <Input
              id="sim-at"
              type="datetime-local"
              value={atLocal}
              onChange={(e) => setAtLocal(e.target.value)}
            />
          </div>
          <Button
            type="button"
            onClick={() => runSimulation(atLocal)}
            disabled={simMutation.isPending}
          >
            <Play className="h-3.5 w-3.5" />
            {simMutation.isPending ? 'Simulating...' : 'Run Simulation'}
          </Button>
        </div>

        {simError && (
          <div className="rounded-md border border-destructive/40 bg-destructive/15 px-3 py-2 text-xs text-red-300">
            {simError}
          </div>
        )}

        {simResult && (
          <div className="space-y-4">
            <div className="grid gap-3 rounded-md border border-border bg-background/60 p-3 sm:grid-cols-3">
              <div>
                <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
                  Winning Playlist
                </div>
                <div className="mt-0.5 text-sm font-semibold">
                  {simResult.winningPlaylistName ?? 'None (Idle Slate)'}
                </div>
              </div>
              <div>
                <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
                  Winning Rule
                </div>
                <div className="mt-0.5 text-sm">
                  {simResult.winningScheduleName ?? 'Fallback Playlist'}
                </div>
              </div>
              <div>
                <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
                  Playable Items
                </div>
                <div className="mt-0.5 font-mono text-sm font-semibold">{simResult.itemCount}</div>
              </div>
            </div>

            <div className="max-h-64 overflow-y-auto rounded-md border border-border">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead>Schedule</TableHead>
                    <TableHead>Priority</TableHead>
                    <TableHead>Result</TableHead>
                    <TableHead>Why / Why Not</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {simResult.trace.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={4} className="py-6 text-center text-xs text-muted-foreground">
                        No schedules target this screen or its groups.
                      </TableCell>
                    </TableRow>
                  ) : (
                    simResult.trace.map((item) => (
                      <TableRow key={item.scheduleId}>
                        <TableCell className="text-xs font-medium">{item.scheduleName}</TableCell>
                        <TableCell className="font-mono text-xs">{item.priority}</TableCell>
                        <TableCell>
                          <Badge variant={item.matched ? 'success' : 'secondary'}>
                            {item.matched ? 'Matched' : 'Skipped'}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">{item.reason}</TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          </div>
        )}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
