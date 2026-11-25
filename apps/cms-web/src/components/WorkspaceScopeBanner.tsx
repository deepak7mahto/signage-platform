import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Building2, Plus, ShieldAlert } from 'lucide-react';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, setActiveTargetOrgId } from '../lib/api';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from './ui/dialog';
import { Input } from './ui/input';
import { Label } from './ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from './ui/select';

const SELF_ORG_VALUE = '__self__';

export function WorkspaceScopeBanner() {
  const [searchParams, setSearchParams] = useSearchParams();
  const queryClient = useQueryClient();
  const orgParam = searchParams.get('org');
  const modalParam = searchParams.get('modal');

  const [clientName, setClientName] = useState('');
  const [clientError, setClientError] = useState<string | null>(null);

  // Sync synchronously so child queries issued on this render carry X-Target-Org-Id.
  setActiveTargetOrgId(orgParam);

  const prevOrgRef = useRef<string | null>(orgParam);
  useEffect(() => {
    if (prevOrgRef.current !== orgParam) {
      prevOrgRef.current = orgParam;
      queryClient.invalidateQueries({
        predicate: (query) => {
          const head = query.queryKey[0];
          return head !== 'auth' && head !== 'org';
        },
      });
    }
  }, [orgParam, queryClient]);

  const { data: authData } = useQuery({ queryKey: ['auth', 'me'], queryFn: api.me });
  const { data: orgData } = useQuery({ queryKey: ['org', 'me'], queryFn: api.getOrgMe });

  const enableAgencyMutation = useMutation({
    mutationFn: () => api.updateOrgMe({ orgType: 'agency' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['org', 'me'] });
    },
  });

  const createClientMutation = useMutation({
    mutationFn: (name: string) =>
      api.createClientOrg({
        name,
        permissions: ['manage_screens', 'manage_schedules', 'manage_media'],
      }),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['org', 'me'] });
      setClientName('');
      setClientError(null);
      const next = new URLSearchParams(searchParams);
      next.delete('modal');
      next.set('org', res.organization.id);
      setSearchParams(next);
    },
    onError: (err) => {
      setClientError(err instanceof Error ? err.message : 'Failed to create client workspace');
    },
  });

  if (!orgData) return null;

  const { organization, grants } = orgData;
  const userRole = authData?.user.role;
  const canManageOrg = userRole === 'owner' || userRole === 'admin';
  const activeGrants = grants.filter((g) => g.status === 'active');
  const selectedGrant = orgParam ? activeGrants.find((g) => g.clientOrgId === orgParam) : null;

  const switchOrg = (val: string) => {
    const next = new URLSearchParams(searchParams);
    if (val === SELF_ORG_VALUE) {
      next.delete('org');
    } else {
      next.set('org', val);
    }
    next.delete('page');
    setSearchParams(next);
  };

  const openNewClientModal = () => {
    const next = new URLSearchParams(searchParams);
    next.set('modal', 'new-client');
    setSearchParams(next);
  };

  const closeNewClientModal = () => {
    setClientName('');
    setClientError(null);
    const next = new URLSearchParams(searchParams);
    next.delete('modal');
    setSearchParams(next);
  };

  const handleCreateClient = (e: FormEvent) => {
    e.preventDefault();
    if (!clientName.trim()) return;
    setClientError(null);
    createClientMutation.mutate(clientName.trim());
  };

  if (organization.orgType === 'standalone') {
    return (
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-card/60 px-4 py-2.5 text-xs">
        <div className="flex items-center gap-2 text-muted-foreground">
          <Building2 className="h-3.5 w-3.5" />
          <span>Workspace:</span>
          <span className="font-medium text-foreground">{organization.name}</span>
          <Badge variant="outline">Standalone</Badge>
        </div>
        {canManageOrg && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => enableAgencyMutation.mutate()}
            disabled={enableAgencyMutation.isPending}
          >
            {enableAgencyMutation.isPending ? 'Enabling...' : 'Enable Agency Mode'}
          </Button>
        )}
      </div>
    );
  }

  return (
    <div className="mb-6 space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-card px-4 py-2.5">
        <div className="flex flex-wrap items-center gap-3 text-xs">
          <div className="flex items-center gap-1.5 text-muted-foreground">
            <Building2 className="h-3.5 w-3.5" />
            <span>Scope:</span>
          </div>
          <Select
            value={selectedGrant ? selectedGrant.clientOrgId : SELF_ORG_VALUE}
            onValueChange={switchOrg}
          >
            <SelectTrigger className="h-8 w-64 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={SELF_ORG_VALUE}>
                My Agency ({organization.name})
              </SelectItem>
              {activeGrants.map((g) => (
                <SelectItem key={g.clientOrgId} value={g.clientOrgId}>
                  Client: {g.clientName ?? g.clientSlug ?? g.clientOrgId.slice(0, 8)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Badge variant="outline">{organization.orgType}</Badge>
        </div>

        {canManageOrg && (
          <Button type="button" variant="outline" size="sm" onClick={openNewClientModal}>
            <Plus className="h-3.5 w-3.5" />
            New Client
          </Button>
        )}
      </div>

      {selectedGrant && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-2 text-xs text-amber-200">
          <div className="flex items-center gap-2">
            <ShieldAlert className="h-4 w-4 shrink-0 text-amber-300" />
            <span>
              Viewing delegated client workspace:{' '}
              <strong>{selectedGrant.clientName ?? selectedGrant.clientSlug}</strong> — All edits
              apply to this client&apos;s fleet.
            </span>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => switchOrg(SELF_ORG_VALUE)}
          >
            Return to Agency
          </Button>
        </div>
      )}

      <Dialog open={modalParam === 'new-client'} onOpenChange={(next) => !next && closeNewClientModal()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create Client Workspace</DialogTitle>
            <DialogDescription>
              Provision an isolated client tenant under your agency and switch into its fleet scope.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleCreateClient} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="client-org-name">Client Name</Label>
              <Input
                id="client-org-name"
                type="text"
                required
                placeholder="e.g. Metro Coffee Roasters"
                value={clientName}
                onChange={(e) => setClientName(e.target.value)}
              />
            </div>

            {clientError && (
              <div className="rounded-md border border-destructive/40 bg-destructive/15 px-3 py-2 text-xs text-red-300">
                {clientError}
              </div>
            )}

            <DialogFooter>
              <Button type="button" variant="outline" onClick={closeNewClientModal}>
                Cancel
              </Button>
              <Button type="submit" disabled={createClientMutation.isPending || !clientName.trim()}>
                {createClientMutation.isPending ? 'Creating...' : 'Create Client Workspace'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
