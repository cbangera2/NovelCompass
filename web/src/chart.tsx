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
  valueFormatter = (value) => Number(value).toLocaleString(),
  headingFormatter
}: {
  active?: boolean;
  payload?: ReadonlyArray<{
    color?: string;
    dataKey?: string | number;
    name?: string | number;
    value?: string | number | ReadonlyArray<string | number>;
    payload?: Record<string, unknown>;
  }>;
  label?: string | number;
  config: ChartConfig;
  valueFormatter?: (value: number | string, key: string, payload?: Record<string, unknown>) => string;
  headingFormatter?: (label: string | number | undefined, payload: ReadonlyArray<{
    payload?: Record<string, unknown>;
  }>) => string;
}) {
  if (!active || !payload?.length) return null;
  const heading = headingFormatter?.(label, payload) ?? (label == null ? '' : String(label));

  return <div className="chart-tooltip" role="status">
    {heading && <strong>{heading}</strong>}
    {payload.map((item) => {
      const key = String(item.dataKey ?? item.name ?? '');
      const entry = config[key];
      return <div className="chart-tooltip-row" key={key}>
        <i style={{ background: item.color || entry?.color }} />
        <span>{entry?.label || item.name || key}</span>
        <b>{valueFormatter(String(item.value ?? 0), key, item.payload)}</b>
      </div>;
    })}
  </div>;
}
