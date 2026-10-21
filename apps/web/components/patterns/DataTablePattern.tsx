import * as React from "react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils/cn";

export interface DataTableColumn<T> {
  /** Header text. */
  header: string;
  /** Cell renderer for a row. */
  cell: (row: T) => React.ReactNode;
  /** Optional className applied to both header and body cells (e.g. mono/right-align). */
  className?: string;
}

export interface DataTablePatternProps<T> {
  columns: DataTableColumn<T>[];
  rows: T[];
  /** Stable key per row. */
  rowKey: (row: T) => string;
  /** Rendered when `rows` is empty. */
  empty?: React.ReactNode;
  className?: string;
}

/**
 * Table wrapper; the rounded ring shell comes from `Table`. Numeric/ID columns should pass
 * `className="font-mono tabular-nums"`. Presentation only.
 */
export function DataTablePattern<T>({
  columns,
  rows,
  rowKey,
  empty,
  className,
}: DataTablePatternProps<T>) {
  return (
    <div
      className={cn(
        "min-w-0",
        className,
      )}
    >
      <Table>
        <TableHeader>
          <TableRow>
            {columns.map((col, colIdx) => (
              <TableHead key={`${col.header}-${colIdx}`} className={col.className}>
                {col.header}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.length === 0 ? (
            <TableRow>
              <TableCell
                colSpan={columns.length}
                className="py-10 text-center text-sm text-ink-3"
              >
                {empty ?? "No data."}
              </TableCell>
            </TableRow>
          ) : (
            rows.map((row) => (
              <TableRow key={rowKey(row)}>
                {columns.map((col, colIdx) => (
                  <TableCell
                    key={`${col.header}-${colIdx}`}
                    className={col.className}
                  >
                    {col.cell(row)}
                  </TableCell>
                ))}
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </div>
  );
}
