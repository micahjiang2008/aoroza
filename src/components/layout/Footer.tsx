import { memo } from "react";
import { IconButton, Tooltip } from "../ui";
import { SettingsIcon, FolderIcon } from "../icons";

interface FooterProps {
  notesFolder?: string | null;
  onOpenSettings?: () => void;
}

export const Footer = memo(function Footer({ notesFolder, onOpenSettings }: FooterProps) {
  return (
    <div className="shrink-0 border-t border-border">
      <div className="flex items-center justify-between px-3 py-2">
        {notesFolder && (
          <Tooltip content={notesFolder} side="top" delayDuration={500}>
            <div className="flex items-center gap-1.5 min-w-0 text-xs text-text-muted select-text">
              <FolderIcon className="w-3.5 h-3.5 stroke-[1.5] shrink-0 opacity-60" />
              <span className="truncate">{notesFolder}</span>
            </div>
          </Tooltip>
        )}
        {onOpenSettings && (
          <Tooltip content="Settings">
            <IconButton onClick={onOpenSettings}>
              <SettingsIcon className="w-4.5 h-4.5 stroke-[1.5]" />
            </IconButton>
          </Tooltip>
        )}
      </div>
    </div>
  );
});
