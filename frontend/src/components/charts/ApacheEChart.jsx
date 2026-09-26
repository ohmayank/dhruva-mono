import { useEffect, useMemo, useRef } from 'react';
import * as echarts from 'echarts/core';
import { LineChart } from 'echarts/charts';
import { GridComponent, TooltipComponent, LegendComponent } from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';
import './apacheEChart.css';

echarts.use([LineChart, GridComponent, TooltipComponent, LegendComponent, CanvasRenderer]);

const weatherSeries = [
  { key: 'temperature_c', name: 'Temperature', unit: '°C', color: '#e45858', side: 'left', offset: 0 },
  { key: 'wind_speed_mps', name: 'Wind speed', unit: 'm/s', color: '#4b88ef', side: 'left', offset: 58 },
  { key: 'wind_direction_deg', name: 'Wind direction', unit: '°', color: '#a54ee8', side: 'left', offset: 96 },
  { key: 'air_pressure_hpa', name: 'Air pressure', unit: 'hPa', color: '#424950', side: 'right', offset: 0 },
  { key: 'relative_humidity_pct', name: 'Relative humidity', unit: '%', color: '#57ad63', side: 'right', offset: 58 },
  { key: 'precipitation_rate_mmph', name: 'Precipitation rate', unit: 'mm/h', color: '#7967ff', side: 'right', offset: 96 },
];

const overviewSeries = weatherSeries.filter((metric) => ['temperature_c', 'wind_speed_mps', 'air_pressure_hpa', 'relative_humidity_pct'].includes(metric.key));

