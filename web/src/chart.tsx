import { CSSProperties, ReactNode, useId } from 'react';
import { ResponsiveContainer, Tooltip } from 'recharts';

export type ChartConfig = Record<string, {
  label: string;
  color: string;
}>;

export function ChartContainer({
  config,
  className = '',
  children
}: {
  config: ChartConfig;
  className?: string;
  children: ReactNode;
}) {
  const id = useId().replace(/:/g, '');
  const colors = Object.entries(config).reduce<CSSProperties>((style, [key, item]) => {
    return { ...style, [`--color-${key}`]: item.color };
  }, {});

  return <div
    data-chart={id}
    className={`chart-container ${className}`}
    style={colors}
  >
    <ResponsiveContainer width="100%" height="100%">
      {children}
    </ResponsiveContainer>
  </div>;
}

export const ChartTooltip = Tooltip;

export function ChartTooltipContent({
  active,
  payload,
  label,
  config,
  valueFormatter = (value) => Number(value).toLocaleString()
}: {
  active?: boolean;
  payload?: ReadonlyArray<{
    color?: string;
    dataKey?: string | number;
    name?: string | number;
    value?: string | number | ReadonlyArray<string | number>;
  }>;
  label?: string | number;
  config: ChartConfig;
  valueFormatter?: (value: number | string) => string;
}) {
  if (!active || !payload?.length) return null;

  return <div className="chart-tooltip" role="status">
    {label != null && <strong>{String(label)}</strong>}
    {payload.map((item) => {
      const key = String(item.dataKey ?? item.name ?? '');
      const entry = config[key];
      return <div className="chart-tooltip-row" key={key}>
        <i style={{ background: item.color || entry?.color }} />
        <span>{entry?.label || item.name || key}</span>
        <b>{valueFormatter(String(item.value ?? 0))}</b>
      </div>;
    })}
  </div>;
}
