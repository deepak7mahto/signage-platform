import { useQuery } from '@tanstack/react-query';
import { Search, ShieldCheck } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import { Badge } from '../components/ui/badge';
import { Card } from '../components/ui/card';
import { Input } from '../components/ui/input';
import { PaginationBar, paginateItems } from '../components/ui/list-controls';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../components/ui/table';
import { api } from '../lib/api';

export function AuditLogsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const q = searchParams.get('q') ?? '';
  const pageParam = searchParams.get('page');

  const { data, isLoading } = useQuery({
    queryKey: ['audit-logs', q],
    queryFn: () => api.listAuditLogs(q || undefined),
    refetchInterval: 15_000,
  });

  const setSearch = (val: string) => {
    const next = new URLSearchParams(searchParams);
    if (val) next.set('q', val);
    else next.delete('q');
    next.delete('page');
    setSearchParams(next, { replace: true });
  };

  const setPage = (nextPage: number) => {
    const next = new URLSearchParams(searchParams);
    if (nextPage <= 1) next.delete('page');
    else next.set('page', String(nextPage));
    setSearchParams(next);
  };

  const logs = data?.items ?? [];
  const paged = paginateItems(logs, pageParam, 15);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Audit Logs</h1>
        <p className="text-sm text-muted-foreground">
          Immutable log of media approvals, playlist updates, screen pairing, and remote fleet commands.
        </p>
      </div>

      <div className="relative max-w-sm">
        <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          type="search"
          placeholder="Filter by action, actor, or target..."
          value={q}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-9"
        />
      </div>

      {isLoading ? (
        <div className="py-12 text-center text-sm text-muted-foreground">Loading audit trail...</div>
      ) : paged.pageItems.length === 0 ? (
        <Card className="border-dashed p-12 text-center">
          <ShieldCheck className="mx-auto mb-3 h-8 w-8 text-muted-foreground" />
          <p className="text-sm font-medium">No matching audit entries</p>
        </Card>
      ) : (
        <>
          <Card className="overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>Timestamp</TableHead>
                  <TableHead>Actor</TableHead>
                  <TableHead>Action</TableHead>
                  <TableHead>Target</TableHead>
                  <TableHead>Metadata</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {paged.pageItems.map((entry) => (
                  <TableRow key={entry.id}>
                    <TableCell className="text-xs text-muted-foreground">
                      {new Date(entry.createdAt).toLocaleString()}
                    </TableCell>
                    <TableCell className="text-xs font-medium">
                      {entry.actorEmail ?? 'system'}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className="font-mono text-[11px]">
                        {entry.action}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {entry.targetType}
                      {entry.targetId ? ` (${entry.targetId.slice(0, 8)}...)` : ''}
                    </TableCell>
                    <TableCell className="max-w-xs truncate font-mono text-[11px] text-muted-foreground">
                      {entry.metadata ? JSON.stringify(entry.metadata) : '—'}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>

          <PaginationBar
            page={paged.page}
            totalPages={paged.totalPages}
            totalItems={paged.totalItems}
            startIdx={paged.startIdx}
            endIdx={paged.endIdx}
            onPageChange={setPage}
          />
        </>
      )}
    </div>
  );
}
