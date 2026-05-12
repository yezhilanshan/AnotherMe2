'use client';

import {
  PolarAngleAxis,
  PolarGrid,
  PolarRadiusAxis,
  Radar,
  RadarChart,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
} from 'recharts';

export interface AbilityRadarDatum {
  metric: string;
  value: number;
  fullMark: number;
}

export function AbilityRadarChart({ data }: { data: AbilityRadarDatum[] }) {
  if (data.length === 0) {
    return (
      <div className="h-full flex items-center justify-center text-xs text-muted-foreground bg-muted">
        后端未返回能力维度分值
      </div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={280} minWidth={0}>
      <RadarChart data={data}>
        <PolarGrid stroke="#E5E7EB" />
        <PolarAngleAxis dataKey="metric" tick={{ fill: '#374151', fontSize: 12 }} />
        <PolarRadiusAxis domain={[0, 100]} tickCount={6} tick={{ fill: '#9CA3AF', fontSize: 10 }} />
        <Radar
          name="能力值"
          dataKey="value"
          stroke="#E0573D"
          fill="#E0573D"
          fillOpacity={0.28}
          strokeWidth={2}
        />
        <RechartsTooltip
          formatter={(value) => [`${value} 分`, '能力值']}
          contentStyle={{
            border: 'none',
            borderRadius: '8px',
            boxShadow: '0 8px 20px rgba(0,0,0,0.08)',
          }}
        />
      </RadarChart>
    </ResponsiveContainer>
  );
}
