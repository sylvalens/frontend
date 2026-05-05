'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import mapboxgl, { Map } from 'mapbox-gl';
import MapboxDraw from '@mapbox/mapbox-gl-draw';
import { MapboxOverlay } from '@deck.gl/mapbox';
import { GeoJsonLayer } from '@deck.gl/layers';
import type {
  Feature as GeoJSONFeature,
  MultiPolygon as GeoJSONMultiPolygon,
  Polygon as GeoJSONPolygon,
  GeoJsonObject,
} from 'geojson';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import {
  formatCompactThousands,
  formatFixed,
  formatGroupedInteger,
  formatInteger,
} from '@/lib/number-format';
import 'mapbox-gl/dist/mapbox-gl.css';
import '@mapbox/mapbox-gl-draw/dist/mapbox-gl-draw.css';

mapboxgl.accessToken = process.env.NEXT_PUBLIC_MAPBOX_TOKEN ?? '';

import {
  FeatureCollection,
  Region,
  Department,
  Commune,
  LieuDit,
  ForestClass,
  MapState,
  RasterStat,
  PolygonStats,
  SearchResults,
  DrawnPolygon,
  PolygonStatsSource,
  HeightGridCell,
  HeightGridResponse,
  DeckExtrusionDatum,
} from '@/features/map/types/map.types';
import {
  EXTRUSION_HEIGHT_SCALE,
  EXTRUSION_MIN_HEIGHT_M,
  EXTRUSION_MAX_HEIGHT_M,
  EXTRUSION_GRID_YEAR,
  EXTRUSION_GRID_CELL_SIZE_M,
  EXTRUSION_GRID_MAX_CELLS,
  FOREST_CLASS_COLORS,
  EMPTY_FC,
  getBboxFromFeatureCollection,
  fetchJson,
  buildDeckExtrusionData,
} from '@/features/map/utils/map.utils';
import { downloadCSV as utilsDownloadCSV, downloadPDF as utilsDownloadPDF } from '@/features/map/utils/export.utils';

const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:4000';

