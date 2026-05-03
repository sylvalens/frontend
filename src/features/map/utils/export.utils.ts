import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { PolygonStats } from '../types/map.types';
import { formatFixed, formatInteger, formatGroupedInteger } from '@/lib/number-format';

export function downloadCSV(polygonStats: PolygonStats | null) {
  if (!polygonStats) return;
  const rows = [
    ['Category', 'Metric', 'Value', 'Unit'],
    ['General', 'Total Area', formatFixed(polygonStats.areaHa, 2, '0.00'), 'ha'],
    ['General', 'Forest Area', formatFixed(polygonStats.totalForestAreaHa, 2, '0.00'), 'ha'],
    ['Economics', 'Standing Volume', formatInteger(polygonStats.standingVolumeM3, '0'), 'm3'],
    ['Economics', 'Estimated Value', formatInteger(polygonStats.estimatedValueEur, '0'), 'EUR'],
    ['Climate', 'Carbon Stock', formatInteger(polygonStats.carbonStockTCO2e, '0'), 'tCO2e'],
  ];

  polygonStats.treeSpecies.forEach((s) => {
    rows.push(['Species', s.species, formatFixed(s.areaHa, 2, '0.00'), 'ha']);
  });

  if (polygonStats.rasterStats) {
    rows.push([
      'Raster',
      'AGBD Mean',
      formatFixed(polygonStats.rasterStats.agbd.mean, 2, '0.00'),
      'Mg/ha',
    ]);
    rows.push([
      'Raster',
      'Height Mean',
      formatFixed(polygonStats.rasterStats.height.mean, 2, '0.00'),
      'm',
    ]);
    rows.push([
      'Raster',
      'WVD Mean',
      formatFixed(polygonStats.rasterStats.wvd.mean, 2, '0.00'),
      'm3/ha',
    ]);
  }

  const csvContent = rows.map((r) => r.join(',')).join('\n');
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.setAttribute('href', url);
  link.setAttribute('download', `forest_report_${new Date().toISOString().slice(0, 10)}.csv`);
  link.style.visibility = 'hidden';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

export function downloadPDF(polygonStats: PolygonStats | null) {
  if (!polygonStats) return;
  const doc = new jsPDF();
  const date = new Date().toLocaleDateString();

  doc.setFontSize(18);
  doc.text('Forest Analytics Report', 14, 20);
  doc.setFontSize(10);
  doc.text(`Generated on: ${date}`, 14, 28);
  doc.text(`Total Area: ${formatFixed(polygonStats.areaHa, 2, '0.00')} ha`, 14, 34);

  // Summary Table
  autoTable(doc, {
    startY: 40,
    head: [['Metric', 'Value', 'Unit']],
    body: [
      ['Standing Volume', formatInteger(polygonStats.standingVolumeM3, '0'), 'm³'],
      [
        'Estimated Value',
        `€${formatGroupedInteger(polygonStats.estimatedValueEur, '0')}`,
        'EUR',
      ],
      ['Carbon Stock', formatInteger(polygonStats.carbonStockTCO2e, '0'), 'tCO₂e'],
      ['Forest Area', formatFixed(polygonStats.totalForestAreaHa, 2, '0.00'), 'ha'],
    ],
  });

  // Species Table
  doc.setFontSize(14);
  doc.text(
    'Tree Species Distribution',
    14,
    (doc as jsPDF & { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 15,
  );
  autoTable(doc, {
    startY: (doc as jsPDF & { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 20,
    head: [['Species', 'Code TFV', 'Area (ha)', 'Price (€/m³)' ]],
    body: polygonStats.treeSpecies.map((s) => [
      s.species,
      s.codeTfv,
      formatFixed(s.areaHa, 2, '0.00'),
      s.priceEurM3?.toString() || 'N/A',
    ]),
  });

  // Raster Stats
  if (polygonStats.rasterStats) {
    doc.setFontSize(14);
    doc.text(
      'Biomass & Structure (FORMS-T)',
      14,
      (doc as jsPDF & { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 15,
    );
    autoTable(doc, {
      startY: (doc as jsPDF & { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 20,
      head: [['Variable', 'Mean', 'Min', 'Max', 'Unit']],
      body: [
        [
          'AGBD',
          formatFixed(polygonStats.rasterStats.agbd.mean, 1, '0.0'),
          formatFixed(polygonStats.rasterStats.agbd.min, 1, '0.0'),
          formatFixed(polygonStats.rasterStats.agbd.max, 1, '0.0'),
          'Mg/ha',
        ],
        [
          'Height',
          formatFixed(polygonStats.rasterStats.height.mean, 1, '0.0'),
          formatFixed(polygonStats.rasterStats.height.min, 1, '0.0'),
          formatFixed(polygonStats.rasterStats.height.max, 1, '0.0'),
          'm',
        ],
        [
          'WVD',
          formatFixed(polygonStats.rasterStats.wvd.mean, 1, '0.0'),
          formatFixed(polygonStats.rasterStats.wvd.min, 1, '0.0'),
          formatFixed(polygonStats.rasterStats.wvd.max, 1, '0.0'),
          'm³/ha',
        ],
      ],
    });
  }

  doc.setFontSize(8);
  doc.setTextColor(100);
  doc.text(
    'Data Sources: IGN BD Forêt V2, FORMS-T, Hansen GFC, IGN LiDAR HD. Indicative use only.',
    14,
    doc.internal.pageSize.height - 10,
  );

  doc.save(`forest_report_${new Date().toISOString().slice(0, 10)}.pdf`);
}
