export default function BudgetsPage() {
  return (
    <div>
      <h1 className="text-2xl font-semibold text-slate-900">Budgets</h1>
      <p className="mt-1 text-sm text-slate-500">
        Optional per-site spending caps to flag overspend during review.
      </p>
      <div className="mt-8 rounded-xl border border-slate-200 bg-white p-8 text-center shadow-sm">
        <p className="text-sm text-slate-600">No budgets configured.</p>
      </div>
    </div>
  );
}