export default function MapPage() {
  // --- Refs for map + DOM ---
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<Map | null>(null);
  const router = useRouter();
  const drawRef = useRef<MapboxDraw | null>(null);
  const deckOverlayRef = useRef<MapboxOverlay | null>(null);
  const heightGridRequestSeqRef = useRef(0);

  // --- Refs to keep latest filter state for saveMapState ---
  const selectedRegionRef = useRef<string>('');
  const selectedDepartmentRef = useRef<string>('');
  const selectedCommuneRef = useRef<string>('');
  const selectedLieuDitRef = useRef<string>('');
  const basemapModeRef = useRef<'map' | 'satellite'>('map');
  const activeForestClassCodesRef = useRef<string[]>([]);
  const skipRegionFitRef = useRef(false);
  const skipDepartmentFitRef = useRef(false);
  const skipCommuneFlyRef = useRef(false);
  const skipLieuDitFitRef = useRef(false);
  const justFinishedDrawingRef = useRef(false);

  // AbortControllers for in-flight spatial requests
  const parcelsAbortRef = useRef<AbortController | null>(null);

  // --- UI / map state ---
  const [basemapMode, setBasemapMode] = useState<'map' | 'satellite'>('map');

  const [mapReady, setMapReady] = useState(false);

  const [regions, setRegions] = useState<Region[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [communes, setCommunes] = useState<Commune[]>([]);
  const [lieuxDits, setLieuxDits] = useState<LieuDit[]>([]);
  const [drawnPolygon, setDrawnPolygon] = useState<DrawnPolygon | null>(null);
  const [polygonStats, setPolygonStats] = useState<PolygonStats | null>(null);
  const [polygonStatsSource, setPolygonStatsSource] =
    useState<PolygonStatsSource>(null);
  const [polygonLoading, setPolygonLoading] = useState(false);
  const [polygonError, setPolygonError] = useState<string | null>(null);
  const [showPasteInput, setShowPasteInput] = useState(false);
  const [pastedGeoJson, setPastedGeoJson] = useState('');
  const [pasteError, setPasteError] = useState<string | null>(null);
  const [isDrawModeActive, setIsDrawModeActive] = useState(false);
  const [showPolygon3D, setShowPolygon3D] = useState(false);
  const [heightGridLoading, setHeightGridLoading] = useState(false);
  const [heightGrid, setHeightGrid] = useState<HeightGridResponse | null>(null);

  const [hoveredLossYear, setHoveredLossYear] = useState<number | 'total' | null>(null);
  const [lossPixelsFC, setLossPixelsFC] = useState<FeatureCollection | null>(null);
  const [loadingLossPixels, setLoadingLossPixels] = useState(false);
  const lossPixelsRequestSeqRef = useRef(0);

  const [regionsLayer, setRegionsLayer] = useState<FeatureCollection | null>(
    null,
  );
  const [departmentsLayer, setDepartmentsLayer] = useState<FeatureCollection | null>(null);
  const departmentsLayerRef = useRef<FeatureCollection | null>(null);
  const communesLayerRef = useRef<FeatureCollection | null>(null);
  const lieuDitLayerRef = useRef<FeatureCollection | null>(null);

  const [selectedRegion, setSelectedRegion] = useState<string>('');
  const [selectedDepartment, setSelectedDepartment] = useState<string>('');
  const [selectedCommune, setSelectedCommune] = useState<string>('');
  const [selectedLieuDit, setSelectedLieuDit] = useState<string>('');
  const [regionSelectionTick, setRegionSelectionTick] = useState(0);
  const [departmentSelectionTick, setDepartmentSelectionTick] = useState(0);
  const [communeSelectionTick, setCommuneSelectionTick] = useState(0);
  const [lieuDitSelectionTick, setLieuDitSelectionTick] = useState(0);
  const [logoutLoading, setLogoutLoading] = useState(false);
  const [logoutError, setLogoutError] = useState<string | null>(null);

  const [forestClasses, setForestClasses] = useState<ForestClass[]>([]);
  const [forestClassesError, setForestClassesError] = useState<string | null>(null);
  const [activeForestClassCodes, setActiveForestClassCodes] = useState<
    string[]
  >([]);

  const [webglError, setWebglError] = useState<boolean>(false);

  const [loadedMapState, setLoadedMapState] = useState<MapState | null>(null);
  const [mapStateLoadedOnce, setMapStateLoadedOnce] = useState(false);

  const [currentZoom, setCurrentZoom] = useState<number>(8);

  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<SearchResults | null>(null);
  const [isSearching, setIsSearching] = useState(false);

  const [showLidarCoverage, setShowLidarCoverage] = useState(false);
  const [lidarCoverage, setLidarCoverage] = useState<FeatureCollection | null>(null);

  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [sidebarWidth, setSidebarWidth] = useState(280);
  const [isResizing, setIsResizing] = useState(false);

  const startResizing = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizing(true);
  }, []);

  const stopResizing = useCallback(() => {
    setIsResizing(false);
  }, []);

  const resize = useCallback(
    (e: MouseEvent) => {
      if (isResizing) {
        const newWidth = Math.max(200, Math.min(e.clientX, 600));
        setSidebarWidth(newWidth);
        // Force map resize to recalculate canvas layout when sidebar is adjusted
        if (mapRef.current) {
          mapRef.current.resize();
        }
      }
    },
    [isResizing]
  );

  useEffect(() => {
    window.addEventListener('mousemove', resize);
    window.addEventListener('mouseup', stopResizing);
    return () => {
      window.removeEventListener('mousemove', resize);
      window.removeEventListener('mouseup', stopResizing);
    };
  }, [resize, stopResizing]);

  // Effect to trigger Mapbox map resize when the sidebar is opened/closed
  useEffect(() => {
    if (mapRef.current) {
      setTimeout(() => {
        mapRef.current?.resize();
      }, 300); // Wait for CSS transition (if any) to complete
    }
  }, [isSidebarOpen]);

  const canUsePolygonStatsFor3D = polygonStatsSource === 'polygon' || polygonStatsSource === 'admin';
  const canopyHeightSource =
    canUsePolygonStatsFor3D && polygonStats?.rasterStats?.height.mean != null
      ? 'FORMS-T mean canopy height'
      : canUsePolygonStatsFor3D && polygonStats?.lidar?.mean_height != null
      ? 'LiDAR mean height'
      : null;

  const canopyHeightMeanM = canUsePolygonStatsFor3D
    ? (polygonStats?.rasterStats?.height.mean ??
      polygonStats?.lidar?.mean_height ??
      0)
    : 0;

  const deckExtrusionData = useMemo(
    () => buildDeckExtrusionData(heightGrid),
    [heightGrid],
  );

  const canRenderPolygon3D = deckExtrusionData.length > 0;
  const extrusionCellCount = deckExtrusionData.length;
  const gridCellSizeM = heightGrid?.meta?.cellSizeM ?? EXTRUSION_GRID_CELL_SIZE_M;
  const extrusionElevationM = canRenderPolygon3D
    ? deckExtrusionData.reduce(
      (sum, datum) => sum + (datum.properties?.elevationM ?? 0),
      0,
    ) / deckExtrusionData.length
    : 0;

  useEffect(() => {
    if (!canRenderPolygon3D && showPolygon3D) {
      setShowPolygon3D(false);
    }
  }, [canRenderPolygon3D, showPolygon3D]);

  // --- Search debouncing ---
  useEffect(() => {
    if (!searchQuery || searchQuery.length < 2) {
      setSearchResults(null);
      return;
    }

    const timer = setTimeout(async () => {
      setIsSearching(true);
      try {
        const data = await fetchJson<SearchResults>(
          `${API_BASE}/admin/search?q=${encodeURIComponent(searchQuery)}`,
        );
        setSearchResults(data);
      } catch (err) {
        console.error('Search failed', err);
      } finally {
        setIsSearching(false);
      }
    }, 300);

    return () => clearTimeout(timer);
  }, [searchQuery]);

  const handleSearchResultClick = async (item: { id: string | number; communeId?: string; name?: string }, type: 'commune' | 'lieuDit') => {
    setSearchQuery('');
    setSearchResults(null);

    if (type === 'commune') {
      // Set skips so only the Commune effect handles the zoom
      skipRegionFitRef.current = true;
      skipDepartmentFitRef.current = true;
      
      selectRegion('44');
      selectDepartment('68');
      selectCommune(String(item.id));
    } else {
      // lieu-dit: Set skips so only the Lieu-Dit effect handles the zoom
      skipRegionFitRef.current = true;
      skipDepartmentFitRef.current = true;
      skipCommuneFlyRef.current = true;
      
      selectRegion('44');
      selectDepartment('68');
      if (item.communeId) {
        selectCommune(item.communeId);
      }
      selectLieuDit(String(item.id));
    }
  };

  const selectRegion = (
    value: string,
    options?: { userInitiated?: boolean },
  ) => {
    if (options?.userInitiated ?? true) {
      setRegionSelectionTick((tick) => tick + 1);
    }
    setSelectedRegion(value);
  };

  const selectDepartment = (
    value: string,
    options?: { userInitiated?: boolean },
  ) => {
    if (options?.userInitiated ?? true) {
      setDepartmentSelectionTick((tick) => tick + 1);
    }
    setSelectedDepartment(value);
  };

  const selectCommune = (
    value: string,
    options?: { userInitiated?: boolean },
  ) => {
    if (options?.userInitiated ?? true) {
      setCommuneSelectionTick((tick) => tick + 1);
    }
    setSelectedCommune(value);
  };

  const selectLieuDit = (
    value: string,
    options?: { userInitiated?: boolean },
  ) => {
    if (options?.userInitiated ?? true) {
      setLieuDitSelectionTick((tick) => tick + 1);
    }
    setSelectedLieuDit(value);
  };

  async function handleLogout() {
    setLogoutLoading(true);
    setLogoutError(null);
    try {
      const res = await fetch(`${API_BASE}/auth/logout`, {
        method: 'POST',
        credentials: 'include',
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || `Logout failed (${res.status})`);
      }
      router.push('/login');
    } catch (err: unknown) {
      console.error('Logout failed', err);
      setLogoutError(err instanceof Error ? err.message : 'Logout failed');
    } finally {
      setLogoutLoading(false);
    }
  }

  const resetHeightGrid = useCallback(() => {
    heightGridRequestSeqRef.current += 1;
    setHeightGrid(null);
    setHeightGridLoading(false);
  }, []);

  const resetLossPixels = useCallback(() => {
    lossPixelsRequestSeqRef.current += 1;
    setLossPixelsFC(null);
    setLoadingLossPixels(false);
  }, []);

  const fetchLossPixels = useCallback(async (geometry: GeoJsonObject, year: number | 'total') => {
    const requestSeq = ++lossPixelsRequestSeqRef.current;
    setLoadingLossPixels(true);
    setLossPixelsFC(null);

    try {
      let url = `${API_BASE}/map/raster/forest-loss-pixels`;
      if (year !== 'total') {
        url += `?year=20${String(year).padStart(2, '0')}`; // Because year in chart is e.g. 18 for 2018 or 5 for 2005
      }

      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ geometry }),
      });

      if (!res.ok) {
        throw new Error(`Loss pixels failed (${res.status})`);
      }

      const data = (await res.json()) as FeatureCollection;

      if (requestSeq !== lossPixelsRequestSeqRef.current) {
        return;
      }

      setLossPixelsFC(data);
    } catch (err) {
      if (requestSeq !== lossPixelsRequestSeqRef.current) {
        return;
      }
      console.error('Failed to fetch loss pixels', err);
      setLossPixelsFC(null);
    } finally {
      if (requestSeq === lossPixelsRequestSeqRef.current) {
        setLoadingLossPixels(false);
      }
    }
  }, []);

  const fetchHeightGrid = useCallback(async (geometry: GeoJsonObject) => {
    const requestSeq = ++heightGridRequestSeqRef.current;
    setHeightGridLoading(true);
    setHeightGrid(null);

    try {
      const res = await fetch(
        `${API_BASE}/map/raster/forms-height-grid?year=${EXTRUSION_GRID_YEAR}&cellSizeM=${EXTRUSION_GRID_CELL_SIZE_M}&maxCells=${EXTRUSION_GRID_MAX_CELLS}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ geometry }),
        },
      );

      if (!res.ok) {
        const text = await res.text();
        if (res.status === 404) {
          console.warn(
            '3D canopy grid endpoint is unavailable; keeping analytics without 3D grid.',
          );
          if (requestSeq === heightGridRequestSeqRef.current) {
            setHeightGrid(null);
          }
          return;
        }
        throw new Error(text || `3D grid failed (${res.status})`);
      }

      const data = (await res.json()) as HeightGridResponse;

      if (requestSeq !== heightGridRequestSeqRef.current) {
        return;
      }

      setHeightGrid(data);
    } catch (err) {
      if (requestSeq !== heightGridRequestSeqRef.current) {
        return;
      }

      console.error('3D grid failed', err);
      setHeightGrid(null);
    } finally {
      if (requestSeq === heightGridRequestSeqRef.current) {
        setHeightGridLoading(false);
      }
    }
  }, []);

  const handleDrawChange = useCallback((features?: DrawnPolygon[]) => {
    let targetFeature: DrawnPolygon | null = null;
    let currentFeatures = features;

    if (!currentFeatures && drawRef.current) {
      const selected = drawRef.current.getSelected();
      currentFeatures = selected ? (selected.features as DrawnPolygon[]) : [];
    }

    if (currentFeatures && currentFeatures.length > 1) {
      const multiCoords: number[][][][] = [];
      for (const f of currentFeatures) {
        if (f.geometry.type === 'Polygon') {
          multiCoords.push(f.geometry.coordinates);
        } else if (f.geometry.type === 'MultiPolygon') {
          multiCoords.push(...f.geometry.coordinates);
        }
      }
      targetFeature = {
        type: 'Feature',
        geometry: {
          type: 'MultiPolygon',
          coordinates: multiCoords,
        },
        properties: {},
      } as DrawnPolygon;
    } else if (currentFeatures && currentFeatures.length === 1) {
      targetFeature = currentFeatures[0];
    }

    if (!targetFeature?.geometry) {
      setDrawnPolygon(null);
      setPastedGeoJson('');
      resetHeightGrid();
      setPolygonStats(null);
      setPolygonStatsSource(null);
      setPolygonError(null);
      return;
    }

    setDrawnPolygon(targetFeature);
    setPastedGeoJson(JSON.stringify(targetFeature.geometry, null, 2));
    resetHeightGrid();
    setPolygonStats(null);
    setPolygonStatsSource(null);
    setPolygonError(null);
  }, [resetHeightGrid]);

  const handleDrawDelete = useCallback(() => {
    // Check if there are still other polygons selected after deletion
    if (drawRef.current) {
      const selected = drawRef.current.getSelected();
      if (selected && selected.features.length > 0) {
        handleDrawChange(selected.features as DrawnPolygon[]);
        return;
      }
    }

    setDrawnPolygon(null);
    setPastedGeoJson('');
    resetHeightGrid();
    setPolygonStats(null);
    setPolygonStatsSource(null);
    setShowPolygon3D(false);
    setPolygonError(null);
  }, [resetHeightGrid, handleDrawChange]);

  function handlePasteGeoJson() {
    setPasteError(null);
    if (!pastedGeoJson.trim()) {
      setPasteError('Please paste some coordinates or GeoJSON.');
      return;
    }
    try {
      const parsed = JSON.parse(pastedGeoJson);
      
      let geometry: GeoJSONPolygon | GeoJSONMultiPolygon | null = null;
      if (parsed.type === 'FeatureCollection' && parsed.features?.[0]?.geometry) {
        geometry = parsed.features[0].geometry as GeoJSONPolygon | GeoJSONMultiPolygon;
      } else if (parsed.type === 'Feature' && parsed.geometry) {
        geometry = parsed.geometry as GeoJSONPolygon | GeoJSONMultiPolygon;
      } else if (parsed.type === 'Polygon' || parsed.type === 'MultiPolygon') {
        geometry = parsed as GeoJSONPolygon | GeoJSONMultiPolygon;
      } else if (Array.isArray(parsed) && Array.isArray(parsed[0])) {
        // Handle raw coordinates array
        if (typeof parsed[0][0] === 'number') {
          geometry = { type: 'Polygon', coordinates: [parsed] } as GeoJSONPolygon;
        } else if (Array.isArray(parsed[0][0]) && typeof parsed[0][0][0] === 'number') {
          geometry = { type: 'Polygon', coordinates: parsed } as GeoJSONPolygon;
        } else if (Array.isArray(parsed[0][0][0]) && typeof parsed[0][0][0][0] === 'number') {
          geometry = { type: 'MultiPolygon', coordinates: parsed } as GeoJSONMultiPolygon;
        }
      }

      if (!geometry || (geometry.type !== 'Polygon' && geometry.type !== 'MultiPolygon')) {
        throw new Error('Invalid GeoJSON or coordinates. Must resolve to a Polygon or MultiPolygon.');
      }

      // Validate/fix linear rings
      const ensureClosed = (ring: number[][]) => {
        if (ring.length > 0) {
          const first = ring[0];
          const last = ring[ring.length - 1];
          if (first[0] !== last[0] || first[1] !== last[1]) {
            ring.push([...first]);
          }
        }
      };

      if (geometry.type === 'Polygon') {
        geometry.coordinates.forEach(ensureClosed);
      } else if (geometry.type === 'MultiPolygon') {
        geometry.coordinates.forEach((poly: number[][][]) => poly.forEach(ensureClosed));
      }

      const feature: DrawnPolygon = {
        type: 'Feature',
        geometry,
        properties: {}
      };

      if (drawRef.current && mapRef.current) {
        drawRef.current.deleteAll();
        const featureIds = drawRef.current.add(feature);
        if (featureIds && featureIds.length > 0) {
          handleDrawChange([feature]);
          // We don't hide the input or clear the JSON anymore, so it acts as an editor
          const bbox = getBboxFromFeatureCollection({ type: 'FeatureCollection', features: [feature] });
          if (bbox) {
            mapRef.current.fitBounds([[bbox[0], bbox[1]], [bbox[2], bbox[3]]], { padding: 40, maxZoom: 14 });
          }
        }
      }

    } catch (e: unknown) {
      setPasteError(e instanceof Error ? e.message : 'Invalid JSON format. Please paste valid coordinates or GeoJSON.');
    }
  }

  function toggleDrawPolygon() {
    if (!drawRef.current || !mapReady) return;
    if (isDrawModeActive) {
      drawRef.current.changeMode('simple_select');
      setIsDrawModeActive(false);
    } else {
      drawRef.current.changeMode('draw_polygon');
      setIsDrawModeActive(true);
    }
  }

  function tiltMapFor3D() {
    const map = mapRef.current;
    if (!map) return;
    map.easeTo({ pitch: 55, bearing: -20, duration: 700 });
  }

  function resetMapCamera() {
    const map = mapRef.current;
    if (!map) return;
    map.easeTo({ pitch: 0, bearing: 0, duration: 700 });
  }

  async function analyzeGeometry(geometry: GeoJsonObject) {
    if (!geometry) return;
    setPolygonLoading(true);
    setPolygonStatsSource(null);
    setPolygonError(null);
    resetHeightGrid();
    try {
      const res = await fetch(`${API_BASE}/map/polygon-stats`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ geometry }),
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || `Analysis failed (${res.status})`);
      }
      const data = (await res.json()) as PolygonStats;
      setPolygonStats(data);
      setPolygonStatsSource('polygon');
      await fetchHeightGrid(geometry);
    } catch (err: unknown) {
      console.error('Analysis failed', err);
      setPolygonError(err instanceof Error ? err.message : 'Failed to analyze area');
    } finally {
      setPolygonLoading(false);
    }
  }

  async function analyzeAdmin(level: string, id: string) {
    if (!level || !id) return;
    setPolygonLoading(true);
    setPolygonStatsSource(null);
    setPolygonError(null);
    setShowPolygon3D(false);
    resetHeightGrid();
    try {
      const res = await fetch(`${API_BASE}/map/admin-stats?level=${encodeURIComponent(level)}&id=${encodeURIComponent(id)}`, {
        method: 'GET',
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || `Analysis failed (${res.status})`);
      }
      const data = (await res.json()) as PolygonStats;
      setPolygonStats(data);
      setPolygonStatsSource('admin');
      if (data.geometry) {
        await fetchHeightGrid(data.geometry);
      }
    } catch (err: unknown) {
      console.error('Analysis failed', err);
      setPolygonError(err instanceof Error ? err.message : 'Failed to analyze area');
    } finally {
      setPolygonLoading(false);
    }
  }

  function analyzeDrawnPolygon() {
    if (drawnPolygon) {
      analyzeGeometry(drawnPolygon.geometry);
    }
  }

  // Figure out the lowest selected level for the admin analysis button
  let activeAdminLabel = '';
  let activeAdminLevel = '';
  let activeAdminId = '';

  if (selectedLieuDit) {
    const name = lieuxDits.find(ld => String(ld.id) === selectedLieuDit)?.name || 'Lieu-dit';
    activeAdminLabel = `${name} Lieu-dit`;
    activeAdminLevel = 'lieu-dit';
    activeAdminId = selectedLieuDit;
  } else if (selectedCommune) {
    const c = communes.find(c => c.id === selectedCommune);
    const name = c?.name || 'Commune';
    activeAdminLabel = `${name} Commune`;
    activeAdminLevel = 'commune';
    activeAdminId = selectedCommune;
  } else if (selectedDepartment) {
    const d = departments.find(d => d.codeInsee === selectedDepartment);
    const name = d?.nomOfficiel || 'Department';
    activeAdminLabel = `${name} Department`;
    activeAdminLevel = 'department';
    activeAdminId = selectedDepartment;
  } else if (selectedRegion) {
    const r = regions.find(r => r.codeInsee === selectedRegion);
    const name = r?.nomOfficiel || 'Region';
    activeAdminLabel = `${name} Region`;
    activeAdminLevel = 'region';
    activeAdminId = selectedRegion;
  }

  function analyzeAdminBoundary() {
    if (activeAdminLevel && activeAdminId) {
      analyzeAdmin(activeAdminLevel, activeAdminId);
    }
  }



  function clearDrawnPolygon() {
    handleDrawDelete();
    if (drawRef.current) {
      drawRef.current.deleteAll();
    }
    setPolygonStatsSource(null);
    setShowPolygon3D(false);
  }

  // --- Sync Refs with State for saveMapState ---
  useEffect(() => {
    selectedRegionRef.current = selectedRegion || '';
  }, [selectedRegion]);

  useEffect(() => {
    selectedDepartmentRef.current = selectedDepartment || '';
  }, [selectedDepartment]);

  useEffect(() => {
    selectedCommuneRef.current = selectedCommune || '';
  }, [selectedCommune]);

  useEffect(() => {
    selectedLieuDitRef.current = selectedLieuDit || '';
  }, [selectedLieuDit, lieuDitSelectionTick]);

  useEffect(() => {
    basemapModeRef.current = basemapMode;
  }, [basemapMode]);

  useEffect(() => {
    activeForestClassCodesRef.current = activeForestClassCodes;
  }, [activeForestClassCodes]);

  // --- Save map state for logged-in user ---
  async function saveMapState() {
    if (!mapRef.current) return;

    const map = mapRef.current;
    const center = map.getCenter();
    const zoom = map.getZoom();

    const payload: MapState = {
      center: { lon: center.lng, lat: center.lat },
      zoom,
      selectedRegion: selectedRegionRef.current || null,
      selectedDepartment: selectedDepartmentRef.current || null,
      selectedCommune: selectedCommuneRef.current || null,
      selectedLieuDit: selectedLieuDitRef.current || null,
      basemapMode: basemapModeRef.current,
      activeForestClassCodes: activeForestClassCodesRef.current,
    };

    try {
      const res = await fetch(`${API_BASE}/auth/me/map-state`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include', // important: send auth_token cookie
        body: JSON.stringify(payload),
      });

      if (res.status === 401 || res.status === 403) {
        // Not logged in – ignore silently (public use)
        return;
      }

      if (!res.ok) {
        console.error('Failed to save map state', await res.text());
      }
    } catch (err) {
      console.error('Failed to save map state', err);
    }
  }

  // --- Load map state for logged-in user on first mapReady ---
  useEffect(() => {
    if (!mapReady) return;
    if (mapStateLoadedOnce) return;

    (async () => {
      try {
        const res = await fetch(`${API_BASE}/auth/me/map-state`, {
          method: 'GET',
          credentials: 'include',
        });

        if (!res.ok) {
          // Not logged in or other error → just skip
          setMapStateLoadedOnce(true);
          return;
        }

        const data = (await res.json()) as MapState | null;
        if (!data) {
          setMapStateLoadedOnce(true);
          return;
        }

        setLoadedMapState(data);

        // Apply saved filters to React state
        if (data.selectedRegion) {
          skipRegionFitRef.current = true;
          selectRegion(data.selectedRegion, { userInitiated: false });
        }
        if (data.selectedDepartment) {
          skipDepartmentFitRef.current = true;
          selectDepartment(data.selectedDepartment, { userInitiated: false });
        }
        if (data.selectedCommune) {
          skipCommuneFlyRef.current = true;
          selectCommune(data.selectedCommune, { userInitiated: false });
        }
        if (data.selectedLieuDit) {
          skipLieuDitFitRef.current = true;
          selectLieuDit(data.selectedLieuDit, { userInitiated: false });
        }
        if (data.basemapMode) setBasemapMode(data.basemapMode);
        if (data.activeForestClassCodes && data.activeForestClassCodes.length) {
          setActiveForestClassCodes(data.activeForestClassCodes);
        }

        // Apply center & zoom
        if (mapRef.current && data.center && typeof data.zoom === 'number') {
          mapRef.current.jumpTo({
            center: [data.center.lon, data.center.lat],
            zoom: data.zoom,
          });
        }
      } catch (err) {
        console.error('Failed to load user map state', err);
      } finally {
        setMapStateLoadedOnce(true);
      }
    })();
  }, [mapReady, mapStateLoadedOnce]);

  // --- Load region list ---
  useEffect(() => {
    fetchJson<Region[]>(`${API_BASE}/admin/regions`)
      .then((data) => {
        setRegions(data);
      })
      .catch((err) => {
        console.error('Failed to load regions', err);
      });
  }, []);

  // --- Load forest classes (TFV_G11) ---
  useEffect(() => {
    fetchJson<ForestClass[]>(`${API_BASE}/map/forest-classes`)
      .then((data) => {
        if (!Array.isArray(data) || data.length === 0) {
          setForestClassesError('No forest classes returned from API');
          return;
        }
        setForestClasses(data);
        setForestClassesError(null);
        // by default, all classes are active
        setActiveForestClassCodes(data.map((c) => c.code));
      })
      .catch((err) => {
        console.error('Failed to load forest classes', err);
        setForestClassesError(err?.message || 'Failed to load forest classes');
      });
  }, []);

  // --- Load LiDAR coverage ---
  useEffect(() => {
    fetchJson<FeatureCollection>(`${API_BASE}/map/raster/lidar-coverage`)
      .then((data) => {
        setLidarCoverage(data);
      })
      .catch((err) => {
        console.error('Failed to load LiDAR coverage', err);
      });
  }, []);

  // --- Load department list for sidebar when region changes ---
  useEffect(() => {
    if (!selectedRegion) {
      // Region cleared -> full reset
      setDepartments([]);
      selectDepartment('', { userInitiated: false });
      setCommunes([]);
      selectCommune('', { userInitiated: false });
      setLieuxDits([]);
      selectLieuDit('', { userInitiated: false });
      setDepartmentsLayer(null);
      return;
    }

    fetchJson<Department[]>(
      `${API_BASE}/admin/departments?regionCode=${encodeURIComponent(
        selectedRegion,
      )}`,
    )
      .then((data) => {
        setDepartments(data);

        // Only clear if the currently selected department is NOT in the new list
        // This prevents search auto-zoom from being overwritten
        const isValid = data.some(d => d.codeInsee === selectedDepartmentRef.current);
        if (!isValid) {
          selectDepartment('', { userInitiated: false });
          setCommunes([]);
          selectCommune('', { userInitiated: false });
          setLieuxDits([]);
          selectLieuDit('', { userInitiated: false });
        }
      })
      .catch((err) => {
        console.error('Failed to load departments', err);
      });
  }, [selectedRegion]); // removed loadedMapState as it causes unnecessary resets

  // --- Load communes list when department changes ---
  useEffect(() => {
    if (!selectedDepartment) {
      // Department cleared -> reset below
      setCommunes([]);
      selectCommune('', { userInitiated: false });
      setLieuxDits([]);
      selectLieuDit('', { userInitiated: false });
      return;
    }

    fetchJson<Commune[]>(
      `${API_BASE}/admin/communes?departmentCode=${encodeURIComponent(
        selectedDepartment,
      )}`,
    )
      .then((data) => {
        setCommunes(data);

        const isValid = data.some(c => c.id === selectedCommuneRef.current);
        if (!isValid) {
          selectCommune('', { userInitiated: false });
          setLieuxDits([]);
          selectLieuDit('', { userInitiated: false });
        }
      })
      .catch((err) => {
        console.error('Failed to load communes', err);
      });
  }, [selectedDepartment]);

  // --- Load lieux-dits list when commune changes ---
  useEffect(() => {
    if (!selectedCommune) {
      setLieuxDits([]);
      selectLieuDit('', { userInitiated: false });
      return;
    }

    fetchJson<LieuDit[]>(
      `${API_BASE}/admin/lieux-dits?communeId=${encodeURIComponent(
        selectedCommune,
      )}`,
    )
      .then((data) => {
        setLieuxDits(data);

        const isValid = data.some(ld => String(ld.id) === selectedLieuDitRef.current);
        if (!isValid) {
          selectLieuDit('', { userInitiated: false });
        }
      })
      .catch((err) => {
        console.error('Failed to load lieux-dits', err);
      });
  }, [selectedCommune]);

  // --- Initialize map ---
  useEffect(() => {
    if (!mapContainerRef.current) return;
    if (mapRef.current) return;

    if (!mapboxgl.supported()) {
      setWebglError(true);
      return;
    }

    const map = new mapboxgl.Map({
      container: mapContainerRef.current,
      style: 'mapbox://styles/mapbox/light-v11',
      center: [7.4, 47.8],
      zoom: 8,
      antialias: true,
      projection: 'mercator',
    });

    map.addControl(new mapboxgl.NavigationControl({ visualizePitch: true }), 'bottom-right');

    mapRef.current = map;

    const enforceMercatorProjection = () => {
      try {
        map.setProjection('mercator');
      } catch {
        // Ignore transient style lifecycle errors during initialization.
      }
    };

    enforceMercatorProjection();
    map.on('style.load', enforceMercatorProjection);

    const fetchForestsForCurrentView = async (m: Map) => {
      // Vector tiles handle loading automatically now.
    };

    const fetchParcelsForCurrentView = async (m: Map) => {
      if (!m || typeof m.isStyleLoaded !== 'function' || !m.isStyleLoaded()) {
        return;
      }

      const source = m.getSource('parcels') as
        | mapboxgl.GeoJSONSource
        | undefined;
      if (!source) return;

      const zoom = m.getZoom();
      if (zoom < 15) {
        source.setData(EMPTY_FC);
        return;
      }

      const bounds = m.getBounds();
      if (!bounds) return;
      const bbox = [
        bounds.getWest(),
        bounds.getSouth(),
        bounds.getEast(),
        bounds.getNorth(),
      ];
      const bboxParam = bbox.join(',');

      // Cancel any previous in-flight request
      parcelsAbortRef.current?.abort();
      parcelsAbortRef.current = new AbortController();
      const signal = parcelsAbortRef.current.signal;

      try {
        const res = await fetch(
          `${API_BASE}/map/parcels?bbox=${bboxParam}&limit=4000`,
          { signal },
        );
        if (!res.ok) {
          throw new Error(`Parcels API error ${res.status}`);
        }
        const data = (await res.json()) as FeatureCollection;
        source.setData(data);
      } catch (err: unknown) {
        if (err instanceof Error && err.name === 'AbortError') return;
        console.error('Failed to load parcels', err);
      }
    };

    map.on('load', () => {
      // Satellite base
      map.addSource('satellite', {
        type: 'raster',
        url: 'mapbox://mapbox.satellite',
        tileSize: 256,
      });

      map.addLayer({
        id: 'satellite-base',
        type: 'raster',
        source: 'satellite',
        layout: {
          visibility: 'none',
        },
      });

      // Forests source + layers
      map.addSource('forests', {
        type: 'vector',
        tiles: [`${API_BASE}/map/tiles/forests/{z}/{x}/{y}`],
      });

      map.addLayer({
        id: 'forests-fill',
        type: 'fill',
        source: 'forests',
        'source-layer': 'forests',
        paint: {
          'fill-color': '#2e7d32',
          'fill-opacity': 0.4,
          'fill-opacity-transition': { duration: 400, delay: 0 },
        },
      });

      map.addLayer({
        id: 'forests-outline',
        type: 'line',
        source: 'forests',
        'source-layer': 'forests',
        paint: {
          'line-color': '#1b5e20',
          'line-width': 1,
          'line-opacity': 1,
          'line-opacity-transition': { duration: 400, delay: 0 },
        },
      });

      // Parcels source + outline layer
      map.addSource('parcels', {
        type: 'geojson',
        data: EMPTY_FC,
      });

      map.addLayer({
        id: 'parcels-outline',
        type: 'line',
        source: 'parcels',
        paint: {
          'line-color': '#9ca3af',
          'line-width': 0.5,
          'line-opacity': 1,
          'line-opacity-transition': { duration: 300, delay: 0 },
        },
      });

      // Admin sources
      map.addSource('regions', {
        type: 'vector',
        tiles: [`${API_BASE}/map/tiles/regions/{z}/{x}/{y}`],
      });
      map.addSource('departments', {
        type: 'vector',
        tiles: [`${API_BASE}/map/tiles/departments/{z}/{x}/{y}`],
      });
      map.addSource('communes', {
        type: 'vector',
        tiles: [`${API_BASE}/map/tiles/communes/{z}/{x}/{y}`],
      });
      map.addSource('lieuxDitsAll', {
        type: 'geojson',
        data: EMPTY_FC,
      });

      // Regions
      map.addLayer({
        id: 'regions-fill',
        type: 'fill',
        source: 'regions',
        'source-layer': 'regions',
        paint: {
          'fill-color': '#e5e7eb',
          'fill-opacity': 0.25,
        },
      });
      map.addLayer({
        id: 'regions-outline',
        type: 'line',
        source: 'regions',
        'source-layer': 'regions',
        paint: {
          'line-color': '#1f2937',
          'line-width': 2,
        },
      });

      // Department forest coverage choropleth (zoom < 9)
      map.addSource('deptCoverage', {
        type: 'geojson',
        data: EMPTY_FC,
      });

      map.addLayer({
        id: 'coverage-fill',
        type: 'fill',
        source: 'deptCoverage',
        maxzoom: 9,
        paint: {
          'fill-color': [
            'interpolate', ['linear'],
            ['get', 'forestPct'],
            0,  '#f0fdf4',
            5,  '#bbf7d0',
            15, '#4ade80',
            30, '#16a34a',
            50, '#14532d',
          ],
          'fill-opacity': 0.72,
        },
      });

      map.addLayer({
        id: 'coverage-outline',
        type: 'line',
        source: 'deptCoverage',
        maxzoom: 9,
        paint: {
          'line-color': '#6b7280',
          'line-width': 0.8,
          'line-dasharray': [4, 3],
        },
      });

      // Departments outline + hit layer
      map.addLayer({
        id: 'departments-outline',
        type: 'line',
        source: 'departments',
        'source-layer': 'departments',
        layout: { visibility: 'none' },
        paint: {
          'line-color': '#6b7280',
          'line-width': 1,
        },
      });

      map.addLayer({
        id: 'departments-hit',
        type: 'fill',
        source: 'departments',
        'source-layer': 'departments',
        layout: { visibility: 'none' },
        paint: {
          'fill-opacity': 0,
        },
      });

      // Communes outline + hit
      map.addLayer({
        id: 'communes-outline',
        type: 'line',
        source: 'communes',
        'source-layer': 'communes',
        layout: { visibility: 'none' },
        paint: {
          'line-color': '#4b5563',
          'line-width': 1,
        },
      });

      map.addLayer({
        id: 'communes-hit',
        type: 'fill',
        source: 'communes',
        'source-layer': 'communes',
        layout: { visibility: 'none' },
        paint: {
          'fill-opacity': 0,
        },
      });

      // All lieux-dits
      map.addLayer({
        id: 'lieuxDitsAll-outline',
        type: 'line',
        source: 'lieuxDitsAll',
        paint: {
          'line-color': '#f97316',
          'line-width': 1,
          'line-dasharray': [2, 2],
        },
      });

      map.addLayer({
        id: 'lieuxDitsAll-hit',
        type: 'fill',
        source: 'lieuxDitsAll',
        paint: {
          'fill-opacity': 0,
        },
      });

      // Loss Pixels Layer
      map.addSource('lossPixels', {
        type: 'geojson',
        data: EMPTY_FC,
      });

      map.addLayer({
        id: 'lossPixels-heatmap',
        type: 'heatmap',
        source: 'lossPixels',
        maxzoom: 18,
        paint: {
          'heatmap-weight': 1,
          'heatmap-intensity': [
            'interpolate',
            ['linear'],
            ['zoom'],
            10, 0.5,
            15, 1.5,
          ],
          'heatmap-color': [
            'interpolate',
            ['linear'],
            ['heatmap-density'],
            0, 'rgba(239, 68, 68, 0)',
            0.2, 'rgba(239, 68, 68, 0.3)',
            0.5, 'rgba(239, 68, 68, 0.6)',
            1, 'rgba(239, 68, 68, 0.9)'
          ],
          'heatmap-radius': [
            'interpolate',
            ['linear'],
            ['zoom'],
            10, 5,
            15, 15,
          ],
          'heatmap-opacity': 0.8,
        },
      });

      // Selected lieu-dit highlight
      map.addSource('lieuDit', {
        type: 'geojson',
        data: EMPTY_FC,
      });

      map.addLayer({
        id: 'lieuDit-outline',
        type: 'line',
        source: 'lieuDit',
        paint: {
          'line-color': '#ff6f00',
          'line-width': 2,
        },
      });

      // LiDAR Coverage source + layer
      map.addSource('lidarCoverage', {
        type: 'geojson',
        data: EMPTY_FC,
      });

      map.addLayer({
        id: 'lidar-coverage-fill',
        type: 'fill',
        source: 'lidarCoverage',
        layout: {
          visibility: 'none',
        },
        paint: {
          'fill-color': '#3b82f6',
          'fill-opacity': 0.3,
        },
      });

      map.addLayer({
        id: 'lidar-coverage-outline',
        type: 'line',
        source: 'lidarCoverage',
        layout: {
          visibility: 'none',
        },
        paint: {
          'line-color': '#2563eb',
          'line-width': 1,
          'line-dasharray': [2, 2],
        },
      });

      // First load of forests/parcels
      fetchForestsForCurrentView(map);
      fetchParcelsForCurrentView(map);

      // Regions layer from backend is now served via Vector Tiles (MVT).
      // We don't fetch the whole GeoJSON anymore.

      // Department coverage choropleth layer
      fetchJson<FeatureCollection>(`${API_BASE}/map/departments-coverage`, {
        // Allow browser/proxy caching for this static-ish choropleth payload.
        cache: 'default',
      })
        .then((fc) => {
          const src = map.getSource('deptCoverage') as mapboxgl.GeoJSONSource;
          if (src) src.setData(fc);
        })
        .catch((err) => {
          console.error('Failed to load coverage layer', err);
        });

      // Single click handler with explicit priority: most-specific level wins.
      // This prevents a click on a department (or commune/lieu-dit) from also
      // triggering the parent-level handler (region polygon underneath, etc.).
      map.on('click', (e) => {
        // Do not select admin boundaries if we are actively drawing a polygon,
        // or if we *just* finished drawing one (to catch the final double-click/closing click)
        if (drawRef.current && drawRef.current.getMode() === 'draw_polygon') {
          return;
        }
        if (justFinishedDrawingRef.current) {
          return;
        }

        // Ignore clicks if they fall on a Mapbox Draw feature (e.g., finishing a polygon or clicking an existing one)
        const features = map.queryRenderedFeatures(e.point);
        const clickedOnDraw = features.some(f => f.layer?.id?.includes('gl-draw'));
        if (clickedOnDraw) {
          return;
        }

        // Lieu-dit — highest priority
        const ldFeature = map.queryRenderedFeatures(e.point, { layers: ['lieuxDitsAll-hit'] })[0];
        if (ldFeature) {
          const id = (ldFeature.properties as Record<string, unknown>)?.id as number | undefined;
          if (id != null) { selectLieuDit(String(id)); return; }
        }

        // Commune
        const communeFeature = map.queryRenderedFeatures(e.point, { layers: ['communes-hit'] })[0];
        if (communeFeature) {
          const id = (communeFeature.properties as Record<string, unknown>)?.codeInsee as string | undefined;
          if (id) { selectCommune(id); return; }
        }

        // Department
        const deptFeature = map.queryRenderedFeatures(e.point, { layers: ['departments-hit'] })[0];
        if (deptFeature) {
          const code = (deptFeature.properties as Record<string, unknown>)?.codeInsee as string | undefined;
          if (code) { selectDepartment(code); return; }
        }

        // Region — lowest priority
        const regionFeature = map.queryRenderedFeatures(e.point, { layers: ['regions-fill'] })[0];
        if (regionFeature) {
          const code = (regionFeature.properties as Record<string, unknown>)?.codeInsee as string | undefined;
          if (code) { selectRegion(code); return; }
        }
      });

      setMapReady(true);
    });

    // Track zoom level for UI display.
    const syncCameraState = () => {
      setCurrentZoom(map.getZoom());
    };

    syncCameraState();
    map.on('zoom', syncCameraState);

    // On moveend: debounced reload + save map state
    let moveTimer: ReturnType<typeof setTimeout> | null = null;
    map.on('moveend', () => {
      if (moveTimer) clearTimeout(moveTimer);
      moveTimer = setTimeout(() => {
        fetchForestsForCurrentView(map);
        fetchParcelsForCurrentView(map);
        saveMapState();
      }, 250);
    });

    return () => {
      if (moveTimer) clearTimeout(moveTimer);
      map.off('style.load', enforceMercatorProjection);
      map.off('zoom', syncCameraState);
      map.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!mapReady) return;
    const map = mapRef.current;
    if (!map) return;

    try {
      map.setProjection('mercator');
    } catch {
      // Projection may be temporarily unavailable while style data is loading.
    }
  }, [mapReady, basemapMode]);

  useEffect(() => {
    if (!mapReady) return;
    const map = mapRef.current;
    if (!map) return;
    if (drawRef.current) return;

    const draw = new MapboxDraw({
      displayControlsDefault: false,
      controls: {
        polygon: true,
        trash: true,
      },
    });

    drawRef.current = draw;
    map.addControl(draw, 'top-left');

    const createHandler = (e: MapboxDraw.DrawCreateEvent) => {
      handleDrawChange(e.features as DrawnPolygon[]);
    };
    const updateHandler = (e: MapboxDraw.DrawUpdateEvent) => {
      handleDrawChange(e.features as DrawnPolygon[]);
    };
    const selectionChangeHandler = (e: MapboxDraw.DrawSelectionChangeEvent) => {
      if (e.features && e.features.length > 0) {
        handleDrawChange(e.features as DrawnPolygon[]);
      } else {
        handleDrawChange([]);
      }
    };
    const deleteHandler = () => {
      handleDrawDelete();
    };
    const modeChangeHandler = (e: { mode: string }) => {
      const isDrawing = e.mode === 'draw_polygon';
      setIsDrawModeActive(isDrawing);
      
      if (!isDrawing) {
        // Set a brief cooldown to prevent the final click from bleeding through
        justFinishedDrawingRef.current = true;
        setTimeout(() => {
          justFinishedDrawingRef.current = false;
        }, 300);
      }
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    map.on('draw.create' as any, createHandler as any);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    map.on('draw.update' as any, updateHandler as any);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    map.on('draw.selectionchange' as any, selectionChangeHandler as any);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    map.on('draw.delete' as any, deleteHandler as any);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    map.on('draw.modechange' as any, modeChangeHandler as any);

    return () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      map.off('draw.create' as any, createHandler as any);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      map.off('draw.update' as any, updateHandler as any);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      map.off('draw.selectionchange' as any, selectionChangeHandler as any);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      map.off('draw.delete' as any, deleteHandler as any);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      map.off('draw.modechange' as any, modeChangeHandler as any);
      if (drawRef.current) {
        map.removeControl(drawRef.current);
        drawRef.current = null;
      }
    };
  }, [mapReady, handleDrawChange, handleDrawDelete]);

  // Keep a deck.gl overlay attached to the Mapbox instance for per-cell 3D canopy extrusion.
  useEffect(() => {
    if (!mapReady) return;
    const map = mapRef.current;
    if (!map || deckOverlayRef.current) return;

    const overlay = new MapboxOverlay({
      // Keep deck and map in the same render pass for stable pitch/rotation sync.
      interleaved: true,
      layers: [],
    });

    deckOverlayRef.current = overlay;
    map.addControl(overlay);

    return () => {
      if (!deckOverlayRef.current) return;
      try {
        map.removeControl(deckOverlayRef.current);
      } catch {
        // Map may already be disposed during teardown.
      }
      deckOverlayRef.current = null;
    };
  }, [mapReady]);

  useEffect(() => {
    const overlay = deckOverlayRef.current;
    if (!overlay) return;

    if (!showPolygon3D || !canRenderPolygon3D) {
      overlay.setProps({ layers: [] });
      return;
    }

    const extrusionFeatureCollection: FeatureCollection = {
      type: 'FeatureCollection',
      features: deckExtrusionData,
    };

    overlay.setProps({
      layers: [
        new GeoJsonLayer({
          id: 'drawn-polygon-3d-grid',
          data: extrusionFeatureCollection,
          extruded: true,
          filled: true,
          stroked: true,
          wireframe: true,
          // @ts-expect-error DeckGL typing mismatch for accessors
          getElevation: (feature: DeckExtrusionDatum) => feature.properties?.elevationM ?? 0,
          material: {
            ambient: 0.28,
            diffuse: 0.72,
            shininess: 18,
            specularColor: [210, 210, 210],
          },
          // @ts-expect-error DeckGL typing mismatch for accessors
          getFillColor: (feature: DeckExtrusionDatum) => {
            const meanHeightM = Number(feature.properties?.meanHeightM ?? 0);
            const normalized = Math.max(0, Math.min(1, meanHeightM / 40));

            return [
              Math.round(30 + 60 * normalized),
              Math.round(105 + 90 * normalized),
              Math.round(35 + 20 * (1 - normalized)),
              190,
            ];
          },
          getLineColor: [248, 250, 252, 220],
          lineWidthMinPixels: 1,
          pickable: true,
          autoHighlight: true,
        }),
      ],
    });
  }, [showPolygon3D, canRenderPolygon3D, deckExtrusionData]);

  // Color forests by TFV_G11
  useEffect(() => {
    const map = mapRef.current;
    if (!mapReady || !map) return;
    if (!map.getLayer('forests-fill')) return;
    if (!forestClasses.length) return;

    const matchExpression: mapboxgl.Expression = ['match', ['get', 'tfvG11']];

    forestClasses.forEach((cls, idx) => {
      matchExpression.push(cls.code);
      matchExpression.push(
        FOREST_CLASS_COLORS[idx % FOREST_CLASS_COLORS.length],
      );
    });

    matchExpression.push('#9ca3af'); // default color

    map.setPaintProperty('forests-fill', 'fill-color', matchExpression);
  }, [forestClasses, mapReady]);

  // Filter forests by active TFV_G11 classes
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (!map.getLayer('forests-fill')) return;

    const layers = ['forests-fill', 'forests-outline'];

    if (!activeForestClassCodes.length) {
      layers.forEach((id) => {
        if (map.getLayer(id)) {
          map.setFilter(id, ['==', ['get', 'tfvG11'], 'NONE']);
        }
      });
      return;
    }

    const filter: mapboxgl.Expression = [
      'in',
      ['get', 'tfvG11'],
      ['literal', activeForestClassCodes],
    ];

    layers.forEach((id) => {
      if (map.getLayer(id)) {
        map.setFilter(id, filter);
      }
    });
  }, [activeForestClassCodes]);

  // Hide coverage-outline when a region is selected (departments-outline takes over)
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    if (!map.getLayer('coverage-outline')) return;
    map.setLayoutProperty(
      'coverage-outline',
      'visibility',
      selectedRegion ? 'none' : 'visible',
    );
  }, [selectedRegion, mapReady]);

  // Toggle satellite raster visibility when basemapMode changes
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const layerId = 'satellite-base';
    if (!map.getLayer(layerId)) return;

    map.setLayoutProperty(
      layerId,
      'visibility',
      basemapMode === 'satellite' ? 'visible' : 'none',
    );
  }, [basemapMode]);

  // Sync LiDAR coverage layer visibility
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;

    const fillLayer = 'lidar-coverage-fill';
    const outlineLayer = 'lidar-coverage-outline';

    if (map.getLayer(fillLayer)) {
      map.setLayoutProperty(fillLayer, 'visibility', showLidarCoverage ? 'visible' : 'none');
    }
    if (map.getLayer(outlineLayer)) {
      map.setLayoutProperty(outlineLayer, 'visibility', showLidarCoverage ? 'visible' : 'none');
    }

    if (showLidarCoverage && lidarCoverage) {
      const src = map.getSource('lidarCoverage') as mapboxgl.GeoJSONSource;
      if (src) src.setData(lidarCoverage);
    }
  }, [showLidarCoverage, lidarCoverage, mapReady]);

  // Sync Loss Pixels
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;

    const src = map.getSource('lossPixels') as mapboxgl.GeoJSONSource;
    if (src) {
      src.setData((lossPixelsFC || EMPTY_FC) as GeoJSON.FeatureCollection);
    }
  }, [lossPixelsFC, mapReady]);

  // Trigger Loss Pixels Fetch on Hover
  useEffect(() => {
    if (!polygonStatsSource || !polygonStats) {
      resetLossPixels();
      return;
    }

    // Determine the geometry to query
    let geometryToQuery = null;
    if (polygonStatsSource === 'polygon' && drawnPolygon) {
      geometryToQuery = drawnPolygon.geometry;
    } else if (polygonStatsSource === 'admin' && polygonStats?.geometry) {
      geometryToQuery = polygonStats.geometry;
    }

    if (!geometryToQuery) {
      resetLossPixels();
      return;
    }
    if (hoveredLossYear !== null) {
      fetchLossPixels(geometryToQuery, hoveredLossYear);
    } else {
      resetLossPixels();
    }
  }, [hoveredLossYear, drawnPolygon, polygonStats, polygonStatsSource, fetchLossPixels, resetLossPixels]);

  // Save state when filters / basemap / classes change (when mapReady)
  useEffect(() => {
    if (!mapReady) return;
    // fire & forget; backend ignores if not logged in
    saveMapState();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    selectedRegion,
    selectedDepartment,
    selectedCommune,
    selectedLieuDit,
    basemapMode,
    activeForestClassCodes,
    mapReady,
  ]);

  // When commune changes, load all lieux-dits and fly to commune center
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    if (selectedDepartment) {
      if (selectedCommune) {
        if (skipCommuneFlyRef.current) {
          skipCommuneFlyRef.current = false;
        } else {
          fetchJson<number[]>(`${API_BASE}/map/admin-bbox?level=commune&id=${encodeURIComponent(selectedCommune)}`)
            .then((bbox) => {
              if (bbox && bbox.length === 4) {
                map.fitBounds([[bbox[0], bbox[1]], [bbox[2], bbox[3]]], { padding: 40, maxZoom: 14 });
              }
            })
            .catch((err) => console.error('Failed to load commune bbox', err));
        }
      }
    }

    if (!selectedCommune) {
      const ldSrc = map.getSource('lieuxDitsAll') as mapboxgl.GeoJSONSource;
      if (ldSrc) ldSrc.setData(EMPTY_FC);
      const selectedLdSrc = map.getSource('lieuDit') as mapboxgl.GeoJSONSource;
      if (selectedLdSrc) selectedLdSrc.setData(EMPTY_FC);
      return;
    }

    fetchJson<FeatureCollection>(
      `${API_BASE}/map/lieux-dits-layer?communeId=${encodeURIComponent(
        selectedCommune,
      )}`,
    )
      .then((fc) => {
        const src = map.getSource('lieuxDitsAll') as mapboxgl.GeoJSONSource;
        if (src) src.setData(fc);
      })
      .catch((err) => {
        console.error('Failed to load lieux-dits layer', err);
      });
  }, [selectedDepartment, selectedCommune, communeSelectionTick]);

  // When region changes, filter departments and fit to region
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;

    if (selectedRegion) {
      if (map.getLayer('departments-outline')) {
        map.setFilter('departments-outline', ['==', ['get', 'parentId'], selectedRegion]);
        map.setFilter('departments-hit', ['==', ['get', 'parentId'], selectedRegion]);
        map.setLayoutProperty('departments-outline', 'visibility', 'visible');
        map.setLayoutProperty('departments-hit', 'visibility', 'visible');
      }

      if (skipRegionFitRef.current) {
        skipRegionFitRef.current = false;
      } else {
        fetchJson<number[]>(`${API_BASE}/map/admin-bbox?level=region&id=${encodeURIComponent(selectedRegion)}`)
          .then((bbox) => {
            if (bbox && bbox.length === 4) {
              map.fitBounds([[bbox[0], bbox[1]], [bbox[2], bbox[3]]], { padding: 40, maxZoom: 10 });
            }
          })
          .catch((err) => {
            console.error('Failed to load region bbox', err);
          });
      }
    } else {
      if (map.getLayer('departments-outline')) {
        map.setLayoutProperty('departments-outline', 'visibility', 'none');
        map.setLayoutProperty('departments-hit', 'visibility', 'none');
      }
    }
  }, [selectedRegion, regionSelectionTick, mapReady]);

  // When department changes, filter communes and fit to its bounds
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;

    if (selectedDepartment) {
      if (map.getLayer('communes-outline')) {
        map.setFilter('communes-outline', ['==', ['slice', ['get', 'codeInsee'], 0, selectedDepartment.length], selectedDepartment]);
        map.setFilter('communes-hit', ['==', ['slice', ['get', 'codeInsee'], 0, selectedDepartment.length], selectedDepartment]);
        map.setLayoutProperty('communes-outline', 'visibility', 'visible');
        map.setLayoutProperty('communes-hit', 'visibility', 'visible');
      }

      if (skipDepartmentFitRef.current) {
        skipDepartmentFitRef.current = false;
      } else {
        fetchJson<number[]>(`${API_BASE}/map/admin-bbox?level=department&id=${encodeURIComponent(selectedDepartment)}`)
          .then((bbox) => {
            if (bbox && bbox.length === 4) {
              map.fitBounds([[bbox[0], bbox[1]], [bbox[2], bbox[3]]], { padding: 40, maxZoom: 10 });
            }
          })
          .catch((err) => console.error('Failed to fetch department bbox', err));
      }
    } else {
      if (map.getLayer('communes-outline')) {
        map.setLayoutProperty('communes-outline', 'visibility', 'none');
        map.setLayoutProperty('communes-hit', 'visibility', 'none');
      }
    }
  }, [selectedDepartment, departmentSelectionTick, mapReady]);

  // When lieu-dit changes, highlight + load forests-in-lieu-dit
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const source = map.getSource('lieuDit') as
      | mapboxgl.GeoJSONSource
      | undefined;

    if (!selectedLieuDit) {
      if (source) {
        source.setData(EMPTY_FC);
      }
      return;
    }

    (async () => {
      try {
        const fc = await fetchJson<FeatureCollection>(
          `${API_BASE}/map/lieu-dit?id=${encodeURIComponent(selectedLieuDit)}`,
        );

        lieuDitLayerRef.current = fc;

        if (source) {
          source.setData(fc);
        }

        const bbox = getBboxFromFeatureCollection(fc);
        if (bbox && map) {
          const [minX, minY, maxX, maxY] = bbox;
          if (skipLieuDitFitRef.current) {
            skipLieuDitFitRef.current = false;
          } else {
            map.fitBounds(
              [
                [minX, minY],
                [maxX, maxY],
              ],
              { padding: 40, maxZoom: 14 },
            );
          }
        }
      } catch (err: unknown) {
        console.error('Failed to handle lieu-dit selection', err);
      }
    })();
  }, [selectedLieuDit]);

  return (
    <div style={{ height: '100vh', width: '100%', display: 'flex', position: 'relative' }}>
      {/* Sidebar container */}
      <div
        style={{
          display: 'flex',
          height: '100vh',
          width: isSidebarOpen ? sidebarWidth : 0,
          transition: isResizing ? 'none' : 'width 0.3s ease',
          position: 'relative',
          zIndex: 20,
        }}
      >
        <aside
          style={{
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
            padding: isSidebarOpen ? 16 : 0,
            fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
            background: '#ffffff',
            color: '#111827',
            overflowY: 'auto',
            overflowX: 'hidden',
            borderRight: isSidebarOpen ? '1px solid #e0e0e0' : 'none',
            opacity: isSidebarOpen ? 1 : 0,
            transition: isResizing ? 'none' : 'opacity 0.2s ease, padding 0.3s ease',
          }}
        >
        <h2 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>Navigation</h2>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            type="button"
            onClick={handleLogout}
            disabled={logoutLoading}
            style={{
              padding: '4px 8px',
              fontSize: 12,
              borderRadius: 4,
              border: '1px solid #d1d5db',
              backgroundColor: logoutLoading ? '#e5e7eb' : '#fee2e2',
              color: '#b91c1c',
              cursor: logoutLoading ? 'default' : 'pointer',
            }}
          >
            {logoutLoading ? 'Signing out…' : 'Sign out'}
          </button>
          <div style={{ flex: 1 }} />
        </div>
        {logoutError && (
          <div style={{ fontSize: 12, color: '#b91c1c' }}>{logoutError}</div>
        )}

        {/* Search Box */}
        <div style={{ position: 'relative' }}>
          <input
            type="text"
            placeholder="Search commune or lieu-dit..."
            style={{
              width: '100%',
              padding: '6px 10px',
              fontSize: 13,
              borderRadius: 4,
              border: '1px solid #cbd5e1',
              outline: 'none',
            }}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
          {isSearching && (
            <div style={{ position: 'absolute', right: 10, top: 8, fontSize: 10, color: '#64748b' }}>...</div>
          )}
          
          {searchResults && (searchResults.communes.length > 0 || searchResults.lieuxDits.length > 0) && (
            <div style={{
              position: 'absolute',
              top: '100%',
              left: 0,
              right: 0,
              background: '#fff',
              border: '1px solid #e2e8f0',
              borderRadius: '0 0 4px 4px',
              boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)',
              zIndex: 100,
              maxHeight: 200,
              overflowY: 'auto'
            }}>
              {searchResults.communes.map(c => (
                <div 
                  key={`search-c-${c.id}`}
                  onClick={() => handleSearchResultClick(c, 'commune')}
                  style={{ padding: '6px 10px', fontSize: 12, cursor: 'pointer', borderBottom: '1px solid #f1f5f9' }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = '#f8fafc')}
                  onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                >
                  📍 <strong>{c.name}</strong> <span style={{ color: '#64748b' }}>({c.id})</span>
                </div>
              ))}
              {searchResults.lieuxDits.map(ld => (
                <div 
                  key={`search-ld-${ld.id}`}
                  onClick={() => handleSearchResultClick(ld, 'lieuDit')}
                  style={{ padding: '6px 10px', fontSize: 12, cursor: 'pointer', borderBottom: '1px solid #f1f5f9' }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = '#f8fafc')}
                  onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                >
                  📌 {ld.name} <span style={{ color: '#64748b' }}>in {ld.communeId}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Basemap switch */}
        <div style={{ fontSize: 12 }}>
          Basemap:
          <div style={{ marginTop: 4, display: 'flex', gap: 8 }}>
            <button
              type="button"
              onClick={() => setBasemapMode('map')}
              style={{
                flex: 1,
                padding: '4px 6px',
                fontSize: 12,
                borderRadius: 4,
                border:
                  basemapMode === 'map'
                    ? '1px solid #2563eb'
                    : '1px solid #d1d5db',
                backgroundColor:
                  basemapMode === 'map' ? '#dbeafe' : '#f9fafb',
                cursor: 'pointer',
              }}
            >
              Map
            </button>
            <button
              type="button"
              onClick={() => setBasemapMode('satellite')}
              style={{
                flex: 1,
                padding: '4px 6px',
                fontSize: 12,
                borderRadius: 4,
                border:
                  basemapMode === 'satellite'
                    ? '1px solid #2563eb'
                    : '1px solid #d1d5db',
                backgroundColor:
                  basemapMode === 'satellite' ? '#dbeafe' : '#f9fafb',
                cursor: 'pointer',
              }}
            >
              Satellite
            </button>
          </div>
        </div>

        {/* LiDAR Coverage toggle */}
        <div style={{ fontSize: 12, marginTop: 4 }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
            <input 
              type="checkbox" 
              checked={showLidarCoverage} 
              onChange={(e) => setShowLidarCoverage(e.target.checked)}
              style={{ cursor: 'pointer' }}
            />
            Show LiDAR coverage area
          </label>
        </div>

        {/* Region select */}
        <label style={{ fontSize: 13, color: '#111827', display: 'flex', flexDirection: 'column' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span>Region</span>
            {selectedRegion && (
              <button
                type="button"
                onClick={(e) => {
                  e.preventDefault();
                  selectRegion('');
                }}
                style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, fontSize: 12, color: '#ef4444' }}
                title="Clear region"
              >
                ✕
              </button>
            )}
          </div>
          <select
            style={{
              width: '100%',
              marginTop: 4,
              padding: '4px 8px',
              borderRadius: 4,
              border: '1px solid #cbd5e1',
              backgroundColor: '#f9fafb',
              color: '#111827',
              fontSize: 13,
            }}
            value={selectedRegion}
            onChange={(e) => selectRegion(e.target.value)}
          >
            <option value="">-- choose region --</option>
            {regions.map((r) => (
              <option key={r.codeInsee} value={r.codeInsee}>
                {r.nomOfficiel}
              </option>
            ))}
          </select>
        </label>

        {/* Department select */}
        <label style={{ fontSize: 13, color: '#111827', display: 'flex', flexDirection: 'column' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span>Department</span>
            {selectedDepartment && (
              <button
                type="button"
                onClick={(e) => {
                  e.preventDefault();
                  selectDepartment('');
                }}
                style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, fontSize: 12, color: '#ef4444' }}
                title="Clear department"
              >
                ✕
              </button>
            )}
          </div>
          <select
            style={{
              width: '100%',
              marginTop: 4,
              padding: '4px 8px',
              borderRadius: 4,
              border: '1px solid #cbd5e1',
              backgroundColor: '#f9fafb',
              color: '#111827',
              fontSize: 13,
              opacity: selectedRegion ? 1 : 0.6,
            }}
            value={selectedDepartment}
            onChange={(e) => selectDepartment(e.target.value)}
            disabled={!selectedRegion}
          >
            <option value="">-- choose department --</option>
            {departments.map((d) => (
              <option key={d.codeInsee} value={d.codeInsee}>
                {d.nomOfficiel} ({d.codeInsee})
              </option>
            ))}
          </select>
        </label>

        {/* Commune select */}
        <label style={{ fontSize: 13, color: '#111827', display: 'flex', flexDirection: 'column' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span>Commune</span>
            {selectedCommune && (
              <button
                type="button"
                onClick={(e) => {
                  e.preventDefault();
                  selectCommune('');
                }}
                style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, fontSize: 12, color: '#ef4444' }}
                title="Clear commune"
              >
                ✕
              </button>
            )}
          </div>
          <select
            style={{
              width: '100%',
              marginTop: 4,
              padding: '4px 8px',
              borderRadius: 4,
              border: '1px solid #cbd5e1',
              backgroundColor: '#f9fafb',
              color: '#111827',
              fontSize: 13,
              opacity: selectedDepartment ? 1 : 0.6,
            }}
            value={selectedCommune}
            onChange={(e) => selectCommune(e.target.value)}
            disabled={!selectedDepartment}
          >
            <option value="">-- choose commune --</option>
            {communes.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} ({c.id})
              </option>
            ))}
          </select>
        </label>

        {/* Lieu-dit select */}
        <label style={{ fontSize: 13, color: '#111827', display: 'flex', flexDirection: 'column' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span>Lieu-dit</span>
            {selectedLieuDit && (
              <button
                type="button"
                onClick={(e) => {
                  e.preventDefault();
                  selectLieuDit('');
                }}
                style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, fontSize: 12, color: '#ef4444' }}
                title="Clear lieu-dit"
              >
                ✕
              </button>
            )}
          </div>
          <select
            style={{
              width: '100%',
              marginTop: 4,
              padding: '4px 8px',
              borderRadius: 4,
              border: '1px solid #cbd5e1',
              backgroundColor: '#f9fafb',
              color: '#111827',
              fontSize: 13,
              opacity: selectedCommune && lieuxDits.length ? 1 : 0.6,
            }}
            value={selectedLieuDit}
            onChange={(e) => selectLieuDit(e.target.value)}
            disabled={!selectedCommune || lieuxDits.length === 0}
          >
            <option value="">-- choose lieu-dit --</option>
            {lieuxDits.map((ld) => (
              <option key={ld.id} value={ld.id.toString()}>
                {ld.name} (#{ld.id})
              </option>
            ))}
          </select>
        </label>

        <button
          type="button"
          onClick={() => {
            selectRegion('', { userInitiated: false });
            selectDepartment('', { userInitiated: false });
            selectCommune('', { userInitiated: false });
            selectLieuDit('', { userInitiated: false });
          }}
          style={{
            padding: '4px 8px',
            fontSize: 12,
            borderRadius: 4,
            border: '1px solid #d1d5db',
            backgroundColor: '#f3f4f6',
            cursor: 'pointer',
            alignSelf: 'flex-start',
          }}
        >
          Reset selection
        </button>

        <hr style={{ margin: '4px 0', borderColor: '#e5e7eb' }} />

        <div style={{ fontSize: 12, color: '#4b5563', display: 'flex', justifyContent: 'space-between' }}>
          <span>Map ready</span>
        </div>

        {/* Coverage choropleth legend (visible only at zoom < 9) */}
        {currentZoom < 9 && (
          <div style={{ fontSize: 12, color: '#374151' }}>
            <div style={{ fontWeight: 600, marginBottom: 4 }}>Forest cover (zoom&nbsp;&lt;&nbsp;9)</div>
            <div style={{ display: 'flex', gap: 3, alignItems: 'center' }}>
              {[
                { pct: '0%',  color: '#f0fdf4' },
                { pct: '15%', color: '#4ade80' },
                { pct: '30%', color: '#16a34a' },
                { pct: '50%', color: '#14532d' },
              ].map(({ pct, color }) => (
                <div key={pct} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flex: 1 }}>
                  <div style={{ width: '100%', height: 10, backgroundColor: color, border: '1px solid #d1d5db', borderRadius: 2 }} />
                  <span style={{ fontSize: 10, color: '#6b7280', marginTop: 2 }}>{pct}</span>
                </div>
              ))}
            </div>
            <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 3 }}>Data available for D068 only</div>
          </div>
        )}

        {/* TFV_G11 legend + filters */}
        <div
          style={{
            fontSize: 13,
            fontWeight: 600,
            color: '#111827',
          }}
        >
          Forest classification ({forestClasses.length})
        </div>

        <div style={{ display: 'flex', gap: 6 }}>
          <button
            type="button"
            onClick={() =>
              setActiveForestClassCodes(forestClasses.map((c) => c.code))
            }
            style={{
              flex: 1,
              padding: '3px 6px',
              fontSize: 11,
              borderRadius: 4,
              border: '1px solid #d1d5db',
              backgroundColor: '#f3f4f6',
              cursor: 'pointer',
            }}
          >
            Select all
          </button>
          <button
            type="button"
            onClick={() => setActiveForestClassCodes([])}
            style={{
              flex: 1,
              padding: '3px 6px',
              fontSize: 11,
              borderRadius: 4,
              border: '1px solid #d1d5db',
              backgroundColor: '#f3f4f6',
              cursor: 'pointer',
            }}
          >
            Clear
          </button>
        </div>

        <div
          style={{
            maxHeight: 160,
            overflowY: 'auto',
            paddingRight: 4,
            flexShrink: 0,
          }}
        >
          {forestClassesError && (
            <div style={{ fontSize: 12, color: '#dc2626' }}>
              {forestClassesError}
              <button
                type="button"
                onClick={() => {
                  setForestClassesError(null);
                  fetchJson<ForestClass[]>(`${API_BASE}/map/forest-classes`)
                    .then((data) => {
                      if (Array.isArray(data) && data.length > 0) {
                        setForestClasses(data);
                        setForestClassesError(null);
                        setActiveForestClassCodes(data.map((c) => c.code));
                      }
                    })
                    .catch((err) => setForestClassesError(err?.message || 'Failed to load'));
                }}
                style={{ marginLeft: 6, fontSize: 11, cursor: 'pointer' }}
              >
                Retry
              </button>
            </div>
          )}
          {!forestClassesError && forestClasses.length === 0 && (
            <div style={{ fontSize: 12, color: '#6b7280' }}>
              Loading forest classes…
            </div>
          )}

          {forestClasses.map((cls, idx) => {
            const color =
              FOREST_CLASS_COLORS[idx % FOREST_CLASS_COLORS.length];
            const checked = activeForestClassCodes.includes(cls.code);

            return (
              <label
                key={`${cls.code}-${idx}`}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  fontSize: 12,
                  marginTop: 4,
                }}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={(e) => {
                    const isChecked = (e.target as HTMLInputElement).checked;
                    setActiveForestClassCodes((prev) => {
                      if (isChecked) {
                        if (prev.includes(cls.code)) return prev;
                        return [...prev, cls.code];
                      } else {
                        return prev.filter((c) => c !== cls.code);
                      }
                    });
                  }}
                  style={{ cursor: 'pointer' }}
                />
                <span
                  style={{
                    width: 12,
                    height: 12,
                    borderRadius: 2,
                    backgroundColor: color,
                    border: '1px solid #374151',
                    flexShrink: 0,
                  }}
                />
                <span style={{ color: '#111827' }}>
                  {cls.label || `Class ${cls.code}`}
                </span>
              </label>
            );
          })}
        </div>

        <hr style={{ margin: '12px 0', borderColor: '#e5e7eb' }} />

        <div style={{ fontSize: 13, fontWeight: 600, color: '#111827' }}>
          Selected area analysis
        </div>
        <button
          type="button"
          onClick={analyzeAdminBoundary}
          disabled={!activeAdminLevel || polygonLoading}
          style={{
            width: '100%',
            marginTop: 6,
            padding: '4px 6px',
            fontSize: 12,
            borderRadius: 4,
            border: '1px solid #d1d5db',
            backgroundColor: !activeAdminLevel
              ? '#e5e7eb'
              : polygonLoading
              ? '#dbeafe'
              : '#e0f2fe',
            cursor: !activeAdminLevel || polygonLoading ? 'default' : 'pointer',
          }}
        >
          {activeAdminLabel ? `Analyze ${activeAdminLabel}` : 'No Area Selected'}
        </button>

        <hr style={{ margin: '12px 0', borderColor: '#e5e7eb' }} />

        <div style={{ fontSize: 13, fontWeight: 600, color: '#111827' }}>
          Polygon analysis
        </div>
        <p style={{ margin: '4px 0', fontSize: 12, color: '#4b5563' }}>
          Click “Draw polygon”, sketch directly on the map, and analyze the area
          to see parcel IDs and tree species.
        </p>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <button
            type="button"
            onClick={toggleDrawPolygon}
            disabled={!mapReady}
            style={{
              flex: 1,
              padding: '4px 6px',
              fontSize: 12,
              borderRadius: 4,
              border: '1px solid #d1d5db',
              backgroundColor: isDrawModeActive ? '#fee2e2' : '#e0f2fe',
              cursor: mapReady ? 'pointer' : 'default',
              opacity: mapReady ? 1 : 0.6,
            }}
          >
            {isDrawModeActive ? 'Stop drawing' : 'Draw polygon'}
          </button>
          <button
            type="button"
            onClick={() => {
              setShowPasteInput(!showPasteInput);
              setPasteError(null);
            }}
            style={{
              flex: 1,
              padding: '4px 6px',
              fontSize: 12,
              borderRadius: 4,
              border: '1px solid #d1d5db',
              backgroundColor: showPasteInput ? '#f3f4f6' : '#ffffff',
              cursor: 'pointer',
            }}
          >
            {showPasteInput ? 'Hide GeoJSON' : 'GeoJSON Data'}
          </button>
          <button
            type="button"
            onClick={analyzeDrawnPolygon}
            disabled={!drawnPolygon || polygonLoading}
            style={{
              width: '100%',
              padding: '4px 6px',
              fontSize: 12,
              borderRadius: 4,
              border: '1px solid #d1d5db',
              backgroundColor: !drawnPolygon
                ? '#e5e7eb'
                : polygonLoading
                ? '#dbeafe'
                : '#e0f2fe',
              cursor: !drawnPolygon || polygonLoading ? 'default' : 'pointer',
            }}
          >
            {polygonLoading ? 'Analyzing…' : 'Analyze polygon'}
          </button>
        </div>

        {showPasteInput && (
          <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
            <textarea
              placeholder="Paste or view GeoJSON (Polygon/MultiPolygon) or coordinate array here..."
              value={pastedGeoJson}
              onChange={(e) => setPastedGeoJson(e.target.value)}
              style={{
                width: '100%',
                height: 120,
                fontSize: 11,
                padding: '4px 8px',
                borderRadius: 4,
                border: '1px solid #cbd5e1',
                fontFamily: 'monospace',
                resize: 'vertical',
                whiteSpace: 'pre'
              }}
            />
            {pasteError && (
              <div style={{ fontSize: 10, color: '#ef4444', fontWeight: 500 }}>
                {pasteError}
              </div>
            )}
            <button
              type="button"
              onClick={handlePasteGeoJson}
              style={{
                padding: '4px 8px',
                fontSize: 11,
                borderRadius: 4,
                backgroundColor: '#10b981',
                color: 'white',
                border: 'none',
                cursor: 'pointer'
              }}
            >
              Draw & Load
            </button>
          </div>
        )}

        <div
          style={{
            marginTop: 6,
            padding: 8,
            border: '1px solid #e5e7eb',
            borderRadius: 6,
            background: '#f8fafc',
            display: 'flex',
            flexDirection: 'column',
            gap: 6,
          }}
        >
          <label
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              fontSize: 12,
              color: '#111827',
              cursor: canRenderPolygon3D ? 'pointer' : 'default',
              opacity: canRenderPolygon3D ? 1 : 0.65,
            }}
          >
            <input
              type="checkbox"
              checked={showPolygon3D}
              disabled={!canRenderPolygon3D}
              onChange={(e) => setShowPolygon3D(e.target.checked)}
            />
            Show 3D canopy grid
          </label>

          <div style={{ fontSize: 11, color: '#6b7280', lineHeight: 1.35 }}>
            {heightGridLoading
              ? 'Building per-cell canopy grid...'
              : canRenderPolygon3D
              ? `${canopyHeightSource ?? 'Canopy height'} grid: ${extrusionCellCount} cells @ ${formatInteger(gridCellSizeM)} m, mean ${formatFixed(canopyHeightMeanM, 1)} m -> avg extrusion ${formatInteger(extrusionElevationM)} m (x${EXTRUSION_HEIGHT_SCALE})`
              : polygonStatsSource === 'admin'
              ? 'Run analysis on an admin area to build per-cell canopy heights from FORMS-T.'
              : 'Run Analyze polygon to build per-cell canopy heights from FORMS-T.'}
          </div>

          <div style={{ display: 'flex', gap: 6 }}>
            <button
              type="button"
              onClick={tiltMapFor3D}
              disabled={!showPolygon3D || !canRenderPolygon3D}
              style={{
                flex: 1,
                padding: '4px 6px',
                fontSize: 11,
                borderRadius: 4,
                border: '1px solid #d1d5db',
                backgroundColor:
                  !showPolygon3D || !canRenderPolygon3D ? '#e5e7eb' : '#eef2ff',
                cursor:
                  !showPolygon3D || !canRenderPolygon3D ? 'default' : 'pointer',
              }}
            >
              Tilt map
            </button>
            <button
              type="button"
              onClick={resetMapCamera}
              style={{
                flex: 1,
                padding: '4px 6px',
                fontSize: 11,
                borderRadius: 4,
                border: '1px solid #d1d5db',
                backgroundColor: '#ffffff',
                cursor: 'pointer',
              }}
            >
              Reset camera
            </button>
          </div>
        </div>
        
        {polygonStats && (
          <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
            <button
              onClick={() => utilsDownloadPDF(polygonStats)}
              style={{
                flex: 1,
                padding: '4px 6px',
                fontSize: 11,
                borderRadius: 4,
                border: '1px solid #d1d5db',
                backgroundColor: '#ffffff',
                cursor: 'pointer'
              }}
            >
              📄 PDF Report
            </button>
            <button
              onClick={() => utilsDownloadCSV(polygonStats)}
              style={{
                flex: 1,
                padding: '4px 6px',
                fontSize: 11,
                borderRadius: 4,
                border: '1px solid #d1d5db',
                backgroundColor: '#ffffff',
                cursor: 'pointer'
              }}
            >
              📊 CSV Data
            </button>
          </div>
        )}

        <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
          <button
            type="button"
            onClick={clearDrawnPolygon}
            disabled={!drawnPolygon && !polygonStats}
            style={{
              flex: 1,
              padding: '4px 6px',
              fontSize: 12,
              borderRadius: 4,
              border: '1px solid #d1d5db',
              backgroundColor: '#fef3c7',
              color: '#92400e',
              cursor: !drawnPolygon && !polygonStats ? 'default' : 'pointer',
              opacity: !drawnPolygon && !polygonStats ? 0.6 : 1,
            }}
          >
            Clear polygon
          </button>
        </div>
        {polygonError && (
          <div style={{ marginTop: 6, fontSize: 12, color: '#b91c1c' }}>
            {polygonError}
          </div>
        )}
        {polygonStats && (
          <div
            style={{
              marginTop: 8,
              padding: '8px 4px',
              border: '1px solid #e5e7eb',
              borderRadius: 6,
              background: '#f9fafb',
              display: 'flex',
              flexDirection: 'column',
              gap: 12,
            }}
          >
            {/* Area & Summary Big Numbers */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, padding: '0 4px' }}>
              <div style={{ padding: 8, background: '#ffffff', borderRadius: 4, border: '1px solid #f3f4f6' }}>
                <div style={{ fontSize: 10, color: '#6b7280', textTransform: 'uppercase' }}>Area</div>
                <div style={{ fontSize: 14, fontWeight: 700 }}>{formatFixed(polygonStats.areaHa, 1)} ha</div>
              </div>
              <div style={{ padding: 8, background: '#ffffff', borderRadius: 4, border: '1px solid #f3f4f6' }}>
                <div style={{ fontSize: 10, color: '#6b7280', textTransform: 'uppercase' }}>Est. Value</div>
                <div style={{ fontSize: 14, fontWeight: 700, color: '#059669' }}>
                  {polygonStats.estimatedValueEur > 0 
                    ? `€${formatCompactThousands(polygonStats.estimatedValueEur, 1)}` 
                    : 'N/A'}
                </div>
              </div>
              <div style={{ padding: 8, background: '#ffffff', borderRadius: 4, border: '1px solid #f3f4f6' }}>
                <div style={{ fontSize: 10, color: '#6b7280', textTransform: 'uppercase' }}>Volume</div>
                <div style={{ fontSize: 14, fontWeight: 700 }}>
                  {polygonStats.standingVolumeM3 > 0 
                    ? formatCompactThousands(polygonStats.standingVolumeM3, 1, 'm³') 
                    : 'N/A'}
                </div>
              </div>
              <div style={{ padding: 8, background: '#ffffff', borderRadius: 4, border: '1px solid #f3f4f6' }}>
                <div style={{ fontSize: 10, color: '#6b7280', textTransform: 'uppercase' }}>Carbon</div>
                <div style={{ fontSize: 14, fontWeight: 700, color: '#2563eb' }}>
                  {polygonStats.carbonStockTCO2e > 0 
                    ? formatCompactThousands(polygonStats.carbonStockTCO2e, 1, 't') 
                    : 'N/A'}
                </div>
              </div>
            </div>

            {/* Species Chart */}
            {polygonStats.treeSpecies.length > 0 && (
              <div style={{ padding: '0 4px' }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: '#374151', marginBottom: 4 }}>Species Distribution (ha)</div>
                <div style={{ height: 140, width: '100%' }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                      layout="vertical"
                      data={polygonStats.treeSpecies.slice(0, 5)}
                      margin={{ top: 0, right: 30, left: 40, bottom: 0 }}
                    >
                      <XAxis type="number" hide />
                      <YAxis 
                        dataKey="species" 
                        type="category" 
                        width={40} 
                        style={{ fontSize: 9 }} 
                        interval={0}
                      />
                      <Tooltip 
                        contentStyle={{ fontSize: 10, padding: '4px 8px' }}
                        formatter={(value: unknown) => [`${formatFixed(value as number, 2, '0.00')} ha`, 'Area']}
                      />
                      <Bar dataKey="areaHa" fill="#10b981" radius={[0, 4, 4, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            )}

            {/* Raster Stats (AGBD, Height, WVD) */}
            {polygonStats.rasterStats && (
              <div style={{ padding: '0 4px', display: 'flex', flexDirection: 'column', gap: 6 }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: '#374151' }}>Biomass & Structure (FORMS-T)</div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 4 }}>
                  <div style={{ textAlign: 'center', padding: 4, background: '#f0f9ff', borderRadius: 4 }}>
                    <div style={{ fontSize: 9, color: '#0369a1' }}>AGBD</div>
                    <div style={{ fontSize: 11, fontWeight: 600 }}>{formatInteger(polygonStats.rasterStats.agbd.mean)}</div>
                    <div style={{ fontSize: 8, color: '#64748b' }}>Mg/ha</div>
                  </div>
                  <div style={{ textAlign: 'center', padding: 4, background: '#f0fdf4', borderRadius: 4 }}>
                    <div style={{ fontSize: 9, color: '#15803d' }}>Height</div>
                    <div style={{ fontSize: 11, fontWeight: 600 }}>{formatFixed(polygonStats.rasterStats.height.mean, 1)}</div>
                    <div style={{ fontSize: 8, color: '#64748b' }}>m</div>
                  </div>
                  <div style={{ textAlign: 'center', padding: 4, background: '#fffbeb', borderRadius: 4 }}>
                    <div style={{ fontSize: 9, color: '#b45309' }}>WVD</div>
                    <div style={{ fontSize: 11, fontWeight: 600 }}>{formatInteger(polygonStats.rasterStats.wvd.mean)}</div>
                    <div style={{ fontSize: 8, color: '#64748b' }}>m³/ha</div>
                  </div>
                </div>
              </div>
            )}

            {/* Forest Change Chart */}
            {polygonStats.forestChange && Object.keys(polygonStats.forestChange.loss_area_ha_by_year).length > 0 && (
              <div style={{ padding: '0 4px' }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: '#374151', marginBottom: 4 }}>
                  Forest Loss Timeline (ha) 
                  {loadingLossPixels && <span style={{ marginLeft: 6, fontWeight: 'normal', color: '#9ca3af' }}>loading pixels...</span>}
                </div>
                <div style={{ height: 100, width: '100%' }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart 
                      data={Object.entries(polygonStats.forestChange.loss_area_ha_by_year)
                        .map(([year, area]) => ({ year: year.slice(2), area }))
                        .sort((a, b) => Number(a.year) - Number(b.year))
                      }
                    >
                      <CartesianGrid strokeDasharray="3 3" vertical={false} />
                      <XAxis dataKey="year" style={{ fontSize: 8 }} interval={2} />
                      <YAxis hide />
                      <Tooltip 
                        labelFormatter={(label) => `Year 20${label}`}
                        formatter={(value) => {
                          const numericValue = Array.isArray(value) ? value[0] : value;
                          return numericValue == null ? '' : formatFixed(numericValue, 2, '0.00');
                        }}
                        contentStyle={{ fontSize: 10 }}
                      />
                      <Bar 
                        dataKey="area" 
                        fill="#ef4444" 
                        onMouseEnter={(barEntry: unknown) => {
                          const payload = (barEntry as { payload?: { year?: string | number } } | null)?.payload;
                          if (payload?.year != null) {
                            setHoveredLossYear(Number(payload.year));
                          }
                        }}
                        onMouseLeave={() => setHoveredLossYear(null)}
                        style={{ cursor: 'pointer' }}
                      />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
                <div 
                  style={{ 
                    fontSize: 9, 
                    color: '#ef4444', 
                    marginTop: 2, 
                    textAlign: 'center',
                    cursor: 'pointer',
                    textDecoration: hoveredLossYear === 'total' ? 'underline' : 'none'
                  }}
                  onMouseEnter={() => setHoveredLossYear('total')}
                  onMouseLeave={() => setHoveredLossYear(null)}
                >
                  Total loss: {formatFixed(Object.values(polygonStats.forestChange.loss_area_ha_by_year).reduce((a: number, b: number) => a + b, 0), 1, '0.0')} ha
                </div>
              </div>
            )}

            {/* LiDAR Stats */}
            {polygonStats.lidar && (
              <div style={{ padding: '0 4px' }}>
                {polygonStats.lidar.point_density > 0 ? (
                  <>
                    <div style={{ fontSize: 11, fontWeight: 600, color: '#374151', marginBottom: 4 }}>LiDAR Height Percentiles (m)</div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 4 }}>
                      <div style={{ flex: 1, textAlign: 'center', border: '1px solid #e2e8f0', borderRadius: 4, padding: 2 }}>
                        <div style={{ fontSize: 8, color: '#64748b' }}>P50</div>
                        <div style={{ fontSize: 10, fontWeight: 600 }}>{formatFixed(polygonStats.lidar.p50, 1, '0.0')}</div>
                      </div>
                      <div style={{ flex: 1, textAlign: 'center', border: '1px solid #e2e8f0', borderRadius: 4, padding: 2 }}>
                        <div style={{ fontSize: 8, color: '#64748b' }}>P75</div>
                        <div style={{ fontSize: 10, fontWeight: 600 }}>{formatFixed(polygonStats.lidar.p75, 1, '0.0')}</div>
                      </div>
                      <div style={{ flex: 1, textAlign: 'center', border: '1px solid #e2e8f0', borderRadius: 4, padding: 2 }}>
                        <div style={{ fontSize: 8, color: '#64748b' }}>P95</div>
                        <div style={{ fontSize: 10, fontWeight: 600 }}>{formatFixed(polygonStats.lidar.p95, 1, '0.0')}</div>
                      </div>
                      <div style={{ flex: 1, textAlign: 'center', border: '1px solid #e2e8f0', borderRadius: 4, padding: 2 }}>
                        <div style={{ fontSize: 8, color: '#64748b' }}>Max</div>
                        <div style={{ fontSize: 10, fontWeight: 600 }}>{formatFixed(polygonStats.lidar.max_height, 1, '0.0')}</div>
                      </div>
                    </div>
                    <div style={{ fontSize: 9, color: '#64748b', marginTop: 4, textAlign: 'right' }}>
                      Density: {formatFixed(polygonStats.lidar.point_density, 1, '0.0')} pts/m²
                    </div>
                  </>
                ) : (
                  <div style={{ fontSize: 11, fontWeight: 600, color: '#6b7280', padding: '8px 0' }}>
                    LiDAR: No points found for this polygon
                  </div>
                )}
              </div>
            )}

            {/* Parcels List */}
            <div style={{ padding: '0 4px' }}>
              <button 
                onClick={() => {
                  const el = document.getElementById('parcel-list');
                  if (el) el.style.display = el.style.display === 'none' ? 'block' : 'none';
                }}
                style={{ fontSize: 11, color: '#2563eb', border: 'none', background: 'none', cursor: 'pointer', padding: 0 }}
              >
                {polygonStats.parcelIds.length} parcels intersected ↓
              </button>
              <div id="parcel-list" style={{ display: 'none', marginTop: 4, maxHeight: 60, overflowY: 'auto', fontSize: 10, color: '#4b5563' }}>
                {polygonStats.parcelIds.join(', ')}
              </div>
            </div>
          </div>
        )}
      </aside>

      {/* Resizer Handle */}
      {isSidebarOpen && (
        <div
          onMouseDown={startResizing}
          style={{
            width: 6,
            cursor: 'col-resize',
            background: isResizing ? '#3b82f6' : 'transparent',
            transition: 'background 0.2s',
            zIndex: 30,
            position: 'absolute',
            top: 0,
            bottom: 0,
            right: -3, // Center it over the border
          }}
          onMouseEnter={(e) => {
            if (!isResizing) (e.target as HTMLElement).style.background = '#93c5fd';
          }}
          onMouseLeave={(e) => {
            if (!isResizing) (e.target as HTMLElement).style.background = 'transparent';
          }}
        />
      )}

      {/* Toggle Button */}
      <button
        onClick={() => setIsSidebarOpen(!isSidebarOpen)}
        style={{
          position: 'absolute',
          right: -24,
          bottom: 40,
          width: 24,
          height: 48,
          background: '#ffffff',
          border: '1px solid #d1d5db',
          borderLeft: 'none',
          borderRadius: '0 8px 8px 0',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          boxShadow: '2px 0 4px rgba(0,0,0,0.1)',
          zIndex: 40,
          color: '#4b5563',
          fontSize: 16,
          fontWeight: 'bold',
        }}
        title={isSidebarOpen ? "Collapse sidebar" : "Expand sidebar"}
      >
        {isSidebarOpen ? '‹' : '›'}
      </button>
    </div>

    {/* Map container */}
    <div style={{ flex: 1, minWidth: 0, position: 'relative' }}>
        <div
          ref={mapContainerRef}
          style={{ width: '100%', height: '100%' }}
        />

        {/* Zoom badge */}
        <div
          style={{
            position: 'absolute',
            top: 10,
            right: 10,
            background: 'rgba(255,255,255,0.92)',
            border: '1px solid #d1d5db',
            borderRadius: 6,
            padding: '4px 10px',
            fontSize: 13,
            fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
            color: '#111827',
            pointerEvents: 'none',
            boxShadow: '0 1px 4px rgba(0,0,0,0.12)',
            zIndex: 10,
          }}
        >
          Zoom: <strong>{formatFixed(currentZoom, 1, '0.0')}</strong>
          {currentZoom < 9 && (
            <span style={{ marginLeft: 6, color: '#16a34a', fontSize: 11 }}>
              forest cover
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
