/**
 * Pay Progression bands — client fetch + award→options filter.
 *
 * Award matching rules (from PP Tech / PP Admin Excel structure):
 *
 *   SS awards (Support Services)
 *     Employee award (e.g. "HPSS SS L7") matches `award_key` verbatim.
 *
 *   HP awards (Health Professional)
 *     Employee award format: "HPSS HP L{n} PP{x}"
 *     PP Tech bands have `award_key` like "HPL{n}.a-{n}.b" (a range of PP levels)
 *     An award matches a band iff its n equals the band's n AND its PP {x} ∈ [a, b].
 *
 *   HPSSL5 / HPSSL6 (Technical Assistants)
 *     Exact match on `award_key`. Appears in both files; we de-dup by convention.
 */
import { api } from "@/lib/api";

export interface PPBand {
  convention: string;            // unique key, saved to employee.pp_level
  award_key: string | null;      // e.g. "HPSS SS L7", "HPL2.1-2.4", "HPSSL5"
  carlisle_label: string | null; // e.g. "2IC First Year", "RadiographerQualified"
  stream: "admin" | "tech";
  section_header: string | null;
  award_level_group: string | null;
  band_min: number | null;
  band_max: number | null;
}

export async function getPPBands(cycleId: number): Promise<PPBand[]> {
  return api<PPBand[]>(`/api/v1/cycles/${cycleId}/pp-bands`);
}

// ── Filter logic ────────────────────────────────────────────────────────────

const HP_AWARD_RE = /^HPSS\s+HP\s+L(\d+)\s+PP(\d+)$/i;
const HP_BAND_RE  = /^HPL(\d+)\.(\d+)-\1\.(\d+)$/i; // \1 ensures same major level

/**
 * Determine which PP stream an award belongs to.
 * HP awards ("HPSS HP L{n} PP{x}") → "tech"; everything else → "admin".
 */
export function streamForAward(award: string | null | undefined): "admin" | "tech" | null {
  if (!award) return null;
  return HP_AWARD_RE.test(award.trim()) ? "tech" : "admin";
}

/**
 * Filter bands relevant to the given employee award.
 * Returns [] if no bands match — caller should show full list with a hint.
 */
export function filterPPOptionsForAward(
  bands: readonly PPBand[],
  award: string | null | undefined,
): PPBand[] {
  if (!award) return [];
  const trimmed = award.trim();

  // HP range match
  const hp = HP_AWARD_RE.exec(trimmed);
  if (hp) {
    const empLevel = Number(hp[1]);
    const empPP = Number(hp[2]);
    return bands.filter((b) => {
      if (!b.award_key) return false;
      const m = HP_BAND_RE.exec(b.award_key);
      if (!m) return false;
      const bandLevel = Number(m[1]);
      const bandLo = Number(m[2]);
      const bandHi = Number(m[3]);
      return bandLevel === empLevel && empPP >= bandLo && empPP <= bandHi;
    });
  }

  // SS / HPSSL5 / HPSSL6 / anything else → exact award_key match
  const seen = new Set<string>();
  const out: PPBand[] = [];
  for (const b of bands) {
    if (b.award_key?.trim() === trimmed && !seen.has(b.convention)) {
      seen.add(b.convention);
      out.push(b);
    }
  }
  return out;
}
