import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, RefreshCw, Rss, Trash2 } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { api } from '../../lib/api';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Card } from '../ui/card';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../ui/table';

export function FeedsPanel() {
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [sourceUrl, setSourceUrl] = useState('');
  const [pollIntervalSec, setPollIntervalSec] = useState('300');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const { data, isLoading } = useQuery({ queryKey: ['feeds'], queryFn: api.listFeeds });

  const createMutation = useMutation({
    mutationFn: api.createFeed,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['feeds'] });
      setName('');
      setSourceUrl('');
      setErrorMsg(null);
    },
    onError: (err) => setErrorMsg(err instanceof Error ? err.message : 'Failed to create feed'),
  });

  const refreshMutation = useMutation({
    mutationFn: api.refreshFeed,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['feeds'] }),
  });

  const deleteMutation = useMutation({
    mutationFn: api.deleteFeed,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['feeds'] }),
  });

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    createMutation.mutate({
      name: name.trim(),
      sourceUrl: sourceUrl.trim(),
      pollIntervalSec: Math.max(30, Number(pollIntervalSec) || 300),
      headers: {},
    });
  };

  const feeds = data?.items ?? [];

  return (
    <div className="space-y-6">
      <Card className="p-5">
        <form onSubmit={handleSubmit} className="grid gap-4 md:grid-cols-4 md:items-end">
          <div className="space-y-1.5">
            <Label htmlFor="feed-name">Feed Key</Label>
            <Input
              id="feed-name"
              required
              placeholder="e.g. menu_prices"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="space-y-1.5 md:col-span-2">
            <Label htmlFor="feed-url">JSON Source URL (SSRF Protected)</Label>
            <Input
              id="feed-url"
              type="url"
              required
              placeholder="https://api.example.com/signage-feed.json"
              value={sourceUrl}
              onChange={(e) => setSourceUrl(e.target.value)}
            />
          </div>
          <div className="flex items-end gap-2">
            <div className="w-24 space-y-1.5">
              <Label htmlFor="feed-interval">Poll (s)</Label>
              <Input
                id="feed-interval"
                type="number"
                min={30}
                value={pollIntervalSec}
                onChange={(e) => setPollIntervalSec(e.target.value)}
              />
            </div>
            <Button type="submit" disabled={createMutation.isPending}>
              <Plus className="h-4 w-4" />
              Add
            </Button>
          </div>
        </form>
        {errorMsg && (
          <div className="mt-3 rounded-md border border-destructive/40 bg-destructive/15 px-3 py-2 text-xs text-red-300">
            {errorMsg}
          </div>
        )}
      </Card>

      {isLoading ? (
        <div className="py-10 text-center text-sm text-muted-foreground">Loading feeds...</div>
      ) : feeds.length === 0 ? (
        <Card className="border-dashed p-10 text-center text-sm text-muted-foreground">
          <Rss className="mx-auto mb-2 h-7 w-7" />
          No JSON feeds configured. Server-polled payloads embed directly into offline device manifests.
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Name</TableHead>
                <TableHead>Source URL</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Last Fetched</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {feeds.map((feed) => (
                <TableRow key={feed.id}>
                  <TableCell className="font-mono text-xs font-semibold">{feed.name}</TableCell>
                  <TableCell className="max-w-xs truncate text-xs text-muted-foreground">
                    {feed.sourceUrl}
                  </TableCell>
                  <TableCell>
                    {feed.lastError ? (
                      <Badge variant="destructive">{feed.lastError}</Badge>
                    ) : feed.lastPayload ? (
                      <Badge variant="success">Cached</Badge>
                    ) : (
                      <Badge variant="secondary">Pending</Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {feed.lastFetchedAt ? new Date(feed.lastFetchedAt).toLocaleTimeString() : 'Never'}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="inline-flex items-center gap-1.5">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => refreshMutation.mutate(feed.id)}
                        disabled={refreshMutation.isPending}
                      >
                        <RefreshCw className="h-3.5 w-3.5" />
                        Poll Now
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-red-300 hover:bg-destructive/15"
                        onClick={() => deleteMutation.mutate(feed.id)}
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
      )}
    </div>
  );
}
