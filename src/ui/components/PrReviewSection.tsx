import { useId, useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { getUiStateItem, setUiStateItem } from "../utils/uiState";

/** A compact, keyboard-accessible disclosure that preserves its contents. */
export function PrReviewSection({
  title,
  icon,
  summary,
  storageKey,
  defaultOpen = false,
  children,
}: {
  title: string;
  icon?: ReactNode;
  summary?: ReactNode;
  storageKey: string;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const id = useId();
  const [open, setOpen] = useState(() => {
    const stored = getUiStateItem(storageKey);
    return stored == null ? defaultOpen : stored === "true";
  });
  return (
    <section className="pr-review-section">
      <h3 className="pr-section-heading">
        <button
          type="button"
          className="pr-section-toggle"
          aria-expanded={open}
          aria-controls={id}
          onClick={() =>
            setOpen((value) => {
              setUiStateItem(storageKey, String(!value));
              return !value;
            })
          }
        >
          {icon}
          <span>{title}</span>
          <span className="pr-section-summary">{summary}</span>
          <ChevronDown
            size={15}
            className="pr-section-chevron"
            aria-hidden="true"
          />
        </button>
      </h3>
      <div id={id} className="pr-section-content" hidden={!open}>
        {children}
      </div>
    </section>
  );
}
