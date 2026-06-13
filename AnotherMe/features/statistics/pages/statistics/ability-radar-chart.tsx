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
        <PolarGrid stroke="#e2e8f0" />
        <PolarAngleAxis dataKey="metric" tick={{ fill: '#64748b', fontSize: 12 }} />
        <PolarRadiusAxis domain={[0, 100]} tickCount={6} tick={{ fill: '#94a3b8', fontSize: 10 }} />
        <Radar
          name="能力值"
          dataKey="value"
          stroke="#6366f1"
          fill="#6366f1"
          fillOpacity={0.2}
          strokeWidth={2}
        />
        <RechartsTooltip
          formatter={(value) => [`${value} 分`, '能力值']}
          contentStyle={{
            border: '1px solid #e2e8f0',
            borderRadius: '12px',
            boxShadow: '0 4px 12px rgba(0,0,0,0.06)',
            background: '#fff',
          }}
        />
      </RadarChart>
    </ResponsiveContainer>
  );
}
