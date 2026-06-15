import { useState, useEffect } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { check } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { toast } from "sonner";
import { openUrl } from "@tauri-apps/plugin-opener";
import { Button } from "../ui";
import { RefreshCwIcon, SpinnerIcon } from "../icons";

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
        const toastId = toast.loading(`Downloading Aoroza ${update.version}…`, {
          duration: Infinity,
        });
        let downloaded = 0;
        let total = 0;
        await update.download((progress) => {
          if (progress.event === "Started") {
            total = progress.data.contentLength ?? 0;
          } else if (progress.event === "Progress") {
            downloaded += progress.data.chunkLength;
            if (total > 0) {
              toast.loading(
                `Downloading Aoroza ${update.version} (${Math.round((downloaded / total) * 100)}%)…`,
                { id: toastId, duration: Infinity },
              );
            }
          }
        });
        toast.success(`Aoroza ${update.version} ready! Restarting…`, { id: toastId, duration: 3000 });
        await update.install();
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
        <h2 className="text-xl font-medium mb-0.5">About</h2>
        <p className="text-sm text-text-muted mb-4 leading-relaxed">
          A quiet place to write. No cloud, no vault, no accounts. Just you and the page.
          Keyboard-first, offline-native, and yours forever.
        </p>
        <p className="text-sm text-text-muted mb-4">
          Forked from{" "}
          <button
            onClick={() => openUrl("https://github.com/erictli/scratch")}
            className="underline hover:text-text cursor-pointer"
          >
            Scratch
          </button>
          , crafted by Eric Li. View source on{" "}
          <button
            onClick={() => openUrl("https://github.com/micahjiang2008/aoroza")}
            className="underline hover:text-text cursor-pointer"
          >
            GitHub
          </button>
          .
        </p>
      </section>
    </div>
  );
}
