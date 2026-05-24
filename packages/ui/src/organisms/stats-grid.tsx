import type { MetricCardProps } from "../molecules/metric-card";
import { MetricCard } from "../molecules/metric-card";

export function StatsGrid({ metrics }: { metrics: MetricCardProps[] }): JSX.Element {
  return (
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
      {metrics.map((metric) => (
        <MetricCard key={metric.title} {...metric} />
      ))}
    </div>
  );
}