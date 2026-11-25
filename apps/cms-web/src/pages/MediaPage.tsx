import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Check,
  CloudSun,
  Film,
  Globe,
  Image as ImageIcon,
  Layers,
  Pencil,
  Play,
  Plus,
  Sparkles,
  Trash2,
  X,
  Youtube,
} from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import {
  CREATIVE_TYPE_REGISTRY,
  getCreativeTypeDef,
  type ApprovalStatus,
  type MediaAsset,
} from '@signage/shared';
import { CreateAppDialog } from '../components/media/CreateAppDialog';
import { EditMediaDialog } from '../components/media/EditMediaDialog';
import { MediaPreviewModal } from '../components/media/MediaPreviewModal';
import { UploadMediaDialog } from '../components/media/UploadMediaDialog';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Card, CardContent } from '../components/ui/card';
import { ListToolbar, PaginationBar, paginateItems } from '../components/ui/list-controls';
import { api, formatBytes } from '../lib/api';

function CreativeIcon({ type, className }: { type: string; className?: string }) {
  switch (type) {
    case 'video':
      return <Film className={className} />;
    case 'image':
      return <ImageIcon className={className} />;
    case 'webpage':
      return <Globe className={className} />;
    case 'youtube':
      return <Youtube className={className} />;
    case 'weather':
      return <CloudSun className={className} />;
    case 'html':
      return <Sparkles className={className} />;
    default:
      return <Layers className={className} />;
  }
}

function summarizeAsset(asset: MediaAsset): string {
  const cfg = asset.appConfig ?? {};
  if (asset.type === 'weather') return `City: ${String(cfg.city ?? 'Mumbai')} (°${String(cfg.unit ?? 'C')})`;
  if (asset.type === 'webpage' && typeof cfg.url === 'string') return cfg.url;
  if (asset.type === 'youtube') return `YouTube ID: ${String(cfg.videoId ?? 'embed')}`;
  if (asset.type === 'html' && typeof cfg.headline === 'string') return cfg.headline;
  return formatBytes(asset.sizeBytes);
}

