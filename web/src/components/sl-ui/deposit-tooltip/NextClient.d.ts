import type {
  ForwardRefExoticComponent,
  HTMLAttributes,
  RefAttributes,
} from "react";

export type TooltipProps = HTMLAttributes<HTMLDivElement> & {
  initialOptions?: Record<string, unknown>;
  callbacks?: Record<string, (...args: unknown[]) => unknown>;
  preview?: boolean;
  resetKey?: number | string;
  onReady?: (controller: unknown) => void;
  onError?: (error: unknown) => void;
};

declare const Tooltip: ForwardRefExoticComponent<TooltipProps & RefAttributes<unknown>>;

export default Tooltip;
