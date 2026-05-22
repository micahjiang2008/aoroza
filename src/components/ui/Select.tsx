import * as React from "react";
import { cn } from "../../lib/utils";
import { ChevronDownIcon } from "../icons";

export interface SelectProps
  extends React.SelectHTMLAttributes<HTMLSelectElement> {}

const Select = React.forwardRef<HTMLSelectElement, SelectProps>(
  ({ className, children, ...props }, ref) => {
    return (
      <div
        className={cn(
          "relative rounded-md border border-border",
          "has-[select:focus-visible]:outline has-[select:focus-visible]:outline-accent",
          "has-[select:disabled]:opacity-50 has-[select:disabled]:cursor-not-allowed",
          className,
        )}
      >
        <select
          className={cn(
            "flex h-9 w-full items-center justify-between bg-bg px-3 py-2 text-sm text-text rounded-md",
            "disabled:cursor-not-allowed",
            "[&>option]:bg-bg [&>option]:text-text",
            "appearance-none pr-8",
          )}
          ref={ref}
          {...props}
        >
          {children}
        </select>
        <ChevronDownIcon className="absolute right-2.5 top-1/2 -translate-y-1/2 w-4 h-4 stroke-[1.7] text-text-muted pointer-events-none" />
      </div>
    );
  }
);
Select.displayName = "Select";

export { Select };
