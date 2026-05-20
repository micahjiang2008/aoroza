import { memo } from "react";
import { IconButton } from "../ui";
import { SettingsIcon } from "../icons";

interface FooterProps {
  onOpenSettings?: () => void;
}

export const Footer = memo(function Footer({ onOpenSettings }: FooterProps) {
  return (
    <div className="shrink-0 border-t border-border">
      <div className="flex items-center justify-end px-3 py-2">
        {onOpenSettings && (
          <IconButton onClick={onOpenSettings} title="Settings">
            <SettingsIcon className="w-4.5 h-4.5 stroke-[1.5]" />
          </IconButton>
        )}
      </div>
    </div>
  );
});
