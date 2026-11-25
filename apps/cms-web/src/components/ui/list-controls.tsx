import { ChevronLeft, ChevronRight, Search } from 'lucide-react';
import { Button } from './button';
import { Input } from './input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './select';

export function paginateItems<T>(
  items: T[],
  rawPage: string | null,
  pageSize = 10,
): {
  page: number;
  totalPages: number;
  pageItems: T[];
  totalItems: number;
  startIdx: number;
  endIdx: number;
} {
  const totalItems = items.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  const parsed = Number.parseInt(rawPage ?? '1', 10);
  const page = Number.isFinite(parsed) && parsed >= 1 ? Math.min(parsed, totalPages) : 1;
  const startIdx = (page - 1) * pageSize;
  const endIdx = Math.min(startIdx + pageSize, totalItems);
  return {
    page,
    totalPages,
    pageItems: items.slice(startIdx, endIdx),
    totalItems,
    startIdx,
    endIdx,
  };
}

interface FilterOption {
  value: string;
  label: string;
}

interface ListToolbarProps {
  searchPlaceholder: string;
  searchValue: string;
  onSearchChange: (val: string) => void;
  filterValue?: string;
  filterOptions?: FilterOption[];
  onFilterChange?: (val: string) => void;
  totalCount?: number;
}

export function ListToolbar({
  searchPlaceholder,
  searchValue,
  onSearchChange,
  filterValue,
  filterOptions,
  onFilterChange,
  totalCount,
}: ListToolbarProps) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex flex-1 flex-wrap items-center gap-2.5">
        <div className="relative w-full max-w-xs">
          <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="search"
            placeholder={searchPlaceholder}
            value={searchValue}
            onChange={(e) => onSearchChange(e.target.value)}
            className="pl-9"
          />
        </div>

        {filterOptions && filterValue !== undefined && onFilterChange && (
          <Select value={filterValue} onValueChange={onFilterChange}>
            <SelectTrigger className="w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {filterOptions.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>

      {typeof totalCount === 'number' && (
        <div className="text-xs text-muted-foreground">
          {totalCount} item{totalCount === 1 ? '' : 's'} matching
        </div>
      )}
    </div>
  );
}

interface PaginationBarProps {
  page: number;
  totalPages: number;
  totalItems: number;
  startIdx: number;
  endIdx: number;
  onPageChange: (page: number) => void;
}

export function PaginationBar({
  page,
  totalPages,
  totalItems,
  startIdx,
  endIdx,
  onPageChange,
}: PaginationBarProps) {
  if (totalItems === 0) return null;

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-3 text-xs text-muted-foreground">
      <div>
        Showing <span className="font-medium text-foreground">{startIdx + 1}</span>–
        <span className="font-medium text-foreground">{endIdx}</span> of{' '}
        <span className="font-medium text-foreground">{totalItems}</span>
      </div>

      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={page <= 1}
          onClick={() => onPageChange(page - 1)}
        >
          <ChevronLeft className="h-3.5 w-3.5" />
          Prev
        </Button>
        <span className="px-1 font-medium text-foreground">
          Page {page} / {totalPages}
        </span>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={page >= totalPages}
          onClick={() => onPageChange(page + 1)}
        >
          Next
          <ChevronRight className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}