function clock(value) {
  return new Date(value).toLocaleTimeString('en-GB', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit' });
}

function useChartLayout(chartRef) {
  useEffect(() => {
    const element = chartRef.current;
    if (!element) return;
    const observer = new ResizeObserver(() => echarts.getInstanceByDom(element)?.resize());
    observer.observe(element);
    return () => { observer.disconnect(); echarts.getInstanceByDom(element)?.dispose(); };
  }, [chartRef]);
}

function MetricChart({ metric, samples }) {
  const chartRef = useRef(null);
  useChartLayout(chartRef);
  const metricSamples = useMemo(() => samples.filter((row) => Number.isFinite(row[metric.key])), [metric.key, samples]);
  const values = metricSamples.map((row) => row[metric.key]);
  const latest = metricSamples.at(-1);

  useEffect(() => {
    if (!chartRef.current || !metricSamples.length) return;
    const chart = echarts.getInstanceByDom(chartRef.current) || echarts.init(chartRef.current);
    chart.setOption({
      animation: false,
      grid: { top: 18, right: 16, bottom: 32, left: 50 },
      tooltip: {
        trigger: 'axis',
        formatter: (points) => {
          const point = points[0];
          if (!point) return '';
          const at = new Date(point.value[0]).toLocaleString('en-GB', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' });
          return `${at} IST<br/>${metric.name}: <strong>${point.value[1]} ${metric.unit}</strong>`;
        },
      },
      xAxis: { type: 'time', axisLabel: { color: '#8a8a87', fontSize: 9, formatter: clock }, axisLine: { lineStyle: { color: '#dededb' } }, splitLine: { show: false } },
      yAxis: { type: 'value', scale: true, axisLabel: { color: '#8a8a87', fontSize: 9 }, axisLine: { show: false }, splitLine: { lineStyle: { color: '#eeeeec' } } },
      series: [{ name: metric.name, type: 'line', smooth: .35, showSymbol: metricSamples.length < 8, symbolSize: 5, data: metricSamples.map((row) => [row.recorded_at, row[metric.key]]), lineStyle: { width: 2.2, color: metric.color }, itemStyle: { color: metric.color }, areaStyle: { color: `${metric.color}12` } }],
    });

  }, [metric, metricSamples]);

  return <article className="metric-plot-card" id={`metric-${metric.key}`}>
    <header><div><span>{metric.name}</span><strong>{latest ? Number(latest[metric.key].toFixed(2)) : '—'}<small>{metric.unit}</small></strong></div><span className="metric-dot" style={{ background: metric.color }} /></header>
    <div ref={chartRef} className="metric-plot" role="img" aria-label={`${metric.name} over the past 24 hours`} />
    <footer><span>{metricSamples.length} samples</span><span>{values.length ? `${Number(Math.min(...values).toFixed(2))}–${Number(Math.max(...values).toFixed(2))} ${metric.unit}` : 'No range'}</span></footer>
  </article>;
}

export default function ApacheEChart({ dataset }) {
  const chartRef = useRef(null);
  useChartLayout(chartRef);
  const samples = useMemo(() => {
    const rows = dataset?.rows || [];
    const latestAt = Math.max(...rows.map((row) => Date.parse(row.recorded_at)));
    return rows.filter((row) => Date.parse(row.recorded_at) >= latestAt - 24 * 60 * 60 * 1000 && weatherSeries.some((metric) => Number.isFinite(row[metric.key])));
  }, [dataset]);
  const latest = samples.reduce((newest, sample) => !newest || Date.parse(sample.recorded_at) > Date.parse(newest.recorded_at) ? sample : newest, null);
  const stationName = dataset?.station_code ? dataset.station_code.charAt(0) + dataset.station_code.slice(1).toLowerCase() : 'Station';
  const dateLabel = latest ? new Date(latest.recorded_at).toLocaleDateString('en-GB', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric' }) : 'No date available';
  const metricValue = (key, unit) => {
    const row = [...samples].reverse().find((sample) => Number.isFinite(sample[key]));
    return row ? `${row[key].toFixed(2)} ${unit}` : `— ${unit}`;
  };

  useEffect(() => {
    if (!chartRef.current || !samples.length) return;
    const chart = echarts.getInstanceByDom(chartRef.current) || echarts.init(chartRef.current);
    chart.setOption({
      animation: false,
      color: overviewSeries.map((metric) => metric.color),
      grid: { top: 34, right: 130, bottom: 78, left: 130 },
      legend: { bottom: 10, data: overviewSeries.map((metric) => metric.name), textStyle: { color: '#666574', fontSize: 12 }, itemWidth: 22, itemHeight: 8, itemGap: 20 },
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'cross', label: { backgroundColor: '#2f5562' } },
        formatter: (points) => {
          if (!points.length) return '';
          const at = new Date(points[0].value[0]).toLocaleString('en-GB', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' });
          return `${at} IST<br/>${points.map((point) => `${point.marker} ${point.seriesName}: <strong>${point.value[1]} ${overviewSeries[point.seriesIndex].unit}</strong>`).join('<br/>')}`;
        },
      },
      xAxis: { type: 'time', axisLabel: { color: '#728893', formatter: clock }, axisLine: { lineStyle: { color: '#c8d9dc' } }, splitLine: { show: false } },
      yAxis: overviewSeries.map((metric) => ({
        type: 'value', scale: true, name: `${metric.name} (${metric.unit})`, nameLocation: 'middle', nameGap: 38, position: metric.side, offset: metric.offset,
        nameTextStyle: { color: metric.color, fontWeight: 700 },
        axisLabel: { color: metric.color, fontSize: 10 },
        min: (extent) => Math.floor(extent.min - Math.max((extent.max - extent.min) * .2, .5)),
        max: (extent) => Math.ceil(extent.max + Math.max((extent.max - extent.min) * .2, .5)),
        axisLine: { show: true, lineStyle: { color: metric.color } },
        splitLine: { show: metric.key === 'temperature_c', lineStyle: { color: '#e4e3eb' } },
      })),
      series: overviewSeries.map((metric, index) => ({
        name: metric.name, type: 'line', yAxisIndex: index, smooth: .38,
        showSymbol: false, connectNulls: true,
        data: samples.filter((row) => Number.isFinite(row[metric.key])).map((row) => [row.recorded_at, row[metric.key]]),
        lineStyle: { width: 2.5 }, itemStyle: { color: metric.color },
      })),
    });

  }, [samples]);

  const availableMetrics = weatherSeries.filter((metric) => samples.some((sample) => Number.isFinite(sample[metric.key])));

  return <div className="plot-suite">
    <section className="plot-card" id="unified-view">
      <header className="plot-metrics-header">
        <time dateTime={latest?.recorded_at}>{dateLabel}</time>
        <div><span><b className="temperature-label">Temperature:</b> {metricValue('temperature_c', '°C')}</span><span><b className="pressure-label">Air pressure:</b> {metricValue('air_pressure_hpa', 'hPa')}</span></div>
        <div><span><b className="humidity-label">Relative humidity:</b> {metricValue('relative_humidity_pct', '%')}</span><span><b className="wind-label">Wind speed:</b> {metricValue('wind_speed_mps', 'm/s')}</span></div>
      </header>
      <div className="plot-body"><div className="plot-heading"><span>Unified view</span><h2>Antarctica · {stationName}</h2><p>Past 24 hours · {samples.length} stored observations · all times IST</p></div>
        {samples.length ? <div className="plot-scroll"><div ref={chartRef} className="observation-plot" role="img" aria-label="All available weather metrics over time" /></div> : <p className="plot-empty">No weather observations received yet.</p>}
      </div>
    </section>
    {availableMetrics.length > 0 && <section className="individual-plots" aria-labelledby="individual-plots-title"><div className="individual-plots-heading"><div><span>Individual metrics</span><h2 id="individual-plots-title">Each signal, on its own scale.</h2></div><p>Separate 24-hour plots make smaller changes easier to see.</p></div><div className="metric-plot-grid">{availableMetrics.map((metric) => <MetricChart key={metric.key} metric={metric} samples={samples} />)}</div></section>}
  </div>;
}
