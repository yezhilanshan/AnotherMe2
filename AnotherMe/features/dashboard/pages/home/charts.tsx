'use client';

import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
  XAxis,
  YAxis,
} from 'recharts';

export interface PieDatum {
  name: string;
  value: number;
  color: string;
}

export interface TimeDatum {
  name: string;
  hours: number;
}

export function CompletionPieChart({ data }: { data: PieDatum[] }) {
  return (
    <ResponsiveContainer width="100%" height={160}>
      <PieChart>
        <Pie
          data={data}
          cx="50%"
          cy="50%"
          innerRadius={50}
          outerRadius={70}
          paddingAngle={2}
          dataKey="value"
          stroke="none"
        >
          {data.map((entry) => (
            <Cell key={entry.name} fill={entry.color} />
          ))}
        </Pie>
        <RechartsTooltip
          contentStyle={{
            borderRadius: '8px',
            border: 'none',
            boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)',
          }}
        />
      </PieChart>
    </ResponsiveContainer>
  );
}

export function LearningTimeChart({
  view,
  monthData,
  weekData,
}: {
  view: 'month' | 'week';
  monthData: TimeDatum[];
  weekData: TimeDatum[];
}) {
  return (
    <ResponsiveContainer width="100%" height={250}>
      {view === 'month' ? (
        <LineChart data={monthData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E5E7EB" />
          <XAxis
            dataKey="name"
            axisLine={false}
            tickLine={false}
            tick={{ fontSize: 12, fill: '#6B7280' }}
            dy={10}
          />
          <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: '#6B7280' }} />
          <RechartsTooltip
            cursor={{ stroke: '#E5E7EB', strokeWidth: 2, strokeDasharray: '4 4' }}
            contentStyle={{
              borderRadius: '8px',
              border: 'none',
              boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)',
            }}
          />
          <Line
            type="monotone"
            dataKey="hours"
            name="学习时长(小时)"
            stroke="#111827"
            strokeWidth={3}
            dot={{ r: 4, fill: '#111827', strokeWidth: 0 }}
            activeDot={{ r: 6, fill: '#E0573D', strokeWidth: 0 }}
            animationDuration={1500}
          />
        </LineChart>
      ) : (
        <BarChart data={weekData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E5E7EB" />
          <XAxis
            dataKey="name"
            axisLine={false}
            tickLine={false}
            tick={{ fontSize: 12, fill: '#6B7280' }}
            dy={10}
          />
          <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: '#6B7280' }} />
          <RechartsTooltip
            cursor={{ fill: '#F3F4F6' }}
            contentStyle={{
              borderRadius: '8px',
              border: 'none',
              boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)',
            }}
          />
          <Bar
            dataKey="hours"
            name="学习时长(小时)"
            fill="#111827"
            radius={[4, 4, 0, 0]}
            animationDuration={1000}
          />
        </BarChart>
      )}
    </ResponsiveContainer>
  );
}

export function TopicPieChart({ data }: { data: PieDatum[] }) {
  return (
    <ResponsiveContainer width="100%" height={200}>
      <PieChart margin={{ top: 0, right: 0, bottom: 0, left: 0 }}>
        <Pie
          data={data}
          cx="50%"
          cy="45%"
          innerRadius={40}
          outerRadius={70}
          paddingAngle={2}
          dataKey="value"
          stroke="none"
        >
          {data.map((entry) => (
            <Cell key={entry.name} fill={entry.color} />
          ))}
        </Pie>
        <RechartsTooltip
          formatter={(value) => `${value}`}
          contentStyle={{
            borderRadius: '8px',
            border: 'none',
            boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)',
          }}
        />
        <Legend
          verticalAlign="bottom"
          height={36}
          iconType="circle"
          wrapperStyle={{ fontSize: '12px', color: '#4B5563' }}
        />
      </PieChart>
    </ResponsiveContainer>
  );
}
