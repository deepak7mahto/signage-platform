import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Building2, Cpu, Plus, Trash2 } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ImpactConfirmDialog } from '../components/ImpactConfirmDialog';
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
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table';
import { api } from '../lib/api';

const DEFAULT_PROFILE_JSON = JSON.stringify(
  { watchdogMaxRebootsPerHour: 3, kioskPinTimeoutSec: 300, heartbeatIntervalSec: 30 },
  null,
  2,
);

export function SitesPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const queryClient = useQueryClient();

  const activeTab = searchParams.get('tab') === 'profiles' ? 'profiles' : 'sites';
  const modalParam = searchParams.get('modal');
  const deleteSiteId = searchParams.get('deleteSite');
  const deleteProfileId = searchParams.get('deleteProfile');

  const [siteName, setSiteName] = useState('');
  const [siteTimezone, setSiteTimezone] = useState('Asia/Kolkata');
  const [lanCacheUrl, setLanCacheUrl] = useState('');
  const [webhookUrl, setWebhookUrl] = useState('');
  const [siteError, setSiteError] = useState<string | null>(null);

  const [profileName, setProfileName] = useState('');
  const [profileJson, setProfileJson] = useState(DEFAULT_PROFILE_JSON);
  const [profileError, setProfileError] = useState<string | null>(null);

  const { data: sitesData, isLoading: sitesLoading } = useQuery({ queryKey: ['sites'], queryFn: api.listSites });
  const { data: profilesData, isLoading: profilesLoading } = useQuery({
    queryKey: ['config-profiles'],
    queryFn: api.listConfigProfiles,
  });

  const updateParams = (mutate: (next: URLSearchParams) => void) => {
    const next = new URLSearchParams(searchParams);
    mutate(next);
    setSearchParams(next);
  };

  const closeModals = () =>
    updateParams((n) => {
      n.delete('modal');
      n.delete('deleteSite');
      n.delete('deleteProfile');
    });

  const createSiteMutation = useMutation({
    mutationFn: api.createSite,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sites'] });
      setSiteName('');
      setLanCacheUrl('');
      setWebhookUrl('');
      setSiteError(null);
      closeModals();
    },
    onError: (err) => setSiteError(err instanceof Error ? err.message : 'Failed to create site'),
  });

  const deleteSiteMutation = useMutation({
    mutationFn: api.deleteSite,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sites'] });
      closeModals();
    },
  });

  const createProfileMutation = useMutation({
    mutationFn: api.createConfigProfile,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['config-profiles'] });
      setProfileName('');
      setProfileJson(DEFAULT_PROFILE_JSON);
      setProfileError(null);
      closeModals();
    },
    onError: (err) =>
      setProfileError(err instanceof Error ? err.message : 'Failed to create profile'),
  });

  const deleteProfileMutation = useMutation({
    mutationFn: api.deleteConfigProfile,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['config-profiles'] });
      closeModals();
    },
  });

  const handleCreateSite = (e: FormEvent) => {
    e.preventDefault();
    setSiteError(null);
    createSiteMutation.mutate({
      name: siteName.trim(),
      timezone: siteTimezone.trim() || 'UTC',
      lanCacheUrl: lanCacheUrl.trim() ? lanCacheUrl.trim() : null,
      alertPolicy: webhookUrl.trim() ? { webhookUrl: webhookUrl.trim() } : null,
    });
  };

  const handleCreateProfile = (e: FormEvent) => {
    e.preventDefault();
    setProfileError(null);
    try {
      const parsed = JSON.parse(profileJson) as Record<string, unknown>;
      createProfileMutation.mutate({ name: profileName.trim(), config: parsed });
    } catch {
      setProfileError('Config must be valid JSON');
    }
  };

  const sites = sitesData?.items ?? [];
  const profiles = profilesData?.items ?? [];
  const siteToDelete = deleteSiteId ? sites.find((s) => s.id === deleteSiteId) : null;
  const profileToDelete = deleteProfileId ? profiles.find((p) => p.id === deleteProfileId) : null;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Sites & Device Profiles</h1>
          <p className="text-sm text-muted-foreground">
            Manage physical venues, optional LAN pull-through caches, outage webhooks, and kiosk configuration profiles.
          </p>
        </div>

        <Button onClick={() => updateParams((n) => n.set('modal', activeTab === 'profiles' ? 'new-profile' : 'new-site'))}>
          <Plus className="h-4 w-4" />
          {activeTab === 'profiles' ? 'New Config Profile' : 'New Site'}
        </Button>
      </div>

      <div className="inline-flex rounded-md border border-border bg-card p-1">
        <button
          type="button"
          onClick={() => updateParams((n) => n.delete('tab'))}
          className={`flex cursor-pointer items-center gap-2 rounded-sm px-3 py-1.5 text-xs font-medium ${
            activeTab === 'sites' ? 'bg-accent text-accent-foreground' : 'text-muted-foreground'
          }`}
        >
          <Building2 className="h-3.5 w-3.5" />
          Sites ({sites.length})
        </button>
        <button
          type="button"
          onClick={() => updateParams((n) => n.set('tab', 'profiles'))}
          className={`flex cursor-pointer items-center gap-2 rounded-sm px-3 py-1.5 text-xs font-medium ${
            activeTab === 'profiles' ? 'bg-accent text-accent-foreground' : 'text-muted-foreground'
          }`}
        >
          <Cpu className="h-3.5 w-3.5" />
          Config Profiles ({profiles.length})
        </button>
      </div>

      {activeTab === 'sites' ? (
        sitesLoading ? (
          <div className="py-12 text-center text-sm text-muted-foreground">Loading sites...</div>
        ) : sites.length === 0 ? (
          <Card className="border-dashed p-12 text-center text-sm text-muted-foreground">
            No venues configured yet. Create a site to bind LAN cache URLs or outage webhook alerts.
          </Card>
        ) : (
          <Card className="overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>Site</TableHead>
                  <TableHead>Timezone</TableHead>
                  <TableHead>LAN Cache Mirror</TableHead>
                  <TableHead>Outage Webhook</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sites.map((site) => (
                  <TableRow key={site.id}>
                    <TableCell className="font-medium">{site.name}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{site.timezone}</TableCell>
                    <TableCell className="font-mono text-xs">
                      {site.lanCacheUrl ?? <span className="text-muted-foreground">Direct S3</span>}
                    </TableCell>
                    <TableCell className="text-xs">
                      {site.alertPolicy?.webhookUrl ? (
                        <Badge variant="outline">{site.alertPolicy.webhookUrl}</Badge>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-red-300 hover:bg-destructive/15"
                        onClick={() => updateParams((n) => n.set('deleteSite', site.id))}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
        )
      ) : profilesLoading ? (
        <div className="py-12 text-center text-sm text-muted-foreground">Loading profiles...</div>
      ) : profiles.length === 0 ? (
        <Card className="border-dashed p-12 text-center text-sm text-muted-foreground">
          No device configuration profiles yet.
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Profile Name</TableHead>
                <TableHead>Settings JSON</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {profiles.map((profile) => (
                <TableRow key={profile.id}>
                  <TableCell className="font-medium">{profile.name}</TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">
                    {JSON.stringify(profile.config)}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-red-300 hover:bg-destructive/15"
                      onClick={() => updateParams((n) => n.set('deleteProfile', profile.id))}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}

      <Dialog open={modalParam === 'new-site'} onOpenChange={(next) => !next && closeModals()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create Venue Site</DialogTitle>
            <DialogDescription>
              Configure site timezone, optional local nginx pull-through cache, and webhook alerts.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleCreateSite} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="site-name">Site Name</Label>
              <Input id="site-name" required placeholder="e.g. Phoenix Mall — Wing B" value={siteName} onChange={(e) => setSiteName(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="site-tz">Timezone</Label>
              <Input id="site-tz" required value={siteTimezone} onChange={(e) => setSiteTimezone(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="site-cache">LAN Cache Base URL (optional)</Label>
              <Input id="site-cache" type="url" placeholder="http://192.168.10.50:8080/media-cache" value={lanCacheUrl} onChange={(e) => setLanCacheUrl(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="site-webhook">Outage Webhook URL (optional)</Label>
              <Input id="site-webhook" type="url" placeholder="https://alerts.example.com/signage-hook" value={webhookUrl} onChange={(e) => setWebhookUrl(e.target.value)} />
            </div>
            {siteError && (
              <div className="rounded-md border border-destructive/40 bg-destructive/15 px-3 py-2 text-xs text-red-300">
                {siteError}
              </div>
            )}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={closeModals}>Cancel</Button>
              <Button type="submit" disabled={createSiteMutation.isPending || !siteName.trim()}>
                {createSiteMutation.isPending ? 'Saving...' : 'Create Site'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={modalParam === 'new-profile'} onOpenChange={(next) => !next && closeModals()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create Device Config Profile</DialogTitle>
            <DialogDescription>Reusable policy defaults synced to assigned displays.</DialogDescription>
          </DialogHeader>
          <form onSubmit={handleCreateProfile} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="profile-name">Profile Name</Label>
              <Input id="profile-name" required placeholder="e.g. Retail Kiosk Strict" value={profileName} onChange={(e) => setProfileName(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="profile-json">Policy JSON</Label>
              <textarea
                id="profile-json"
                rows={5}
                value={profileJson}
                onChange={(e) => setProfileJson(e.target.value)}
                className="w-full rounded-md border border-input bg-background px-3 py-2 font-mono text-xs text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            </div>
            {profileError && (
              <div className="rounded-md border border-destructive/40 bg-destructive/15 px-3 py-2 text-xs text-red-300">
                {profileError}
              </div>
            )}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={closeModals}>Cancel</Button>
              <Button type="submit" disabled={createProfileMutation.isPending || !profileName.trim()}>
                {createProfileMutation.isPending ? 'Creating...' : 'Create Profile'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <ImpactConfirmDialog
        open={Boolean(deleteSiteId)}
        title={`Delete site "${siteToDelete?.name ?? ''}"?`}
        description="Assigned screens will detach from this venue and lose its LAN cache mirror override."
        confirmLabel="Delete Site"
        isPending={deleteSiteMutation.isPending}
        onCancel={closeModals}
        onConfirm={() => deleteSiteId && deleteSiteMutation.mutate(deleteSiteId)}
      />

      <ImpactConfirmDialog
        open={Boolean(deleteProfileId)}
        title={`Delete config profile "${profileToDelete?.name ?? ''}"?`}
        description="Screens referencing this profile will revert to default player thresholds."
        confirmLabel="Delete Profile"
        isPending={deleteProfileMutation.isPending}
        onCancel={closeModals}
        onConfirm={() => deleteProfileId && deleteProfileMutation.mutate(deleteProfileId)}
      />
    </div>
  );
}
