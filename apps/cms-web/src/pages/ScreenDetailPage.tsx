import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft,
  Camera,
  ExternalLink,
  Monitor,
  Moon,
  Power,
  RefreshCw,
  RotateCw,
  Wifi,
  WifiOff,
} from 'lucide-react';
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { RemoteCommandType } from '@signage/shared';
import { ScreenLayoutFormCard } from '../components/screens/ScreenLayoutFormCard';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../components/ui/table';
import { api } from '../lib/api';

export function ScreenDetailPage() {
  const { id } = useParams<{ id: string }>();
  const queryClient = useQueryClient();
  const [pollingFast, setPollingFast] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['screens', id],
    queryFn: () => api.getScreenDetail(id!),
    enabled: Boolean(id),
    refetchInterval: pollingFast ? 1500 : 10_000,
  });

  const commandMutation = useMutation({
    mutationFn: ({
      command,
      payload,
    }: {
      command: RemoteCommandType;
      payload?: Record<string, unknown>;
    }) => api.sendScreenCommand(id!, command, payload),
    onSuccess: () => {
      setPollingFast(true);
      queryClient.invalidateQueries({ queryKey: ['screens', id] });
      window.setTimeout(() => setPollingFast(false), 6000);
    },
  });

  if (isLoading || !data) {
    return (
      <div className="py-12 text-center text-sm text-muted-foreground">
        Loading screen console...
      </div>
    );
  }

  const { screen, latestScreenshot, commands } = data;
  const hw = screen.hwInfo ?? {};

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <Button variant="outline" size="icon" asChild>
            <Link to="/screens">
              <ArrowLeft className="h-4 w-4" />
            </Link>
          </Button>
          <div>
            <div className="flex items-center gap-2.5">
              <h1 className="text-2xl font-bold tracking-tight">{screen.name}</h1>
              <Badge variant={screen.status === 'online' ? 'success' : 'secondary'}>
                {screen.status === 'online' ? <Wifi className="h-3 w-3" /> : <WifiOff className="h-3 w-3" />}
                {screen.status}
              </Badge>
            </div>
            <p className="text-xs text-muted-foreground">
              {screen.location || 'No location'} • {screen.timezone} • ID {screen.id}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Button variant="outline" asChild>
            <a href={`/sim/?previewScreenId=${screen.id}&hud=1`} target="_blank" rel="noreferrer">
              <ExternalLink className="h-4 w-4" />
              Preview in New Tab
            </a>
          </Button>
          <Button
            onClick={() => commandMutation.mutate({ command: 'take_screenshot' })}
            disabled={commandMutation.isPending}
          >
            <Camera className="h-4 w-4" />
            Capture Screenshot
          </Button>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader className="flex flex-row items-center justify-between space-y-0">
            <div>
              <CardTitle>Live Screen Snapshot</CardTitle>
              <CardDescription>
                {latestScreenshot
                  ? `Captured at ${new Date(latestScreenshot.capturedAt).toLocaleString()}`
                  : 'No screenshot captured yet — click Capture Screenshot while screen is online.'}
              </CardDescription>
            </div>
          </CardHeader>
          <CardContent>
            <div className="flex aspect-video items-center justify-center overflow-hidden rounded-md border border-border bg-black">
              {latestScreenshot ? (
                <img
                  src={latestScreenshot.url}
                  alt={`Screenshot of ${screen.name}`}
                  className="h-full w-full object-contain"
                />
              ) : (
                <div className="flex flex-col items-center gap-2 text-muted-foreground">
                  <Monitor className="h-8 w-8" />
                  <span className="text-xs">Awaiting live snapshot</span>
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Remote Controls</CardTitle>
              <CardDescription>Sent over outbound WebSocket (wss://)</CardDescription>
            </CardHeader>
            <CardContent className="grid grid-cols-2 gap-2">
              <Button variant="outline" size="sm" onClick={() => commandMutation.mutate({ command: 'sync_now' })}>
                <RefreshCw className="h-3.5 w-3.5" />
                Push Sync
              </Button>
              <Button variant="outline" size="sm" onClick={() => commandMutation.mutate({ command: 'take_screenshot' })}>
                <Camera className="h-3.5 w-3.5" />
                Screenshot
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => commandMutation.mutate({ command: 'cec_power', payload: { state: 'standby' } })}
              >
                <Moon className="h-3.5 w-3.5" />
                TV Standby
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => commandMutation.mutate({ command: 'cec_power', payload: { state: 'on' } })}
              >
                <Power className="h-3.5 w-3.5" />
                TV Power On
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="col-span-2"
                onClick={() => commandMutation.mutate({ command: 'reboot' })}
              >
                <RotateCw className="h-3.5 w-3.5" />
                Reboot Player
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Device Telemetry</CardTitle>
              <CardDescription>Latest heartbeat report</CardDescription>
            </CardHeader>
            <CardContent>
              <dl className="space-y-2 text-xs">
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">App Version</dt>
                  <dd className="font-mono">{screen.appVersion ?? '—'}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">Fallback Playlist</dt>
                  <dd>{screen.activePlaylistName ?? 'None'}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">Resolution</dt>
                  <dd className="font-mono">{typeof hw.screen === 'string' ? hw.screen : '—'}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">Last Seen</dt>
                  <dd>{screen.lastSeenAt ? new Date(screen.lastSeenAt).toLocaleTimeString() : 'Never'}</dd>
                </div>
              </dl>
            </CardContent>
          </Card>
        </div>
      </div>

      <ScreenLayoutFormCard screen={screen} />

      <Card className="overflow-hidden">
        <CardHeader>
          <CardTitle>Recent Remote Commands</CardTitle>
          <CardDescription>Command delivery and device acknowledgement log</CardDescription>
        </CardHeader>
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>Command</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Detail</TableHead>
              <TableHead>Sent At</TableHead>
              <TableHead>Acked At</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {commands.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="py-6 text-center text-xs text-muted-foreground">
                  No remote commands sent to this display yet.
                </TableCell>
              </TableRow>
            ) : (
              commands.map((cmd) => (
                <TableRow key={cmd.id}>
                  <TableCell className="font-mono text-xs">{cmd.command}</TableCell>
                  <TableCell>
                    <Badge
                      variant={
                        cmd.status === 'acked' ? 'success' : cmd.status === 'failed' ? 'destructive' : 'warning'
                      }
                    >
                      {cmd.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">{cmd.detail ?? '—'}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {new Date(cmd.createdAt).toLocaleTimeString()}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {cmd.ackedAt ? new Date(cmd.ackedAt).toLocaleTimeString() : '—'}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}
