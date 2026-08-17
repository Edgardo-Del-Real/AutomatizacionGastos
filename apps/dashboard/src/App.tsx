import { ExpenseList } from "./features/expenses/ExpenseList";
import { MetricsOverview } from "./features/metrics/MetricsOverview";

export default function App() {
  return (
    <main>
      <h1>Rita Dashboard</h1>
      <MetricsOverview />
      <ExpenseList />
    </main>
  );
}