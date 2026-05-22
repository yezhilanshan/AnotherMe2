import { describe, expect, it } from 'vitest';
import {
  getChartOption,
  normalizeChartData,
} from '@/features/classroom/components/slide-renderer/components/element/ChartElement/chartOption';
import type { ChartData, ChartType } from '@/lib/types/slides';

const optionPayload = (type: ChartType, data: Partial<ChartData>) => ({
  type,
  data: data as ChartData,
  themeColors: ['#2563eb', '#16a34a'],
});

describe('chart option normalization', () => {
  it('keeps pie and ring charts from crashing on empty series', () => {
    expect(() =>
      getChartOption(optionPayload('pie', { labels: [], legends: [], series: [] })),
    ).not.toThrow();
    expect(() =>
      getChartOption(optionPayload('ring', { labels: [], legends: [], series: [] })),
    ).not.toThrow();

    const pieOption = getChartOption(optionPayload('pie', { series: [] })) as {
      series: Array<{ data: Array<{ name: string; value: number }> }>;
    };
    expect(pieOption.series[0].data).toEqual([{ name: 'Item 1', value: 0 }]);
  });

  it('normalizes scatter data with a missing y-axis series', () => {
    const scatterOption = getChartOption(
      optionPayload('scatter', { labels: ['A', 'B'], series: [[1, 2]] }),
    ) as { series: Array<{ data: number[][] }> };

    expect(scatterOption.series[0].data).toEqual([
      [1, 1],
      [2, 2],
    ]);
  });

  it('coerces malformed numeric values to finite chart values', () => {
    const normalized = normalizeChartData('bar', {
      labels: ['A', 'B', 'C'],
      series: [['1', 'bad', 3] as unknown as number[]],
    });

    expect(normalized.series[0]).toEqual([1, 0, 3]);
  });
});
