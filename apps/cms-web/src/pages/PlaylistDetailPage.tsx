import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowDown, ArrowLeft, ArrowUp, Plus, Save, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { MediaAsset } from '@signage/shared';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Card } from '../components/ui/card';
import { Input } from '../components/ui/input';
import { api } from '../lib/api';

interface DraftItem {
  key: string;
  mediaAssetId: string;
  durationSec: number;
  asset?: MediaAsset;
}

export function PlaylistDetailPage() {
  const { id } = useParams<{ id: string }>();
  const queryClient = useQueryClient();

  const { data: plData, isLoading: plLoading } = useQuery({
    queryKey: ['playlists', id],
    queryFn: () => api.getPlaylist(id!),
    enabled: Boolean(id),
  });

  const { data: mediaData } = useQuery({
    queryKey: ['media'],
    queryFn: api.listMedia,
  });

  const [name, setName] = useState('');
  const [items, setItems] = useState<DraftItem[]>([]);
  const [savedNotice, setSavedNotice] = useState<string | null>(null);

  useEffect(() => {
    if (plData?.playlist) {
      setName(plData.playlist.name);
      setItems(
        plData.playlist.items.map((item) => ({
          key: item.id,
          mediaAssetId: item.mediaAssetId,
          durationSec: Math.max(1, Math.round(item.durationMs / 1000)),
          asset: item.asset,
        })),
      );
    }
  }, [plData]);

  const saveMutation = useMutation({
    mutationFn: () =>
      api.updatePlaylist(id!, {
        name: name.trim(),
        items: items.map((i) => ({
          mediaAssetId: i.mediaAssetId,
          durationMs: Math.max(1, i.durationSec) * 1000,
        })),
      }),
    onSuccess: ({ playlist }) => {
      queryClient.setQueryData(['playlists', id], { playlist });
      queryClient.invalidateQueries({ queryKey: ['playlists'] });
      setSavedNotice(`Published v${playlist.version} to assigned screens.`);
      setTimeout(() => setSavedNotice(null), 3500);
    },
  });

  const readyAssets = (mediaData?.items ?? []).filter((m) => m.status === 'ready');

  const addAsset = (asset: MediaAsset) => {
    const inferredSec = asset.durationMs
      ? Math.max(1, Math.round(asset.durationMs / 1000))
      : asset.type === 'video'
        ? 30
        : 10;
    setItems((prev) => [
      ...prev,
      {
        key: `${asset.id}-${Date.now()}-${Math.random()}`,
        mediaAssetId: asset.id,
        durationSec: inferredSec,
        asset,
      },
    ]);
  };

  const moveItem = (idx: number, dir: -1 | 1) => {
    const target = idx + dir;
    if (target < 0 || target >= items.length) return;
    setItems((prev) => {
      const next = [...prev];
      const [moved] = next.splice(idx, 1);
      next.splice(target, 0, moved);
      return next;
    });
  };

  const removeItem = (idx: number) => {
    setItems((prev) => prev.filter((_, i) => i !== idx));
  };

  if (plLoading || !plData?.playlist) {
    return <div className="py-12 text-center text-sm text-muted-foreground">Loading playlist...</div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <Button variant="outline" size="icon" asChild>
            <Link to="/playlists">
              <ArrowLeft className="h-4 w-4" />
            </Link>
          </Button>
          <div>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="bg-transparent text-2xl font-bold tracking-tight outline-none focus:underline"
            />
            <div className="text-xs text-muted-foreground">
              Version {plData.playlist.version} • {items.length} item{items.length === 1 ? '' : 's'}
            </div>
          </div>
        </div>

        <Button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}>
          <Save className="h-4 w-4" />
          {saveMutation.isPending ? 'Publishing...' : 'Save & Publish'}
        </Button>
      </div>

      {savedNotice && (
        <div className="rounded-md border border-emerald-500/30 bg-emerald-500/15 px-4 py-2.5 text-xs font-medium text-emerald-300">
          {savedNotice}
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-3 lg:col-span-2">
          <h2 className="text-xs font-semibold tracking-wider text-muted-foreground uppercase">
            Playback Sequence (Loops Automatically)
          </h2>

          {items.length === 0 ? (
            <Card className="border-dashed p-10 text-center text-sm text-muted-foreground">
              Add media from the right panel to populate this playlist.
            </Card>
          ) : (
            <div className="space-y-2">
              {items.map((item, idx) => (
                <Card key={item.key} className="flex items-center justify-between gap-4 p-3.5">
                  <div className="flex min-w-0 items-center gap-3">
                    <Badge variant="secondary" className="h-7 w-7 justify-center rounded-md px-0 font-bold">
                      {idx + 1}
                    </Badge>
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium">
                        {item.asset?.title ?? item.mediaAssetId}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {item.asset?.type ?? 'media'} • {item.asset?.mimeType}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-1.5">
                    <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <span>Sec:</span>
                      <Input
                        type="number"
                        min={1}
                        max={3600}
                        value={item.durationSec}
                        onChange={(e) => {
                          const val = Math.max(1, Number(e.target.value) || 1);
                          setItems((prev) =>
                            prev.map((row, rIdx) =>
                              rIdx === idx ? { ...row, durationSec: val } : row,
                            ),
                          );
                        }}
                        className="h-8 w-16 px-2 text-xs"
                      />
                    </label>

                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => moveItem(idx, -1)}
                      disabled={idx === 0}
                      className="h-8 w-8"
                    >
                      <ArrowUp className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => moveItem(idx, 1)}
                      disabled={idx === items.length - 1}
                      className="h-8 w-8"
                    >
                      <ArrowDown className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => removeItem(idx)}
                      className="h-8 w-8 text-red-300 hover:bg-destructive/15"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </Card>
              ))}
            </div>
          )}
        </div>

        <div className="space-y-3">
          <h2 className="text-xs font-semibold tracking-wider text-muted-foreground uppercase">
            Add Ready Media
          </h2>
          <Card className="max-h-[520px] space-y-2 overflow-y-auto p-3">
            {readyAssets.length === 0 ? (
              <div className="p-4 text-center text-xs text-muted-foreground">
                No ready media assets. Upload assets in the Media Library first.
              </div>
            ) : (
              readyAssets.map((asset) => (
                <Button
                  key={asset.id}
                  variant="outline"
                  onClick={() => addAsset(asset)}
                  className="h-auto w-full justify-between px-3 py-2.5 text-left"
                >
                  <div className="min-w-0">
                    <div className="truncate text-xs font-medium">{asset.title}</div>
                    <div className="text-[11px] text-muted-foreground">
                      {asset.type}
                      {asset.durationMs ? ` • ${Math.round(asset.durationMs / 1000)}s` : ''}
                    </div>
                  </div>
                  <Plus className="h-4 w-4 shrink-0 text-muted-foreground" />
                </Button>
              ))
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
