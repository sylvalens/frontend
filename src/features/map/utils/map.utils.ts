import { GeoJsonObject } from 'geojson';
import {
  FeatureCollection,
  HeightGridResponse,
  DeckExtrusionDatum,
} from '../types/map.types';

export const EXTRUSION_HEIGHT_SCALE = 8;
export const EXTRUSION_MIN_HEIGHT_M = 12;
export const EXTRUSION_MAX_HEIGHT_M = 350;
export const EXTRUSION_GRID_YEAR = 2024;
export const EXTRUSION_GRID_CELL_SIZE_M = 40;
export const EXTRUSION_GRID_MAX_CELLS = 250000;

export const FOREST_CLASS_COLORS = [
  '#1b9e77',
  '#d95f02',
  '#7570b3',
  '#e7298a',
  '#66a61e',
  '#e6ab02',
  '#a6761d',
  '#666666',
  '#8c564b',
  '#17becf',
  '#9467bd',
];

export const EMPTY_FC: FeatureCollection = {
  type: 'FeatureCollection',
  features: [],
};

export function getBboxFromFeatureCollection(
  fc: FeatureCollection,
): [number, number, number, number] | null {
  if (!fc.features || fc.features.length === 0) return null;

  const coords: number[][] = [];

  const extract = (geom: GeoJsonObject) => {
    if (!geom) return;
    const type = geom.type;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const coordinates = (geom as any).coordinates;

    if (type === 'Point') {
      coords.push(coordinates);
    } else if (type === 'MultiPoint' || type === 'LineString') {
      coordinates.forEach((c: number[]) => coords.push(c));
    } else if (type === 'MultiLineString' || type === 'Polygon') {
      coordinates.forEach((ring: number[][]) =>
        ring.forEach((c) => coords.push(c)),
      );
    } else if (type === 'MultiPolygon') {
      coordinates.forEach((poly: number[][][]) =>
        poly.forEach((ring: number[][]) =>
          ring.forEach((c: number[]) => coords.push(c)),
        ),
      );
    }
  };

  fc.features.forEach((f) => extract(f.geometry));
  if (coords.length === 0) return null;

  let [minX, minY] = coords[0];
  let [maxX, maxY] = coords[0];

  coords.forEach(([x, y]) => {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  });

  return [minX, minY, maxX, maxY];
}

export async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) {
    throw new Error(`Request failed: ${res.status}`);
  }
  return (await res.json()) as T;
}

export function buildDeckExtrusionData(
  heightGrid: HeightGridResponse | null,
): DeckExtrusionDatum[] {
  if (!heightGrid?.features || heightGrid.features.length === 0) {
    return [];
  }

  return heightGrid.features
    .map((feature, index) => {
      const geometry = feature.geometry;
      if (!geometry || (geometry.type !== 'Polygon' && geometry.type !== 'MultiPolygon')) {
        return null;
      }

      const meanHeightM = Number(feature.properties?.meanHeightM ?? 0);
      if (!Number.isFinite(meanHeightM) || meanHeightM <= 0) {
        return null;
      }

      const elevationM = Math.min(
        EXTRUSION_MAX_HEIGHT_M,
        Math.max(EXTRUSION_MIN_HEIGHT_M, meanHeightM * EXTRUSION_HEIGHT_SCALE),
      );

      return {
        type: 'Feature',
        geometry,
        properties: {
          id: feature.properties?.id ?? `drawn-grid-cell-${index}`,
          meanHeightM,
          row: Number(feature.properties?.row ?? 0),
          col: Number(feature.properties?.col ?? 0),
          elevationM,
        },
      } as DeckExtrusionDatum;
    })
    .filter((item): item is DeckExtrusionDatum => item !== null);
}
