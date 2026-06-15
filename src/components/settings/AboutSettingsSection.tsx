import { useState, useEffect } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { check } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { toast } from "sonner";
import { openUrl } from "@tauri-apps/plugin-opener";
import { Button } from "../ui";
import { RefreshCwIcon, SpinnerIcon, GithubIcon } from "../icons";

export function AboutSettingsSection() {
  const [appVersion, setAppVersion] = useState<string>("");
  const [checkingUpdate, setCheckingUpdate] = useState(false);

  useEffect(() => {
    getVersion()
      .then(setAppVersion)
      .catch(() => {});
  }, []);

  const handleCheckForUpdates = async () => {
    setCheckingUpdate(true);
    try {
      const update = await check();
      if (update) {
        toast.info(`Aoroza ${update.version} is available`, {
          description: "Downloading and installing…",
          duration: 5000,
        });
        await update.downloadAndInstall();
        await relaunch();
      } else {
        toast.success("You're on the latest version!");
      }
    } catch {
      toast.error("Could not check for updates. Try again later.");
    } finally {
      setCheckingUpdate(false);
    }
  };

  return (
    <div className="space-y-8 py-8">
      {/* Version */}
      <section className="pb-2">
        <h2 className="text-xl font-medium mb-0.5">Version</h2>
        <p className="text-sm text-text-muted mb-4">
          You are currently using Aoroza v{appVersion || "..."}
        </p>
        <Button
          onClick={handleCheckForUpdates}
          disabled={checkingUpdate}
          variant="outline"
          size="md"
          className="gap-1.25"
        >
          {checkingUpdate ? (
            <>
              <SpinnerIcon className="w-4.5 h-4.5 stroke-[1.5] animate-spin" />
              Checking...
            </>
          ) : (
            <>
              <RefreshCwIcon className="w-4.5 h-4.5 stroke-[1.5]" />
              Check for Updates
            </>
          )}
        </Button>
      </section>

      {/* Divider */}
      <div className="border-t border-border border-dashed" />

      {/* About */}
      <section className="pb-2">
        <h2 className="text-xl font-medium mb-1">About Aoroza</h2>
        <p className="text-sm text-text-muted mb-4">
          A minimal markdown editor. Offline-first, keyboard-optimized, and
          open source with no vault, no cloud, no accounts, and no
          subscriptions.
        </p>
        <div className="flex items-center gap-1">
          <Button
            onClick={() => openUrl("https://github.com/micahjiang2008/Aoroza")}
            variant="outline"
            size="md"
            className="gap-1.25"
          >
            <GithubIcon className="w-4.5 h-4.5 stroke-[1.5]" />
            View on GitHub
          </Button>
        </div>
      </section>
    </div>
  );
}
