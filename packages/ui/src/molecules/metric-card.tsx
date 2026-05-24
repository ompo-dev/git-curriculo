import { Badge } from "../atoms/badge";
import { Card, CardContent, CardHeader, CardTitle } from "../atoms/card";

export interface MetricCardProps {
  title: string;
  value: string | number;
  hint?: string;
  tag?: string;
}

export function MetricCard({ title, value, hint, tag }: MetricCardProps): JSX.Element {
  return (
    <Card>
      <CardHeader className="flex items-center justify-between">
        <CardTitle>{title}</CardTitle>
        {tag ? <Badge>{tag}</Badge> : null}
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-semibold text-[var(--gc-text)]">{value}</div>
        {hint ? <p className="mt-1 text-xs text-[var(--gc-text-muted)]">{hint}</p> : null}
      </CardContent>
    </Card>
  );
}