import { useQuery } from '@tanstack/react-query';
import { BarChart3, CheckCircle2, Clock, Download, Monitor, Play } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../components/ui/table';
import { api } from '../lib/api';

const ALL_VALUE = '__all__';

function formatDuration(ms: number): string {
  const totalSec = Math.round(ms / 1000);
  if (totalSec < 60) return `${totalSec}s`;
  const mins = Math.floor(totalSec / 60);
  const secs = totalSec % 60;
  if (mins < 60) return `${mins}m ${secs}s`;
  const hrs = Math.floor(mins / 60);
  return `${hrs}h ${mins % 60}m`;
}

export function AnalyticsPage() {
  const [searchParams, setSearchParams] = useSearchParams();

  const from = searchParams.get('from') ?? '';
  const to = searchParams.get('to') ?? '';
  const screenId = searchParams.get('screenId') ?? '';
  const assetId = searchParams.get('assetId') ?? '';

  const filters = {
    from: from || undefined,
    to: to || undefined,
    screenId: screenId || undefined,
    assetId: assetId || undefined,
  };

  const { data: report, isLoading } = useQuery({
    queryKey: ['reports', 'pop', filters],
    queryFn: () => api.getPopReport(filters),
    refetchInterval: 10_000,
  });

  const { data: screensData } = useQuery({
    queryKey: ['screens'],
    queryFn: api.listScreens,
  });

  const { data: mediaData } = useQuery({
    queryKey: ['media'],
    queryFn: api.listMedia,
  });

  const updateFilter = (key: string, value: string) => {
    const next = new URLSearchParams(searchParams);
    if (!value || value === ALL_VALUE) next.delete(key);
    else next.set(key, value);
    setSearchParams(next, { replace: true });
  };

  const screens = screensData?.items ?? [];
  const assets = mediaData?.items ?? [];
  const exportUrl = api.getPopExportUrl(filters);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Proof-of-Play Analytics</h1>
          <p className="text-sm text-muted-foreground">
            Partitioned PostgreSQL impression ledger with idempotent offline replay and CSV export.
          </p>
        </div>

        <Button asChild>
          <a href={exportUrl} download="proof-of-play.csv">
            <Download className="h-4 w-4" />
            Export CSV
          </a>
        </Button>
      </div>

      {/* URL-Driven Filters */}
      <Card className="p-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="space-y-1.5">
            <Label htmlFor="pop-from">From Date</Label>
            <Input
              id="pop-from"
              type="date"
              value={from}
              onChange={(e) => updateFilter('from', e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pop-to">To Date</Label>
            <Input
              id="pop-to"
              type="date"
              value={to}
              onChange={(e) => updateFilter('to', e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Screen</Label>
            <Select
              value={screenId || ALL_VALUE}
              onValueChange={(v) => updateFilter('screenId', v)}
            >
              <SelectTrigger>
                <SelectValue placeholder="All Screens" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL_VALUE}>All Screens</SelectItem>
                {screens.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Media Asset</Label>
            <Select
              value={assetId || ALL_VALUE}
              onValueChange={(v) => updateFilter('assetId', v)}
            >
              <SelectTrigger>
                <SelectValue placeholder="All Assets" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL_VALUE}>All Assets</SelectItem>
                {assets.map((a) => (
                  <SelectItem key={a.id} value={a.id}>
                    {a.title}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </Card>

      {/* KPI Cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardDescription>Total Plays</CardDescription>
            <Play className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{report?.totalPlays ?? 0}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardDescription>Completed Plays</CardDescription>
            <CheckCircle2 className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{report?.completedPlays ?? 0}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardDescription>Total Airtime</CardDescription>
            <Clock className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {formatDuration(report?.totalDurationMs ?? 0)}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardDescription>Active Screens</CardDescription>
            <Monitor className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{report?.activeScreens ?? 0}</div>
          </CardContent>
        </Card>
      </div>

      {isLoading ? (
        <div className="py-12 text-center text-sm text-muted-foreground">Loading Proof-of-Play report...</div>
      ) : (
        <>
          <Card className="overflow-hidden">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <BarChart3 className="h-4 w-4" />
                Playback by Asset
              </CardTitle>
            </CardHeader>
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>Asset</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Plays</TableHead>
                  <TableHead>Completed</TableHead>
                  <TableHead>Total Airtime</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(report?.byAsset ?? []).length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} className="py-6 text-center text-xs text-muted-foreground">
                      No Proof-of-Play impressions recorded in this range yet.
                    </TableCell>
                  </TableRow>
                ) : (
                  report!.byAsset.map((row) => (
                    <TableRow key={row.mediaAssetId}>
                      <TableCell className="font-medium">{row.title}</TableCell>
                      <TableCell>
                        <Badge variant="outline">{row.type}</Badge>
                      </TableCell>
                      <TableCell>{row.plays}</TableCell>
                      <TableCell>{row.completedPlays}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {formatDuration(row.totalDurationMs)}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </Card>

          <Card className="overflow-hidden">
            <CardHeader>
              <CardTitle>Recent Impressions</CardTitle>
              <CardDescription>Latest verified play events (up to 200)</CardDescription>
            </CardHeader>
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>Asset</TableHead>
                  <TableHead>Screen</TableHead>
                  <TableHead>Playlist</TableHead>
                  <TableHead>Started At</TableHead>
                  <TableHead>Duration</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(report?.recent ?? []).length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="py-6 text-center text-xs text-muted-foreground">
                      No impressions logged yet.
                    </TableCell>
                  </TableRow>
                ) : (
                  report!.recent.map((row) => (
                    <TableRow key={row.id}>
                      <TableCell className="font-medium">{row.assetTitle}</TableCell>
                      <TableCell className="text-xs">{row.screenName}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {row.playlistName ?? 'Fallback'}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {new Date(row.startedAt).toLocaleString()}
                      </TableCell>
                      <TableCell className="text-xs">
                        {(row.durationMs / 1000).toFixed(1)}s
                      </TableCell>
                      <TableCell>
                        <Badge variant={row.status === 'completed' ? 'success' : 'warning'}>
                          {row.status}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </Card>
        </>
      )}
    </div>
  );
}
