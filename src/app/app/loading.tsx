export default function WorkspaceLoading() {
  return (
    <div role="status" aria-live="polite" className="space-y-5">
      <p className="eyebrow">Your workspace</p>
      <p className="font-display text-3xl">Opening the next piece…</p>
      <p>Loading your saved workspace. Your changes are not being submitted.</p>
      <div aria-hidden="true" className="h-40 rounded-3xl bg-sage/50" />
    </div>
  );
}
