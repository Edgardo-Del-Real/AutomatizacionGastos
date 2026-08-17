import { Bar, BarChart, ResponsiveContainer, XAxis, YAxis } from "recharts";

import type { ExpenseMonth } from "@rita/contracts";

import { sortMonthsAscending } from "./MetricsCards";

export function MetricsChart({ months }: { months: ExpenseMonth[] }) {
  const sorted = sortMonthsAscending(months);
  return (
    <ResponsiveContainer
      width="100%"
      height={300}
      initialDimension={{ width: 600, height: 300 }}
      role="img"
      aria-label="Monthly expense chart"
    >
      <BarChart data={sorted}>
        <XAxis dataKey="month" interval={0} />
        <YAxis />
        <Bar dataKey="count" name="Count" fill="#8884d8" isAnimationActive={false} />
        <Bar
          dataKey="totalAmount"
          name="Total"
          fill="#82ca9d"
          isAnimationActive={false}
        />
      </BarChart>
    </ResponsiveContainer>
  );
}