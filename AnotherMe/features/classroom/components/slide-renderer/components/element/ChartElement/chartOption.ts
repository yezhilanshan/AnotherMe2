import type { ComposeOption } from 'echarts/core';
import type {
  BarSeriesOption,
  LineSeriesOption,
  PieSeriesOption,
  ScatterSeriesOption,
  RadarSeriesOption,
} from 'echarts/charts';
import type { ChartData, ChartType } from '@/lib/types/slides';

type EChartOption = ComposeOption<
  BarSeriesOption | LineSeriesOption | PieSeriesOption | ScatterSeriesOption | RadarSeriesOption
>;

export interface ChartOptionPayload {
  type: ChartType;
  data: ChartData;
  themeColors: string[];
  textColor?: string;
  lineColor?: string;
  lineSmooth?: boolean;
  stack?: boolean;
}

function toFiniteNumber(value: unknown): number {
  const num = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(num) ? num : 0;
}

export function normalizeChartData(
  type: ChartType,
  rawData: Partial<ChartData> | null | undefined,
): ChartData {
  const rawSeries = Array.isArray(rawData?.series) ? (rawData.series as unknown[]) : [];
  const series = rawSeries
    .filter((item): item is unknown[] => Array.isArray(item))
    .map((item) => item.map(toFiniteNumber));
  const labels = Array.isArray(rawData?.labels) ? rawData.labels.map((item) => String(item)) : [];
  const legends = Array.isArray(rawData?.legends)
    ? rawData.legends.map((item) => String(item))
    : [];

  const firstSeries = series[0] ?? [];
  const fallbackLength =
    firstSeries.length || Math.max(...series.map((item) => item.length), labels.length, 1);
  const normalizedLabels =
    labels.length > 0
      ? labels
      : Array.from({ length: fallbackLength }, (_, index) => `Item ${index + 1}`);

  if (series.length === 0) {
    const emptySeries = Array.from({ length: normalizedLabels.length }, () => 0);
    return {
      labels: normalizedLabels,
      legends: legends.length > 0 ? legends : ['Series 1'],
      series: [emptySeries],
    };
  }

  if (type === 'scatter' && series.length === 1) {
    return {
      labels: normalizedLabels,
      legends: legends.length > 0 ? legends : ['X', 'Y'],
      series: [series[0], series[0]],
    };
  }

  return {
    labels: normalizedLabels,
    legends: series.map((_, index) => legends[index] || `Series ${index + 1}`),
    series,
  };
}

