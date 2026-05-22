export function AboutSettingsSection() {
  return (
    <div className="space-y-8 py-8">
      {/* About Section */}
      <section className="pb-2">
        <h2 className="text-xl font-medium mb-1">About Aoroza</h2>
        <p className="text-sm text-text-muted mb-4">
          A minimal markdown editor. Offline-first, keyboard-optimized, and open source with no vault,
          no AI, no cloud, no accounts, and no subscriptions.
        </p>
        <p className="text-sm text-text-muted mb-1">
          Version 0.2.0
        </p>
        <p className="text-sm text-text-muted">
          Fork for{" "}
          <a
            href="https://github.com/scratch/scratch"
            target="_blank"
            rel="noopener noreferrer"
            className="underline hover:text-text"
          >
            Scratch 0.10.0
          </a>
        </p>
      </section>
    </div>
  );
}
