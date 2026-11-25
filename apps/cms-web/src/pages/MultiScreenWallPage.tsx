import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Columns2, Columns3, Info, PlayCircle, ShieldAlert } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { WallTileCard } from '../components/wall/WallTileCard';
import {
  EMERGENCY_SCHEDULE_NAME,
  WALL_SCENARIOS,
  type TileStatusMessage,
} from '../components/wall/scenarios';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { api } from '../lib/api';

export function MultiScreenWallPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const queryClient = useQueryClient();

  const cols = searchParams.get('cols') === '3' ? '3' : '2';
  const showHud = searchParams.get('hud') === '1';

  const [tileStatuses, setTileStatuses] = useState<Record<string, TileStatusMessage>>({});
  const [wallNotice, setWallNotice] = useState<string | null>(null);
  const iframeRefs = useRef<Record<string, HTMLIFrameElement | null>>({});

  const { data: playlistsData } = useQuery({ queryKey: ['playlists'], queryFn: api.listPlaylists });
  const { data: groupsData } = useQuery({ queryKey: ['groups'], queryFn: api.listGroups });
  const { data: schedulesData } = useQuery({
    queryKey: ['schedules'],
    queryFn: api.listSchedules,
    refetchInterval: 5000,
  });

  const playlists = playlistsData?.items ?? [];
  const groups = groupsData?.items ?? [];
  const schedules = schedulesData?.items ?? [];

  const emergencySchedule = useMemo(
    () => schedules.find((s) => s.name === EMERGENCY_SCHEDULE_NAME) ?? null,
    [schedules],
  );

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;
      const msg = event.data as TileStatusMessage | null;
      if (!msg || typeof msg !== 'object' || msg.type !== 'signage:status' || !msg.slot) return;
      setTileStatuses((prev) => ({ ...prev, [msg.slot]: msg }));
    };

    window.addEventListener('message', onMessage);
    for (const frame of Object.values(iframeRefs.current)) {
      frame?.contentWindow?.postMessage({ type: 'signage:request_status' }, window.location.origin);
    }
    return () => window.removeEventListener('message', onMessage);
  }, []);

  useEffect(() => {
    for (const frame of Object.values(iframeRefs.current)) {
      frame?.contentWindow?.postMessage({ type: 'signage:set_hud', show: showHud }, window.location.origin);
    }
  }, [showHud]);

  const setCols = (nextCols: '2' | '3') => {
    const next = new URLSearchParams(searchParams);
    if (nextCols === '2') next.delete('cols');
    else next.set('cols', nextCols);
    setSearchParams(next);
  };

  const toggleHud = () => {
    const next = new URLSearchParams(searchParams);
    if (showHud) next.delete('hud');
    else next.set('hud', '1');
    setSearchParams(next);
  };

  const pairAllMutation = useMutation({
    mutationFn: async () => {
      const latestPlaylists = (await api.listPlaylists()).items;
      let latestGroups = (await api.listGroups()).items;
      const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
      let pairedCount = 0;

      for (const scenario of WALL_SCENARIOS) {
        const st = tileStatuses[scenario.slot];
        if (!st || st.state !== 'pairing' || !st.code) continue;

        const targetPlaylist =
          latestPlaylists.find((p) => p.name === scenario.defaultPlaylistName) ?? latestPlaylists[0];

        const { screen } = await api.pairScreen({
          code: st.code,
          name: scenario.name,
          location: scenario.location,
          timezone,
          activePlaylistId: targetPlaylist?.id ?? null,
        });

        await api.updateScreen(screen.id, {
          city: scenario.city,
          venueType: scenario.venueType,
          orientation: scenario.orientation,
          layout: scenario.layout,
        });

        for (const groupName of scenario.groups) {
          const existing = latestGroups.find((g) => g.name === groupName);
          if (existing) {
            if (!existing.screenIds.includes(screen.id)) {
              const updatedIds = [...existing.screenIds, screen.id];
              await api.updateGroup(existing.id, { screenIds: updatedIds });
              existing.screenIds = updatedIds;
            }
          } else {
            const { group } = await api.createGroup({ name: groupName, screenIds: [screen.id] });
            latestGroups = [...latestGroups, group];
          }
        }
        pairedCount += 1;
      }
      return pairedCount;
    },
    onSuccess: (count) => {
      queryClient.invalidateQueries({ queryKey: ['screens'] });
      queryClient.invalidateQueries({ queryKey: ['groups'] });
      queryClient.invalidateQueries({ queryKey: ['schedules'] });
      setWallNotice(
        count > 0
          ? `Paired ${count} virtual display${count === 1 ? '' : 's'} with orientation, fit mode, layouts & groups.`
          : 'All visible virtual displays are already paired.',
      );
      window.setTimeout(() => setWallNotice(null), 4000);
    },
  });

  const emergencyMutation = useMutation({
    mutationFn: async () => {
      if (!emergencySchedule) throw new Error(`Schedule "${EMERGENCY_SCHEDULE_NAME}" not found`);
      return api.updateSchedule(emergencySchedule.id, { enabled: !emergencySchedule.enabled });
    },
    onSuccess: ({ schedule }) => {
      queryClient.invalidateQueries({ queryKey: ['schedules'] });
      setWallNotice(
        schedule.enabled
          ? 'Emergency Override ACTIVE on North India Network (WebSocket sync pushed).'
          : 'Emergency Override cleared — North India displays resumed normal schedules.',
      );
      window.setTimeout(() => setWallNotice(null), 4000);
    },
  });

  const syncTile = useCallback(async (screenId: string) => {
    await api.syncScreen(screenId);
    setWallNotice('Instant WebSocket sync pushed.');
    window.setTimeout(() => setWallNotice(null), 2500);
  }, []);

  const unpairedReadyCount = WALL_SCENARIOS.filter((s) => {
    const st = tileStatuses[s.slot];
    return st?.state === 'pairing' && Boolean(st.code);
  }).length;
  const pairedCount = WALL_SCENARIOS.filter((s) => tileStatuses[s.slot]?.state === 'paired').length;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="text-2xl font-bold tracking-tight">Live Multi-Screen Wall</h1>
            <Badge variant={pairedCount === WALL_SCENARIOS.length ? 'success' : 'secondary'}>
              {pairedCount} / {WALL_SCENARIOS.length} Paired Live
            </Badge>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            Mixed-orientation browser Web Players (16:9 landscape, 9:16 portrait kiosk, 21:9 ultrawide)
            with auto-reflow layouts, blur fill, and real-time WebSocket sync.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex rounded-md border border-border bg-card p-1">
            <button
              type="button"
              onClick={() => setCols('2')}
              className={`flex cursor-pointer items-center gap-1.5 rounded-sm px-2.5 py-1 text-xs font-medium ${
                cols === '2' ? 'bg-accent text-accent-foreground' : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              <Columns2 className="h-3.5 w-3.5" />
              2×N Grid
            </button>
            <button
              type="button"
              onClick={() => setCols('3')}
              className={`flex cursor-pointer items-center gap-1.5 rounded-sm px-2.5 py-1 text-xs font-medium ${
                cols === '3' ? 'bg-accent text-accent-foreground' : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              <Columns3 className="h-3.5 w-3.5" />
              3-Col
            </button>
          </div>

          <Button variant={showHud ? 'default' : 'outline'} size="sm" onClick={toggleHud}>
            <Info className="h-3.5 w-3.5" />
            Toggle HUDs
          </Button>

          {unpairedReadyCount > 0 && (
            <Button
              size="sm"
              onClick={() => pairAllMutation.mutate()}
              disabled={pairAllMutation.isPending || playlists.length === 0}
            >
              <PlayCircle className="h-4 w-4" />
              {pairAllMutation.isPending
                ? 'Pairing Fleet...'
                : `Pair All Virtual Screens (${unpairedReadyCount})`}
            </Button>
          )}

          {emergencySchedule && (
            <Button
              size="sm"
              variant={emergencySchedule.enabled ? 'destructive' : 'outline'}
              onClick={() => emergencyMutation.mutate()}
              disabled={emergencyMutation.isPending}
            >
              {emergencySchedule.enabled ? (
                <>
                  <ShieldAlert className="h-4 w-4" />
                  Clear Emergency Override
                </>
              ) : (
                <>
                  <AlertTriangle className="h-4 w-4 text-amber-400" />
                  Trigger Emergency Override (North India)
                </>
              )}
            </Button>
          )}
        </div>
      </div>

      {wallNotice && (
        <div className="rounded-md border border-border bg-card px-4 py-2.5 text-xs font-medium text-foreground">
          {wallNotice}
        </div>
      )}

      {groups.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <span className="font-medium text-foreground">Active Groups:</span>
          {groups.map((g) => (
            <Badge key={g.id} variant="outline" className="text-[11px]">
              {g.name} ({g.screenIds.length})
            </Badge>
          ))}
        </div>
      )}

      <div
        className={`grid gap-5 ${
          cols === '3' ? 'grid-cols-1 md:grid-cols-2 xl:grid-cols-3' : 'grid-cols-1 lg:grid-cols-2'
        }`}
      >
        {WALL_SCENARIOS.map((scenario) => (
          <WallTileCard
            key={scenario.slot}
            scenario={scenario}
            status={tileStatuses[scenario.slot]}
            showHud={showHud}
            onSyncTile={syncTile}
            setIframeRef={(el) => {
              iframeRefs.current[scenario.slot] = el;
            }}
          />
        ))}
      </div>
    </div>
  );
}
