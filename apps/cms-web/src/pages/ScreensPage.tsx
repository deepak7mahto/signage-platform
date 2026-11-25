import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Eye,
  FolderTree,
  KeyRound,
  Monitor,
  Pencil,
  Plus,
  RefreshCw,
  Trash2,
  Wifi,
  WifiOff,
} from 'lucide-react';
import { Link, useSearchParams } from 'react-router-dom';
import { EditScreenDialog } from '../components/screens/EditScreenDialog';
import { PairScreenDialog } from '../components/screens/PairScreenDialog';
import { ProvisionScreenDialog } from '../components/screens/ProvisionScreenDialog';
import { ScreenGroupDialog } from '../components/screens/ScreenGroupDialog';
import { ScreenGroupsPanel } from '../components/screens/ScreenGroupsPanel';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Card } from '../components/ui/card';
import { ListToolbar, PaginationBar, paginateItems } from '../components/ui/list-controls';
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

const NONE_PLAYLIST_VALUE = '__none__';

export function ScreensPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const queryClient = useQueryClient();

  const activeTab = searchParams.get('tab') === 'groups' ? 'groups' : 'screens';
  const modalParam = searchParams.get('modal');
  const editGroupId = searchParams.get('editGroup');
  const editScreenId = searchParams.get('editScreen');
  const searchQuery = searchParams.get('q') ?? '';
  const statusFilter = searchParams.get('status') ?? 'all';
  const pageParam = searchParams.get('page');

  const { data: screensData, isLoading } = useQuery({
    queryKey: ['screens'],
    queryFn: api.listScreens,
    refetchInterval: 10_000,
  });
  const { data: playlistsData } = useQuery({ queryKey: ['playlists'], queryFn: api.listPlaylists });
  const { data: groupsData, isLoading: groupsLoading } = useQuery({
    queryKey: ['groups'],
    queryFn: api.listGroups,
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, playlistId }: { id: string; playlistId: string | null }) =>
      api.updateScreen(id, { activePlaylistId: playlistId }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['screens'] }),
  });

  const syncMutation = useMutation({ mutationFn: api.syncScreen });

  const deleteMutation = useMutation({
    mutationFn: api.deleteScreen,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['screens'] });
      queryClient.invalidateQueries({ queryKey: ['groups'] });
    },
  });

  const deleteGroupMutation = useMutation({
    mutationFn: api.deleteGroup,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['groups'] });
      queryClient.invalidateQueries({ queryKey: ['schedules'] });
    },
  });

  const updateParams = (mutate: (next: URLSearchParams) => void, replace = false) => {
    const next = new URLSearchParams(searchParams);
    mutate(next);
    setSearchParams(next, { replace });
  };

  const setTab = (tab: 'screens' | 'groups') =>
    updateParams((n) => {
      if (tab === 'screens') n.delete('tab');
      else n.set('tab', tab);
      n.delete('page');
    });

  const openModal = (modal: 'pair' | 'provision' | 'new-group') =>
    updateParams((n) => {
      if (modal === 'new-group') n.set('tab', 'groups');
      n.set('modal', modal);
      n.delete('editGroup');
      n.delete('editScreen');
    });

  const closeModals = () =>
    updateParams((n) => {
      n.delete('modal');
      n.delete('editGroup');
      n.delete('editScreen');
    });

  const screens = screensData?.items ?? [];
  const playlists = playlistsData?.items ?? [];
  const groups = groupsData?.items ?? [];
  const screenNameById = new Map(screens.map((s) => [s.id, s.name]));
  const editingGroup = editGroupId ? (groups.find((g) => g.id === editGroupId) ?? null) : null;
  const editingScreen = editScreenId ? (screens.find((s) => s.id === editScreenId) ?? null) : null;

  const qLower = searchQuery.trim().toLowerCase();
  const filteredScreens = screens.filter((s) => {
    const matchesQ = qLower
      ? s.name.toLowerCase().includes(qLower) ||
        (s.location ?? '').toLowerCase().includes(qLower) ||
        (s.city ?? '').toLowerCase().includes(qLower)
      : true;
    const matchesStatus = statusFilter === 'all' || s.status === statusFilter;
    return matchesQ && matchesStatus;
  });
  const pagedScreens = paginateItems(filteredScreens, pageParam, 10);

  const filteredGroups = groups.filter((g) =>
    qLower
      ? g.name.toLowerCase().includes(qLower) ||
        (g.description ?? '').toLowerCase().includes(qLower)
      : true,
  );
  const pagedGroups = paginateItems(filteredGroups, pageParam, 10);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Screens Fleet</h1>
          <p className="text-sm text-muted-foreground">
            Pair displays with a 6-digit code, organize screen groups, and push instant WebSocket syncs.
          </p>
        </div>

        <div className="flex items-center gap-2">
          {activeTab === 'groups' ? (
            <Button onClick={() => openModal('new-group')}>
              <Plus className="h-4 w-4" />
              New Group
            </Button>
          ) : (
            <>
              <Button variant="outline" onClick={() => openModal('provision')}>
                <KeyRound className="h-4 w-4" />
                Pre-Provision (URL)
              </Button>
              <Button onClick={() => openModal('pair')}>
                <Plus className="h-4 w-4" />
                Pair Screen
              </Button>
            </>
          )}
        </div>
      </div>

      <div className="inline-flex rounded-md border border-border bg-card p-1">
        <button
          type="button"
          onClick={() => setTab('screens')}
          className={`flex cursor-pointer items-center gap-2 rounded-sm px-3 py-1.5 text-xs font-medium transition-colors ${
            activeTab === 'screens' ? 'bg-accent text-accent-foreground' : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          <Monitor className="h-3.5 w-3.5" />
          Screens ({screens.length})
        </button>
        <button
          type="button"
          onClick={() => setTab('groups')}
          className={`flex cursor-pointer items-center gap-2 rounded-sm px-3 py-1.5 text-xs font-medium transition-colors ${
            activeTab === 'groups' ? 'bg-accent text-accent-foreground' : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          <FolderTree className="h-3.5 w-3.5" />
          Groups ({groups.length})
        </button>
      </div>

      <ListToolbar
        searchPlaceholder={activeTab === 'screens' ? 'Search screens by name, location, or city...' : 'Search groups...'}
        searchValue={searchQuery}
        onSearchChange={(val) =>
          updateParams((n) => {
            if (val) n.set('q', val);
            else n.delete('q');
            n.delete('page');
          }, true)
        }
        filterValue={activeTab === 'screens' ? statusFilter : undefined}
        filterOptions={
          activeTab === 'screens'
            ? [
                { value: 'all', label: 'All Statuses' },
                { value: 'online', label: 'Online' },
                { value: 'offline', label: 'Offline' },
              ]
            : undefined
        }
        onFilterChange={
          activeTab === 'screens'
            ? (val) =>
                updateParams((n) => {
                  if (val === 'all') n.delete('status');
                  else n.set('status', val);
                  n.delete('page');
                })
            : undefined
        }
        totalCount={activeTab === 'screens' ? filteredScreens.length : filteredGroups.length}
      />

      {activeTab === 'screens' ? (
        isLoading ? (
          <div className="py-12 text-center text-sm text-muted-foreground">Loading screens...</div>
        ) : pagedScreens.pageItems.length === 0 ? (
          <Card className="border-dashed p-12 text-center">
            <Monitor className="mx-auto mb-3 h-8 w-8 text-muted-foreground" />
            <p className="text-sm font-medium">No matching screens</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Pair a display via <code className="text-foreground">/sim/</code> or adjust your search/status filters.
            </p>
          </Card>
        ) : (
          <>
            <Card className="overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead>Screen</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Fallback Playlist</TableHead>
                    <TableHead>Last Seen</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {pagedScreens.pageItems.map((screen) => (
                    <TableRow key={screen.id}>
                      <TableCell>
                        <Link to={`/screens/${screen.id}`} className="font-medium hover:underline">
                          {screen.name}
                        </Link>
                        <div className="text-xs text-muted-foreground">
                          {screen.location || screen.city || screen.timezone}
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant={screen.status === 'online' ? 'success' : 'secondary'}>
                          {screen.status === 'online' ? <Wifi className="h-3 w-3" /> : <WifiOff className="h-3 w-3" />}
                          {screen.status}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Select
                          value={screen.activePlaylistId ?? NONE_PLAYLIST_VALUE}
                          onValueChange={(val) =>
                            updateMutation.mutate({
                              id: screen.id,
                              playlistId: val === NONE_PLAYLIST_VALUE ? null : val,
                            })
                          }
                        >
                          <SelectTrigger className="w-52">
                            <SelectValue placeholder="— None —" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value={NONE_PLAYLIST_VALUE}>— None —</SelectItem>
                            {playlists.map((pl) => (
                              <SelectItem key={pl.id} value={pl.id}>
                                {pl.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {screen.lastSeenAt ? new Date(screen.lastSeenAt).toLocaleTimeString() : 'Never'}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="inline-flex items-center gap-1.5">
                          <Button variant="outline" size="sm" asChild title="Preview live schedule in new tab">
                            <a href={`/sim/?previewScreenId=${screen.id}&hud=1`} target="_blank" rel="noreferrer">
                              <Eye className="h-3.5 w-3.5" />
                              Preview
                            </a>
                          </Button>
                          <Button
                            variant="outline"
                            size="icon"
                            className="h-8 w-8"
                            title="Edit screen"
                            onClick={() => updateParams((n) => n.set('editScreen', screen.id))}
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                          <Button variant="outline" size="sm" onClick={() => syncMutation.mutate(screen.id)}>
                            <RefreshCw className="h-3.5 w-3.5" />
                            Sync
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => deleteMutation.mutate(screen.id)}
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
              page={pagedScreens.page}
              totalPages={pagedScreens.totalPages}
              totalItems={pagedScreens.totalItems}
              startIdx={pagedScreens.startIdx}
              endIdx={pagedScreens.endIdx}
              onPageChange={(p) => updateParams((n) => (p <= 1 ? n.delete('page') : n.set('page', String(p))))}
            />
          </>
        )
      ) : (
        <ScreenGroupsPanel
          loading={groupsLoading}
          groups={pagedGroups.pageItems}
          page={pagedGroups.page}
          totalPages={pagedGroups.totalPages}
          totalItems={pagedGroups.totalItems}
          startIdx={pagedGroups.startIdx}
          endIdx={pagedGroups.endIdx}
          screenNameById={screenNameById}
          onEditGroup={(groupId) =>
            updateParams((n) => {
              n.set('tab', 'groups');
              n.set('editGroup', groupId);
            })
          }
          onDeleteGroup={(groupId) => deleteGroupMutation.mutate(groupId)}
          onPageChange={(p) =>
            updateParams((n) => (p <= 1 ? n.delete('page') : n.set('page', String(p))))
          }
        />
      )}

      <PairScreenDialog open={modalParam === 'pair'} playlists={playlists} onClose={closeModals} />
      <ProvisionScreenDialog open={modalParam === 'provision'} playlists={playlists} onClose={closeModals} />
      <EditScreenDialog screen={editingScreen} playlists={playlists} onClose={closeModals} />
      <ScreenGroupDialog
        open={modalParam === 'new-group' || Boolean(editGroupId)}
        editingGroup={editingGroup}
        screens={screens}
        onClose={closeModals}
      />
    </div>
  );
}