export const getChartOption = ({
  type,
  data: rawData,
  themeColors,
  textColor,
  lineColor,
  lineSmooth,
  stack,
}: ChartOptionPayload): EChartOption | null => {
  const data = normalizeChartData(type, rawData);
  const textStyle = textColor
    ? {
        color: textColor,
      }
    : {};

  const axisLine = textColor
    ? {
        lineStyle: {
          color: textColor,
        },
      }
    : undefined;

  const axisLabel = textColor
    ? {
        color: textColor,
      }
    : undefined;

  const splitLine = lineColor
    ? {
        lineStyle: {
          color: lineColor,
        },
      }
    : {};

  const legend =
    data.series.length > 1
      ? {
          top: 'bottom',
          textStyle,
        }
      : undefined;

  if (type === 'bar') {
    return {
      color: themeColors,
      textStyle,
      legend,
      xAxis: {
        type: 'category',
        data: data.labels,
        axisLine,
        axisLabel,
      },
      yAxis: {
        type: 'value',
        axisLine,
        axisLabel,
        splitLine,
      },
      series: data.series.map((item, index) => {
        const seriesItem: BarSeriesOption = {
          data: item,
          name: data.legends[index],
          type: 'bar',
          label: {
            show: true,
          },
          itemStyle: {
            borderRadius: [2, 2, 0, 0],
          },
        };
        if (stack) seriesItem.stack = 'A';
        return seriesItem;
      }),
    };
  }
  if (type === 'column') {
    return {
      color: themeColors,
      textStyle,
      legend,
      yAxis: {
        type: 'category',
        data: data.labels,
        axisLine,
        axisLabel,
      },
      xAxis: {
        type: 'value',
        axisLine,
        axisLabel,
        splitLine,
      },
      series: data.series.map((item, index) => {
        const seriesItem: BarSeriesOption = {
          data: item,
          name: data.legends[index],
          type: 'bar',
          label: {
            show: true,
          },
          itemStyle: {
            borderRadius: [0, 2, 2, 0],
          },
        };
        if (stack) seriesItem.stack = 'A';
        return seriesItem;
      }),
    };
  }
  if (type === 'line') {
    return {
      color: themeColors,
      textStyle,
      legend,
      xAxis: {
        type: 'category',
        data: data.labels,
        axisLine,
        axisLabel,
      },
      yAxis: {
        type: 'value',
        axisLine,
        axisLabel,
        splitLine,
      },
      series: data.series.map((item, index) => {
        const seriesItem: LineSeriesOption = {
          data: item,
          name: data.legends[index],
          type: 'line',
          smooth: lineSmooth,
          label: {
            show: true,
          },
        };
        if (stack) seriesItem.stack = 'A';
        return seriesItem;
      }),
    };
  }
  if (type === 'pie') {
    return {
      color: themeColors,
      textStyle,
      legend: {
        top: 'bottom',
        textStyle,
      },
      series: [
        {
          data: data.series[0].map((item, index) => ({
            value: item,
            name: data.labels[index],
          })),
          label: textColor
            ? {
                color: textColor,
              }
            : {},
          type: 'pie',
          radius: '70%',
          emphasis: {
            itemStyle: {
              shadowBlur: 10,
              shadowOffsetX: 0,
              shadowColor: 'rgba(0, 0, 0, 0.5)',
            },
            label: {
              show: true,
              fontSize: 14,
              fontWeight: 'bold',
            },
          },
        },
      ],
    };
  }
  if (type === 'ring') {
    return {
      color: themeColors,
      textStyle,
      legend: {
        top: 'bottom',
        textStyle,
      },
      series: [
        {
          data: data.series[0].map((item, index) => ({
            value: item,
            name: data.labels[index],
          })),
          label: textColor
            ? {
                color: textColor,
              }
            : {},
          type: 'pie',
          radius: ['40%', '70%'],
          padAngle: 1,
          avoidLabelOverlap: false,
          itemStyle: {
            borderRadius: 4,
          },
          emphasis: {
            label: {
              show: true,
              fontSize: 14,
              fontWeight: 'bold',
            },
          },
        },
      ],
    };
  }
  if (type === 'area') {
    return {
      color: themeColors,
      textStyle,
      legend,
      xAxis: {
        type: 'category',
        boundaryGap: false,
        data: data.labels,
        axisLine,
        axisLabel,
      },
      yAxis: {
        type: 'value',
        axisLine,
        axisLabel,
        splitLine,
      },
      series: data.series.map((item, index) => {
        const seriesItem: LineSeriesOption = {
          data: item,
          name: data.legends[index],
          type: 'line',
          areaStyle: {},
          label: {
            show: true,
          },
        };
        if (stack) seriesItem.stack = 'A';
        return seriesItem;
      }),
    };
  }
  if (type === 'radar') {
    // Display is broken without max in indicator; setting max triggers console warnings. No workaround — waiting for ECharts to fix this bug
    // const values: number[] = []
    // for (const item of data.series) {
    //   values.push(...item)
    // }
    // const max = Math.max(...values)

    return {
      color: themeColors,
      textStyle,
      legend,
      radar: {
        indicator: data.labels.map((item) => ({ name: item })),
        splitLine,
        axisLine: lineColor
          ? {
              lineStyle: {
                color: lineColor,
              },
            }
          : undefined,
      },
      series: [
        {
          data: data.series.map((item, index) => ({
            value: item,
            name: data.legends[index],
          })),
          type: 'radar',
        },
      ],
    };
  }
  if (type === 'scatter') {
    const formatedData = [];
    for (let i = 0; i < data.series[0].length; i++) {
      const x = data.series[0][i];
      const y = data.series[1] ? data.series[1][i] : x;
      formatedData.push([x, y]);
    }

    return {
      color: themeColors,
      textStyle,
      xAxis: {
        axisLine,
        axisLabel,
        splitLine,
      },
      yAxis: {
        axisLine,
        axisLabel,
        splitLine,
      },
      series: [
        {
          symbolSize: 12,
          data: formatedData,
          type: 'scatter',
        },
      ],
    };
  }

  return null;
};
