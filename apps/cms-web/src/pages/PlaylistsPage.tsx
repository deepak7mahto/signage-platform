import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ListVideo, Pencil, Plus, Trash2 } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Card } from '../components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../components/ui/dialog';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { ListToolbar, PaginationBar, paginateItems } from '../components/ui/list-controls';
import { api } from '../lib/api';

export function PlaylistsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const isCreateOpen = searchParams.get('modal') === 'new';
  const searchQuery = searchParams.get('q') ?? '';
  const pageParam = searchParams.get('page');

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [error, setError] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['playlists'],
    queryFn: api.listPlaylists,
  });

  const createMutation = useMutation({
    mutationFn: api.createPlaylist,
    onSuccess: ({ playlist }) => {
      queryClient.invalidateQueries({ queryKey: ['playlists'] });
      navigate(`/playlists/${playlist.id}`);
    },
    onError: (err) => {
      setError(err instanceof Error ? err.message : 'Failed to create playlist');
    },
  });

  const deleteMutation = useMutation({
    mutationFn: api.deletePlaylist,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['playlists'] });
    },
  });

  const updateParams = (mutate: (next: URLSearchParams) => void, replace = false) => {
    const next = new URLSearchParams(searchParams);
    mutate(next);
    setSearchParams(next, { replace });
  };

  const closeModal = () => {
    updateParams((n) => n.delete('modal'));
    setName('');
    setDescription('');
    setError(null);
  };

  const handleCreate = (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    createMutation.mutate({
      name: name.trim(),
      description: description.trim() || undefined,
      loopMode: 'sequential',
      items: [],
    });
  };

  const playlists = data?.items ?? [];
  const qLower = searchQuery.trim().toLowerCase();
  const filtered = playlists.filter((pl) =>
    qLower
      ? pl.name.toLowerCase().includes(qLower) || (pl.description ?? '').toLowerCase().includes(qLower)
      : true,
  );
  const paged = paginateItems(filtered, pageParam, 10);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Playlists</h1>
          <p className="text-sm text-muted-foreground">
            Build ordered media loops and push live updates to connected screens.
          </p>
        </div>

        <Button onClick={() => updateParams((n) => n.set('modal', 'new'))}>
          <Plus className="h-4 w-4" />
          New Playlist
        </Button>
      </div>

      <ListToolbar
        searchPlaceholder="Search playlists by name or description..."
        searchValue={searchQuery}
        onSearchChange={(val) =>
          updateParams((n) => {
            if (val) n.set('q', val);
            else n.delete('q');
            n.delete('page');
          }, true)
        }
        totalCount={filtered.length}
      />

      {isLoading ? (
        <div className="py-12 text-center text-sm text-muted-foreground">Loading playlists...</div>
      ) : paged.pageItems.length === 0 ? (
        <Card className="border-dashed p-12 text-center">
          <ListVideo className="mx-auto mb-3 h-8 w-8 text-muted-foreground" />
          <p className="text-sm font-medium">No matching playlists</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Create a playlist and add media items or apps to assign to your screens.
          </p>
        </Card>
      ) : (
        <>
          <Card className="divide-y divide-border overflow-hidden">
            {paged.pageItems.map((pl) => (
              <div key={pl.id} className="flex items-center justify-between gap-4 p-4">
                <Link to={`/playlists/${pl.id}`} className="group flex flex-1 items-center gap-4">
                  <div className="flex h-10 w-10 items-center justify-center rounded-md bg-secondary text-foreground">
                    <ListVideo className="h-5 w-5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 font-medium group-hover:underline">
                      <span className="truncate">{pl.name}</span>
                      <Badge variant="secondary">v{pl.version}</Badge>
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {pl.items.length} item{pl.items.length === 1 ? '' : 's'}
                      {pl.description ? ` • ${pl.description}` : ''}
                    </div>
                  </div>
                </Link>

                <div className="flex items-center gap-1.5">
                  <Button variant="outline" size="sm" asChild>
                    <Link to={`/playlists/${pl.id}`}>
                      <Pencil className="h-3.5 w-3.5" />
                      Edit
                    </Link>
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => deleteMutation.mutate(pl.id)}
                    title="Delete playlist"
                    className="text-red-300 hover:bg-destructive/15"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            ))}
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

      <Dialog open={isCreateOpen} onOpenChange={(open) => !open && closeModal()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create Playlist</DialogTitle>
            <DialogDescription>
              Create a looping schedule to assign to one or more paired displays.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleCreate} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="playlist-name">Name</Label>
              <Input
                id="playlist-name"
                type="text"
                required
                placeholder="e.g. Main Lobby Loop"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="playlist-desc">Description (optional)</Label>
              <Input
                id="playlist-desc"
                type="text"
                placeholder="Morning promo & announcements"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </div>

            {error && (
              <div className="rounded-md border border-destructive/40 bg-destructive/15 px-3 py-2 text-xs text-red-300">
                {error}
              </div>
            )}

            <DialogFooter>
              <Button type="button" variant="outline" onClick={closeModal}>
                Cancel
              </Button>
              <Button type="submit" disabled={createMutation.isPending}>
                {createMutation.isPending ? 'Creating...' : 'Create'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
