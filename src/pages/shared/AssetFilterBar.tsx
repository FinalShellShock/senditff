// Filter controls for the shared asset pool. Used by the trade calculator and
// by Send It's asset scoping, so the two cannot drift apart on what "young" or
// "fringe" means.

import type { Position } from "../../algo/types.ts";
import type { AssetFilters } from "../../data/assetPool.ts";
import { assetFiltersActive } from "../../data/assetPool.ts";

const POSITIONS: Position[] = ["QB", "RB", "WR", "TE"];

// Bands rather than free number entry. The values users actually reach for are
// the ones the scouting report already names, and two typed numbers per axis is
// a lot of interaction for a filter you apply and discard.
const AGE_BANDS: Array<{ label: string; min: number | null; max: number | null }> = [
  { label: "any age", min: null, max: null },
  { label: "24 and under", min: null, max: 24 },
  { label: "25 to 27", min: 25, max: 27 },
  { label: "28 to 30", min: 28, max: 30 },
  { label: "31 and up", min: 31, max: null },
];

const VALUE_BANDS: Array<{ label: string; min: number | null; max: number | null }> = [
  { label: "any value", min: null, max: null },
  { label: "5,000+", min: 5000, max: null },
  { label: "2,000 to 5,000", min: 2000, max: 5000 },
  { label: "500 to 2,000", min: 500, max: 2000 },
  { label: "under 500", min: null, max: 500 },
];

function bandKey(min: number | null, max: number | null): string {
  return `${min ?? ""}|${max ?? ""}`;
}

export default function AssetFilterBar({
  filters,
  onChange,
  showKind = true,
}: {
  filters: AssetFilters;
  onChange: (next: AssetFilters) => void;
  showKind?: boolean;
}) {
  const set = <K extends keyof AssetFilters>(key: K, value: AssetFilters[K]) =>
    onChange({ ...filters, [key]: value });

  return (
    <div className="asset-filter-bar">
      <div className="asset-filter-chips">
        <button
          type="button"
          className={`asset-filter-chip${filters.position === "" ? " active" : ""}`}
          onClick={() => set("position", "")}
        >
          ALL
        </button>
        {POSITIONS.map((pos) => (
          <button
            key={pos}
            type="button"
            className={`asset-filter-chip${filters.position === pos ? " active" : ""}`}
            onClick={() => set("position", filters.position === pos ? "" : pos)}
          >
            {pos}
          </button>
        ))}
      </div>

      <select
        className="asset-filter-select"
        aria-label="Age band"
        value={bandKey(filters.ageMin, filters.ageMax)}
        onChange={(e) => {
          const band = AGE_BANDS.find((b) => bandKey(b.min, b.max) === e.target.value);
          if (band) onChange({ ...filters, ageMin: band.min, ageMax: band.max });
        }}
      >
        {AGE_BANDS.map((b) => (
          <option key={bandKey(b.min, b.max)} value={bandKey(b.min, b.max)}>
            {b.label}
          </option>
        ))}
      </select>

      <select
        className="asset-filter-select"
        aria-label="Value band"
        value={bandKey(filters.valueMin, filters.valueMax)}
        onChange={(e) => {
          const band = VALUE_BANDS.find((b) => bandKey(b.min, b.max) === e.target.value);
          if (band) onChange({ ...filters, valueMin: band.min, valueMax: band.max });
        }}
      >
        {VALUE_BANDS.map((b) => (
          <option key={bandKey(b.min, b.max)} value={bandKey(b.min, b.max)}>
            {b.label}
          </option>
        ))}
      </select>

      {showKind && (
        <select
          className="asset-filter-select"
          aria-label="Asset kind"
          value={filters.kind}
          onChange={(e) => set("kind", e.target.value as AssetFilters["kind"])}
        >
          <option value="all">players + picks</option>
          <option value="player">players only</option>
          <option value="pick">picks only</option>
        </select>
      )}

      {assetFiltersActive(filters) && (
        <button
          type="button"
          className="btn-link asset-filter-clear"
          onClick={() =>
            onChange({
              ...filters,
              position: "",
              kind: "all",
              ageMin: null,
              ageMax: null,
              valueMin: null,
              valueMax: null,
            })
          }
        >
          clear filters
        </button>
      )}
    </div>
  );
}
