import logoOnLight from "../../../../brand/passripple-logo.svg";
import logoOnDark from "../../../../brand/passripple-logo-dark.svg";
import { cn } from "../lib/cn.ts";

export function Logo({ onDark = false, className }: { onDark?: boolean; className?: string }) {
  return (
    <img
      src={onDark ? logoOnDark : logoOnLight}
      alt="PassRipple"
      className={cn("h-9 w-auto", className)}
    />
  );
}
