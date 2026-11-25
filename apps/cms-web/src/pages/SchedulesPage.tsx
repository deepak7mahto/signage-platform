import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarClock, Pause, Pencil, Play, Plus, Trash2 } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import { CreateScheduleDialog, DAY_LABELS } from '../components/schedules/CreateScheduleDialog';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Card } from '../components/ui/card';
import { ListToolbar, PaginationBar, paginateItems } from '../components/ui/list-controls';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../components/ui/table';
import { api } from '../lib/api';

function formatDays(days: number[]): string {
  if (days.length === 0 || days.length === 7) return 'Daily';
  return days
    .slice()
    .sort((a, b) => a - b)
    .map((d) => DAY_LABELS[d] ?? String(d))
    .join(', ');
}

function priorityBadge(priority: number) {
  if (priority >= 100) return <Badge variant="destructive">Override ({priority})</Badge>;
  if (priority >= 50) return <Badge variant="warning">Campaign ({priority})</Badge>;
  return <Badge variant="secondary">Normal ({priority})</Badge>;
}

export function SchedulesPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const queryClient = useQueryClient();
  const isCreateOpen = searchParams.get('modal') === 'new';
  const editId = searchParams.get('edit');
  const searchQuery = searchParams.get('q') ?? '';
  const stateFilter = searchParams.get('state') ?? 'all';
  const pageParam = searchParams.get('page');

  const { data: schedulesData, isLoading } = useQuery({ queryKey: ['schedules'], queryFn: api.listSchedules });
  const { data: screensData } = useQuery({ queryKey: ['screens'], queryFn: api.listScreens });
  const { data: groupsData } = useQuery({ queryKey: ['groups'], queryFn: api.listGroups });
  const { data: playlistsData } = useQuery({ queryKey: ['playlists'], queryFn: api.listPlaylists });

  const toggleMutation = useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) => api.updateSchedule(id, { enabled }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['schedules'] }),
  });

  const deleteMutation = useMutation({
    mutationFn: api.deleteSchedule,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['schedules'] }),
  });

  const updateParams = (mutate: (next: URLSearchParams) => void, replace = false) => {
    const next = new URLSearchParams(searchParams);
    mutate(next);
    setSearchParams(next, { replace });
  };

  const schedules = schedulesData?.items ?? [];
  const editingSchedule = editId ? (schedules.find((s) => s.id === editId) ?? null) : null;

  const qLower = searchQuery.trim().toLowerCase();
  const filtered = schedules.filter((s) => {
    const matchesQ = qLower
      ? s.name.toLowerCase().includes(qLower) ||
        (s.targetName ?? '').toLowerCase().includes(qLower) ||
        (s.playlistName ?? '').toLowerCase().includes(qLower)
      : true;
    const matchesState =
      stateFilter === 'all' ||
      (stateFilter === 'active' && s.enabled) ||
      (stateFilter === 'paused' && !s.enabled);
    return matchesQ && matchesState;
  });
  const paged = paginateItems(filtered, pageParam, 10);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Campaign Schedules</h1>
          <p className="text-sm text-muted-foreground">
            Schedule dayparted playlists and priority overrides across screens or groups. Evaluated offline on players.
          </p>
        </div>

        <Button
          onClick={() =>
            updateParams((n) => {
              n.set('modal', 'new');
              n.delete('edit');
            })
          }
        >
          <Plus className="h-4 w-4" />
          New Schedule
        </Button>
      </div>

      <ListToolbar
        searchPlaceholder="Search schedules, targets, or playlists..."
        searchValue={searchQuery}
        onSearchChange={(val) =>
          updateParams((n) => {
            if (val) n.set('q', val);
            else n.delete('q');
            n.delete('page');
          }, true)
        }
        filterValue={stateFilter}
        filterOptions={[
          { value: 'all', label: 'All States' },
          { value: 'active', label: 'Active' },
          { value: 'paused', label: 'Paused' },
        ]}
        onFilterChange={(val) =>
          updateParams((n) => {
            if (val === 'all') n.delete('state');
            else n.set('state', val);
            n.delete('page');
          })
        }
        totalCount={filtered.length}
      />

      {isLoading ? (
        <div className="py-12 text-center text-sm text-muted-foreground">Loading schedules...</div>
      ) : paged.pageItems.length === 0 ? (
        <Card className="border-dashed p-12 text-center">
          <CalendarClock className="mx-auto mb-3 h-8 w-8 text-muted-foreground" />
          <p className="text-sm font-medium">No matching schedules</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Create a schedule to target a screen or group by time-of-day, days of week, and priority.
          </p>
        </Card>
      ) : (
        <>
          <Card className="overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>Schedule</TableHead>
                  <TableHead>Target</TableHead>
                  <TableHead>Playlist</TableHead>
                  <TableHead>Daypart & Flight</TableHead>
                  <TableHead>Priority</TableHead>
                  <TableHead>State</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {paged.pageItems.map((sched) => (
                  <TableRow key={sched.id}>
                    <TableCell className="font-medium">{sched.name}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1.5">
                        <Badge variant="outline" className="capitalize">
                          {sched.targetType}
                        </Badge>
                        <span className="text-xs">{sched.targetName ?? sched.targetId.slice(0, 8)}</span>
                      </div>
                    </TableCell>
                    <TableCell className="text-xs">{sched.playlistName ?? sched.playlistId}</TableCell>
                    <TableCell>
                      <div className="text-xs">
                        {formatDays(sched.daysOfWeek)} • {sched.startTime}–{sched.endTime}
                      </div>
                      {(sched.validFrom || sched.validUntil) && (
                        <div className="text-[11px] text-muted-foreground">
                          {sched.validFrom ?? '…'} → {sched.validUntil ?? '…'}
                        </div>
                      )}
                    </TableCell>
                    <TableCell>{priorityBadge(sched.priority)}</TableCell>
                    <TableCell>
                      <Badge variant={sched.enabled ? 'success' : 'secondary'}>
                        {sched.enabled ? 'Active' : 'Paused'}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="inline-flex items-center gap-1.5">
                        <Button
                          variant="outline"
                          size="icon"
                          className="h-8 w-8"
                          title="Edit schedule"
                          onClick={() =>
                            updateParams((n) => {
                              n.set('edit', sched.id);
                              n.delete('modal');
                            })
                          }
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => toggleMutation.mutate({ id: sched.id, enabled: !sched.enabled })}
                        >
                          {sched.enabled ? (
                            <>
                              <Pause className="h-3.5 w-3.5" />
                              Pause
                            </>
                          ) : (
                            <>
                              <Play className="h-3.5 w-3.5" />
                              Enable
                            </>
                          )}
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => deleteMutation.mutate(sched.id)}
                          className="h-8 w-8 text-red-300 hover:bg-destructive/15"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>

          <PaginationBar
            page={paged.page}
            totalPages={paged.totalPages}
            totalItems={paged.totalItems}
            startIdx={paged.startIdx}
            endIdx={paged.endIdx}
            onPageChange={(p) => updateParams((n) => (p <= 1 ? n.delete('page') : n.set('page', String(p))))}
          />
        </>
      )}

      <CreateScheduleDialog
        open={isCreateOpen || Boolean(editingSchedule)}
        editingSchedule={editingSchedule}
        screens={screensData?.items ?? []}
        groups={groupsData?.items ?? []}
        playlists={playlistsData?.items ?? []}
        onClose={() =>
          updateParams((n) => {
            n.delete('modal');
            n.delete('edit');
          })
        }
      />
    </div>
  );
}
