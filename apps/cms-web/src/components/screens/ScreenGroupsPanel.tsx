import { FolderTree, Pencil, Trash2 } from 'lucide-react';
import type { ScreenGroup } from '@signage/shared';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Card } from '../ui/card';
import { PaginationBar } from '../ui/list-controls';

interface ScreenGroupsPanelProps {
  loading: boolean;
  groups: ScreenGroup[];
  page: number;
  totalPages: number;
  totalItems: number;
  startIdx: number;
  endIdx: number;
  screenNameById: Map<string, string>;
  onEditGroup: (groupId: string) => void;
  onDeleteGroup: (groupId: string) => void;
  onPageChange: (page: number) => void;
}

export function ScreenGroupsPanel({
  loading,
  groups,
  page,
  totalPages,
  totalItems,
  startIdx,
  endIdx,
  screenNameById,
  onEditGroup,
  onDeleteGroup,
  onPageChange,
}: ScreenGroupsPanelProps) {
  if (loading) {
    return <div className="py-12 text-center text-sm text-muted-foreground">Loading groups...</div>;
  }

  if (groups.length === 0) {
    return (
      <Card className="border-dashed p-12 text-center">
        <FolderTree className="mx-auto mb-3 h-8 w-8 text-muted-foreground" />
        <p className="text-sm font-medium">No matching screen groups</p>
      </Card>
    );
  }

  return (
    <>
      <Card className="divide-y divide-border overflow-hidden">
        {groups.map((group) => (
          <div key={group.id} className="flex items-center justify-between gap-4 p-4">
            <div className="min-w-0 flex-1 space-y-1">
              <div className="flex items-center gap-2">
                <span className="font-medium">{group.name}</span>
                <Badge variant="secondary">
                  {group.screenIds.length} screen{group.screenIds.length === 1 ? '' : 's'}
                </Badge>
              </div>
              {group.description && <div className="text-xs text-muted-foreground">{group.description}</div>}
              {group.screenIds.length > 0 && (
                <div className="flex flex-wrap gap-1.5 pt-1">
                  {group.screenIds.map((sid) => (
                    <Badge key={sid} variant="outline" className="text-[11px]">
                      {screenNameById.get(sid) ?? sid.slice(0, 8)}
                    </Badge>
                  ))}
                </div>
              )}
            </div>
            <div className="flex items-center gap-1.5">
              <Button variant="outline" size="sm" onClick={() => onEditGroup(group.id)}>
                <Pencil className="h-3.5 w-3.5" />
                Edit
              </Button>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => onDeleteGroup(group.id)}
                className="h-8 w-8 text-red-300 hover:bg-destructive/15"
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          </div>
        ))}
      </Card>
      <PaginationBar
        page={page}
        totalPages={totalPages}
        totalItems={totalItems}
        startIdx={startIdx}
        endIdx={endIdx}
        onPageChange={onPageChange}
      />
    </>
  );
}
