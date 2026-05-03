import type {
  Feature as GeoJSONFeature,
  MultiPolygon as GeoJSONMultiPolygon,
  Polygon as GeoJSONPolygon,
  GeoJsonObject,
} from 'geojson';

export type FeatureCollection = {
  type: 'FeatureCollection';
  features: GeoJSONFeature[];
};

export type Region = {
  codeInsee: string;
  nomOfficiel: string;
};

export type Department = {
  codeInsee: string;
  codeInseeRegion: string;
  nomOfficiel: string;
};

export type Commune = {
  id: string;
  name: string;
};

export type LieuDit = {
  id: number;
  name: string;
  communeId: string;
};

export type ForestClass = {
  code: string;
  label: string;
};

export type MapState = {
  center: { lon: number; lat: number };
  zoom: number;
  selectedRegion?: string | null;
  selectedDepartment?: string | null;
  selectedCommune?: string | null;
  selectedLieuDit?: string | null;
  basemapMode?: 'map' | 'satellite';
  activeForestClassCodes?: string[];
};

export type RasterStat = {
  mean: number;
  min: number;
  max: number;
  std: number;
  median: number;
  unit: string;
};

export type PolygonStats = {
  areaHa: number;
  totalForestAreaHa: number;
  parcelIds: string[];
  treeSpecies: Array<{
    species: string;
    codeTfv: string;
    areaHa: number;
    priceEurM3: number | null;
  }>;
  rasterStats: {
    agbd: RasterStat;
    height: RasterStat;
    wvd: RasterStat;
  } | null;
  forestChange: {
    treecover2000_mean: number;
    loss_area_ha_by_year: Record<number, number>;
    gain_area_ha: number;
    net_change_ha: number;
  } | null;
  lidar: {
    mean_height: number;
    max_height: number;
    p50: number;
    p75: number;
    p95: number;
    point_density: number;
  } | null;
  standingVolumeM3: number;
  estimatedValueEur: number;
  carbonStockTCO2e: number;
  geometry?: GeoJsonObject;
};

export type SearchResults = {
  communes: Array<{ id: string; name: string }>;
  lieuxDits: Array<{ id: number; name: string; communeId: string }>;
};

export type DrawnPolygon = GeoJSONFeature<GeoJSONPolygon | GeoJSONMultiPolygon>;

export type PolygonStatsSource = 'polygon' | 'admin' | null;

export type HeightGridCell = GeoJSONFeature<
  GeoJSONPolygon | GeoJSONMultiPolygon,
  {
    id: string;
    meanHeightM: number;
    row: number;
    col: number;
  }
>;

export type HeightGridResponse = {
  type: 'FeatureCollection';
  features: HeightGridCell[];
  meta: {
    year: number;
    cellSizeM: number;
    cellCount: number;
    unit: string;
  };
};

export type DeckExtrusionDatum = GeoJSONFeature<
  GeoJSONPolygon | GeoJSONMultiPolygon,
  {
    id: string;
    meanHeightM: number;
    row: number;
    col: number;
    elevationM: number;
  }
>;