export function MediaPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const queryClient = useQueryClient();

  const searchQuery = searchParams.get('q') ?? '';
  const typeFilter = searchParams.get('type') ?? 'all';
  const pageParam = searchParams.get('page');
  const modalParam = searchParams.get('modal');
  const previewId = searchParams.get('preview');
  const editId = searchParams.get('edit');

  const { data, isLoading } = useQuery({
    queryKey: ['media'],
    queryFn: api.listMedia,
    refetchInterval: (query) => {
      const hasProcessing = query.state.data?.items.some((i) => i.status === 'processing');
      return hasProcessing ? 2000 : false;
    },
  });

  const deleteMutation = useMutation({
    mutationFn: api.deleteMedia,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['media'] }),
  });

  const approvalMutation = useMutation({
    mutationFn: ({ id, approvalStatus }: { id: string; approvalStatus: ApprovalStatus }) =>
      api.updateMediaApproval(id, approvalStatus),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['media'] }),
  });

  const updateParams = (mutate: (next: URLSearchParams) => void, replace = false) => {
    const next = new URLSearchParams(searchParams);
    mutate(next);
    setSearchParams(next, { replace });
  };

  const allItems = data?.items ?? [];
  const filtered = allItems.filter((item) => {
    const matchesQ = searchQuery
      ? item.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
        item.type.toLowerCase().includes(searchQuery.toLowerCase())
      : true;
    const matchesType = typeFilter === 'all' || item.type === typeFilter;
    return matchesQ && matchesType;
  });

  const paged = paginateItems(filtered, pageParam, 9);
  const previewAsset = previewId ? (allItems.find((a) => a.id === previewId) ?? null) : null;
  const editAsset = editId ? (allItems.find((a) => a.id === editId) ?? null) : null;

  const typeOptions = [
    { value: 'all', label: 'All Creative Types' },
    ...CREATIVE_TYPE_REGISTRY.map((def) => ({ value: def.type, label: def.label })),
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Creatives & Media</h1>
          <p className="text-sm text-muted-foreground">
            Upload 4K video/images or create live Web, YouTube, Weather, and HTML announcement creatives.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={() => updateParams((n) => n.set('modal', 'app'))}>
            <Layers className="h-4 w-4" />
            Add App / Addon
          </Button>
          <Button onClick={() => updateParams((n) => n.set('modal', 'upload'))}>
            <Plus className="h-4 w-4" />
            Upload Media
          </Button>
        </div>
      </div>

      <ListToolbar
        searchPlaceholder="Search creatives by title or type..."
        searchValue={searchQuery}
        onSearchChange={(val) =>
          updateParams((n) => {
            if (val) n.set('q', val);
            else n.delete('q');
            n.delete('page');
          }, true)
        }
        filterValue={typeFilter}
        filterOptions={typeOptions}
        onFilterChange={(val) =>
          updateParams((n) => {
            if (val === 'all') n.delete('type');
            else n.set('type', val);
            n.delete('page');
          })
        }
        totalCount={filtered.length}
      />

      {isLoading ? (
        <div className="py-12 text-center text-sm text-muted-foreground">Loading creatives...</div>
      ) : paged.pageItems.length === 0 ? (
        <Card className="border-dashed p-12 text-center">
          <Film className="mx-auto mb-3 h-8 w-8 text-muted-foreground" />
          <p className="text-sm font-medium">No matching creatives</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Upload an MP4/WebM video, PNG/JPG image, or add a live App / Addon widget.
          </p>
        </Card>
      ) : (
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {paged.pageItems.map((asset) => {
            const typeDef = getCreativeTypeDef(asset.type);
            return (
              <Card key={asset.id} className="flex flex-col overflow-hidden">
                <button
                  type="button"
                  onClick={() => updateParams((n) => n.set('preview', asset.id))}
                  title={`Preview ${asset.title}`}
                  className="group relative flex aspect-video w-full cursor-pointer items-center justify-center overflow-hidden bg-black text-left"
                >
                  {asset.status === 'processing' ? (
                    <div className="flex flex-col items-center gap-2 text-xs text-amber-300">
                      <div className="h-5 w-5 animate-spin rounded-full border-2 border-amber-400 border-t-transparent" />
                      <span>Processing with FFmpeg...</span>
                    </div>
                  ) : asset.type === 'image' && (asset.thumbnailUrl || asset.previewUrl) ? (
                    <img
                      src={asset.thumbnailUrl || asset.previewUrl || ''}
                      alt={asset.title}
                      loading="lazy"
                      className="h-full w-full object-cover transition-transform group-hover:scale-105"
                    />
                  ) : asset.type === 'video' ? (
                    <>
                      {asset.thumbnailUrl ? (
                        <img
                          src={asset.thumbnailUrl}
                          alt={asset.title}
                          loading="lazy"
                          className="h-full w-full object-cover transition-transform group-hover:scale-105"
                        />
                      ) : (
                        <Film className="h-10 w-10 text-muted-foreground" />
                      )}
                      <span className="absolute flex h-11 w-11 items-center justify-center rounded-full border border-white/25 bg-black/70 text-white shadow-lg transition-transform group-hover:scale-110">
                        <Play className="ml-0.5 h-5 w-5 fill-current" />
                      </span>
                    </>
                  ) : (
                    <div className="flex flex-col items-center gap-2 px-4 text-center">
                      <CreativeIcon type={asset.type} className="h-9 w-9 text-sky-300" />
                      <span className="line-clamp-1 text-xs font-medium text-zinc-200">
                        Click to preview {typeDef?.label ?? asset.type}
                      </span>
                    </div>
                  )}

                  <Badge
                    variant="secondary"
                    className="absolute top-2 left-2 bg-background/85 capitalize backdrop-blur"
                  >
                    <CreativeIcon type={asset.type} className="h-3 w-3" />
                    {typeDef?.label ?? asset.type}
                  </Badge>
                </button>

                <CardContent className="flex flex-1 flex-col justify-between p-4">
                  <div>
                    <div className="truncate text-sm font-medium">{asset.title}</div>
                    <div className="mt-1 truncate text-xs text-muted-foreground">
                      {summarizeAsset(asset)}
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                      {asset.durationMs && (
                        <span>{Math.round(asset.durationMs / 1000)}s</span>
                      )}
                      {asset.width && asset.height && (
                        <span>
                          • {asset.width}×{asset.height}
                        </span>
                      )}
                      <Badge
                        variant={
                          asset.status === 'ready'
                            ? 'success'
                            : asset.status === 'processing'
                              ? 'warning'
                              : 'destructive'
                        }
                        className="capitalize"
                      >
                        {asset.status}
                      </Badge>
                    </div>
                  </div>

                  <div className="mt-4 flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1">
                      <Badge
                        variant={
                          asset.approvalStatus === 'approved'
                            ? 'success'
                            : asset.approvalStatus === 'rejected'
                              ? 'destructive'
                              : 'warning'
                        }
                        className="capitalize"
                      >
                        {asset.approvalStatus}
                      </Badge>
                      {asset.approvalStatus !== 'approved' && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-emerald-300"
                          title="Approve creative"
                          onClick={() =>
                            approvalMutation.mutate({ id: asset.id, approvalStatus: 'approved' })
                          }
                        >
                          <Check className="h-3.5 w-3.5" />
                        </Button>
                      )}
                      {asset.approvalStatus !== 'rejected' && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-red-300"
                          title="Reject creative"
                          onClick={() =>
                            approvalMutation.mutate({ id: asset.id, approvalStatus: 'rejected' })
                          }
                        >
                          <X className="h-3.5 w-3.5" />
                        </Button>
                      )}
                    </div>

                    <div className="flex items-center gap-1">
                      <Button
                        variant="outline"
                        size="icon"
                        className="h-8 w-8"
                        title="Edit creative"
                        onClick={() => updateParams((n) => n.set('edit', asset.id))}
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => deleteMutation.mutate(asset.id)}
                        disabled={deleteMutation.isPending}
                        title="Delete creative"
                        className="h-8 w-8 text-red-300 hover:bg-destructive/15"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <PaginationBar
        page={paged.page}
        totalPages={paged.totalPages}
        totalItems={paged.totalItems}
        startIdx={paged.startIdx}
        endIdx={paged.endIdx}
        onPageChange={(nextPage) =>
          updateParams((n) => {
            if (nextPage <= 1) n.delete('page');
            else n.set('page', String(nextPage));
          })
        }
      />

      <UploadMediaDialog
        open={modalParam === 'upload'}
        onClose={() => updateParams((n) => n.delete('modal'))}
      />
      <CreateAppDialog
        open={modalParam === 'app'}
        onClose={() => updateParams((n) => n.delete('modal'))}
      />
      <EditMediaDialog
        asset={editAsset}
        onClose={() => updateParams((n) => n.delete('edit'))}
      />
      <MediaPreviewModal
        asset={previewAsset}
        onClose={() => updateParams((n) => n.delete('preview'))}
      />
    </div>
  );
}
