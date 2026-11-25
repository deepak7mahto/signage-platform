import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Download, FileSpreadsheet, Upload } from 'lucide-react';
import { useState, type ChangeEvent, type FormEvent } from 'react';
import type { BulkProvisionResponse } from '@signage/shared';
import { api } from '../../lib/api';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../ui/dialog';
import { Label } from '../ui/label';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../ui/table';

const SAMPLE_CSV = [
  'name,location,timezone,orientation,city',
  'Lobby Display 1,Main Entrance,Asia/Kolkata,landscape,Mumbai',
  'Checkout Menu 2,Billing Counter,Asia/Kolkata,portrait,Mumbai',
].join('\n');

interface BulkProvisionDialogProps {
  open: boolean;
  onClose: () => void;
}

export function BulkProvisionDialog({ open, onClose }: BulkProvisionDialogProps) {
  const queryClient = useQueryClient();
  const [csvText, setCsvText] = useState(SAMPLE_CSV);
  const [result, setResult] = useState<BulkProvisionResponse | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const resetAndClose = () => {
    setResult(null);
    setErrorMsg(null);
    onClose();
  };

  const bulkMutation = useMutation({
    mutationFn: api.bulkProvisionScreens,
    onSuccess: (res) => {
      setResult(res);
      queryClient.invalidateQueries({ queryKey: ['screens'] });
    },
    onError: (err) => {
      setErrorMsg(err instanceof Error ? err.message : 'Bulk provisioning failed');
    },
  });

  const handleFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    file.text().then((text) => {
      setCsvText(text);
      setErrorMsg(null);
    });
  };

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!csvText.trim()) return;
    setErrorMsg(null);
    bulkMutation.mutate(csvText);
  };

  const downloadTokensCsv = () => {
    if (!result) return;
    const header = 'rowNumber,name,ok,screenId,provisionToken,error';
    const rows = result.results.map((r) =>
      [
        r.rowNumber,
        `"${r.name.replace(/"/g, '""')}"`,
        r.ok,
        r.screenId ?? '',
        r.provisionToken ?? '',
        `"${(r.error ?? '').replace(/"/g, '""')}"`,
      ].join(','),
    );
    const blob = new Blob([[header, ...rows].join('\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'provision-tokens.csv';
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !next && resetAndClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileSpreadsheet className="h-4 w-4" />
            Bulk CSV Screen Provisioning
          </DialogTitle>
          <DialogDescription>
            Paste CSV rows or upload a CSV file (`name,location,timezone,orientation,city`) to issue
            up to 1,000 single-use `PROV-*` onboarding tokens at once.
          </DialogDescription>
        </DialogHeader>

        {result ? (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <Badge variant="success">{result.succeeded} Succeeded</Badge>
              {result.failed > 0 && <Badge variant="destructive">{result.failed} Failed</Badge>}
              <span className="text-muted-foreground">Total processed: {result.total}</span>
            </div>

            <div className="max-h-72 overflow-y-auto rounded-md border border-border">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead>#</TableHead>
                    <TableHead>Screen</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Setup Token / Detail</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {result.results.map((r) => (
                    <TableRow key={`${r.rowNumber}-${r.name}`}>
                      <TableCell className="text-xs text-muted-foreground">{r.rowNumber}</TableCell>
                      <TableCell className="text-xs font-medium">{r.name || '—'}</TableCell>
                      <TableCell>
                        <Badge variant={r.ok ? 'success' : 'destructive'}>
                          {r.ok ? 'ok' : 'error'}
                        </Badge>
                      </TableCell>
                      <TableCell className="font-mono text-xs">
                        {r.ok ? r.provisionToken : r.error}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={downloadTokensCsv}>
                <Download className="h-4 w-4" />
                Download Tokens CSV
              </Button>
              <Button type="button" onClick={resetAndClose}>
                Done
              </Button>
            </DialogFooter>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="flex items-center justify-between gap-2">
              <Label htmlFor="bulk-csv-text">CSV Rows</Label>
              <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-border px-2.5 py-1 text-xs hover:bg-accent">
                <Upload className="h-3.5 w-3.5" />
                Upload .csv
                <input
                  type="file"
                  accept=".csv,text/csv"
                  className="hidden"
                  onChange={handleFileChange}
                />
              </label>
            </div>

            <textarea
              id="bulk-csv-text"
              rows={7}
              value={csvText}
              onChange={(e) => setCsvText(e.target.value)}
              className="w-full rounded-md border border-input bg-background px-3 py-2 font-mono text-xs text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              placeholder="name,location,timezone,orientation,city"
            />

            {errorMsg && (
              <div className="rounded-md border border-destructive/40 bg-destructive/15 px-3 py-2 text-xs text-red-300">
                {errorMsg}
              </div>
            )}

            <DialogFooter>
              <Button type="button" variant="outline" onClick={resetAndClose}>
                Cancel
              </Button>
              <Button type="submit" disabled={bulkMutation.isPending || !csvText.trim()}>
                {bulkMutation.isPending ? 'Provisioning...' : 'Provision Displays'}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
