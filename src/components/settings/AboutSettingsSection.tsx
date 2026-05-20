import { GithubIcon } from "../icons";
import { Button } from "../ui";

export function AboutSettingsSection() {
  const handleOpenUrl = (url: string) => {
    window.open(url, "_blank");
  };

  return (
    <div className="space-y-8 py-8">
      {/* About Section */}
      <section className="pb-2">
        <h2 className="text-xl font-medium mb-1">About SimpleMD</h2>
        <p className="text-sm text-text-muted mb-4">
          SimpleMD - A minimal markdown editor for quick notes, todos, and ideas.
          Offline-first, keyboard-optimized, and open source with no cloud,
          no accounts, and no subscriptions.
        </p>
        <div className="flex items-center gap-1">
          <Button
            onClick={() => handleOpenUrl("https://github.com")}
            variant="outline"
            size="md"
            className="gap-1.25"
          >
            <GithubIcon className="w-4.5 h-4.5 stroke-[1.5]" />
            View on GitHub
          </Button>
          <Button
            onClick={() => handleOpenUrl("https://github.com")}
            variant="ghost"
            size="md"
            className="gap-1.25 text-text"
          >
            Submit Feedback
          </Button>
        </div>
      </section>
    </div>
  );
}
