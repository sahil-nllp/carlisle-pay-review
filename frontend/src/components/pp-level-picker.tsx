"use client";

/**
 * Shared PP-level picker dropdown.
 * Used by both site-review-client and approvals-client so the behaviour
 * stays in sync between the two pages.
 */
import React from "react";
import {
  filterPPOptionsForAward,
  streamForAward,
  type PPBand,
} from "@/lib/pp-bands";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

function fmt(v: number) {
  return `$${v.toFixed(2)}`;
}

export const PP_CLEAR = "__pp_clear__";
export const PP_ALL = "__pp_all__";

export function PPLevelPicker({
  ppBands,
  effectiveAward,
  value,
  locked,
  onSelect,
}: {
  ppBands: PPBand[];
  effectiveAward: string | null | undefined;
  value: string | null | undefined;
  locked: boolean;
  onSelect: (convention: string | null) => void;
}) {
  const [showAll, setShowAll] = React.useState(false);

  const filtered = React.useMemo(
    () => filterPPOptionsForAward(ppBands, effectiveAward),
    [ppBands, effectiveAward],
  );

  // All bands scoped to the same stream as this award (admin or tech)
  const streamBands = React.useMemo(() => {
    const stream = streamForAward(effectiveAward);
    return stream ? ppBands.filter((b) => b.stream === stream) : ppBands;
  }, [ppBands, effectiveAward]);

  // Auto-select when exactly one option and nothing is set yet
  React.useEffect(() => {
    if (!locked && filtered.length === 1 && !value) {
      onSelect(filtered[0].convention);
    }
  }, [filtered, value, locked, onSelect]);

  // No award yet → don't show
  if (!effectiveAward) return null;
  // No bands loaded at all → don't show
  if (ppBands.length === 0) return null;

  const noMatch = filtered.length === 0;
  const options = noMatch || showAll ? streamBands : filtered;

  const selected = value || PP_CLEAR;
  const selectedInOptions = options.some((o) => o.convention === selected);
  const selectedBand = value
    ? (options.find((o) => o.convention === value) ??
       ppBands.find((o) => o.convention === value))
    : null;
  const triggerLabel = value
    ? (selectedBand?.carlisle_label ?? value)
    : "Select PP level…";
  const triggerPrice =
    selectedBand?.band_min != null
      ? selectedBand.band_max != null
        ? `${fmt(selectedBand.band_min)}–${fmt(selectedBand.band_max)}`
        : `${fmt(selectedBand.band_min)}+`
      : null;

  return (
    <div>
      <Select
        value={selected}
        onValueChange={(v) => {
          if (v === PP_CLEAR) onSelect(null);
          else if (v === PP_ALL) setShowAll(true);
          else onSelect(v);
        }}
        disabled={locked}
      >
        <SelectTrigger
          className="w-full text-xs px-2"
          style={{
            height: "auto",
            minHeight: 28,
            paddingTop: 4,
            paddingBottom: 4,
            borderColor: value ? "#cbd5e1" : "var(--neutral-200)",
            color: value ? "#0f172a" : "#94a3b8",
            background: value ? "white" : "#f8fafc",
          }}
        >
          <div style={{ textAlign: "left" }}>
            <div
              style={{
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {triggerLabel}
            </div>
            {triggerPrice && (
              <div style={{ fontSize: 10, color: "#94a3b8", marginTop: 1 }}>
                {triggerPrice}
              </div>
            )}
          </div>
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={PP_CLEAR} className="text-xs">
            <span style={{ color: "#94a3b8" }}>— Clear —</span>
          </SelectItem>
          {options.map((b) => (
            <SelectItem key={b.convention} value={b.convention} className="text-xs">
              <div>
                <div>{b.carlisle_label ?? b.convention}</div>
                {b.band_min != null && (
                  <div style={{ color: "#94a3b8", fontSize: 10 }}>
                    {b.band_max != null
                      ? `${fmt(b.band_min)}–${fmt(b.band_max)}`
                      : `${fmt(b.band_min)}+`}
                  </div>
                )}
              </div>
            </SelectItem>
          ))}
          {/* Saved value that's not in current option list — keep it selectable */}
          {value && !selectedInOptions && (
            <SelectItem value={value} className="text-xs">
              <span style={{ color: "#94a3b8" }}>{value}</span>
            </SelectItem>
          )}
          {!noMatch && !showAll && (
            <SelectItem value={PP_ALL} className="text-xs">
              <span style={{ color: "#1d4ed8" }}>Show all bands…</span>
            </SelectItem>
          )}
        </SelectContent>
      </Select>
      {noMatch && (
        <div style={{ fontSize: 10, color: "#b45309", marginTop: 2 }}>
          ⚠ No PP band for this award — pick manually
        </div>
      )}
    </div>
  );
}
