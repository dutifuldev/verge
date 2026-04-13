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
