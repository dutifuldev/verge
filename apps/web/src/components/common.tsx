import { Copy } from "lucide-react";

import { statusTone } from "../lib/format.js";
import { navigate } from "../lib/routing.js";

export const StatusPill = ({ status }: { status: string }) => (
  <span className={`statusPill ${statusTone(status)}`}>{status}</span>
);

export const NavLink = ({
  active,
  href,
  label,
}: {
  active: boolean;
  href: string;
  label: string;
}) => (
  <a
    className={`navLink ${active ? "active" : ""}`}
    href={href}
    onClick={(event) => {
      event.preventDefault();
      navigate(href);
    }}
  >
    {label}
  </a>
);

export const EmptyState = ({ title, body }: { title: string; body: string }) => (
  <div className="emptyState">
    <h3>{title}</h3>
    <p>{body}</p>
  </div>
);

export const CopyButton = ({ value, label = "Copy" }: { value: string; label?: string }) => (
  <button
    className="copyButton"
    type="button"
    aria-label={label}
    title={label}
    onClick={(event) => {
      event.preventDefault();
      event.stopPropagation();
      void navigator.clipboard.writeText(value);
    }}
  >
    <Copy size={14} strokeWidth={1.9} />
  </button>
);
