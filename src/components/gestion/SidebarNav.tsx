"use client";

import { useId } from "react";
import Link from "next/link";
import { Icon, type IconName } from "@/components/pro/icons";

type Item = {
  href: string;
  label: string;
  icon: IconName;
  badge?: number;
  children?: Array<{ href: string; label: string; badge?: number }>;
  also?: string[];
};

/** A group is a disclosure button. Only destinations are links. */
export default function SidebarNav({ items, pathname, expanded, onToggle }: {
  items: Item[];
  pathname: string;
  expanded: Record<string, boolean>;
  onToggle: (href: string) => void;
}) {
  const id = useId();
  const matches = (href: string) => pathname === href || pathname.startsWith(`${href}/`);

  return <ul className="crm-nav-list">
    {items.map((item, index) => {
      const open = Boolean(expanded[item.href]);
      const active = item.href === "/app" ? pathname === item.href :
        [...(item.children?.map((child) => child.href) ?? [item.href]), ...(item.also ?? [])].some(matches);
      const content = <>
        <Icon name={item.icon} size={19} className="shrink-0" />
        <span className="min-w-0 flex-1 text-left">{item.label}</span>
        {!!item.badge && !open && <span className="crm-nav-count">{item.badge}</span>}
        {item.children && <Icon name="chevron-down" size={14} className={`crm-disclosure ${open ? "" : "-rotate-90"}`} />}
      </>;
      return <li key={item.href} className="crm-nav-group">
        {item.children ? <>
          <button type="button" className={`crm-nav-parent ${active ? "is-active-group" : ""}`}
            aria-expanded={open} aria-controls={`${id}-${index}`} onClick={() => onToggle(item.href)}>
            {content}
          </button>
          <ul id={`${id}-${index}`} hidden={!open} className="crm-nav-children">
            {item.children.map((child) => <li key={child.href}>
              <Link href={child.href} className="crm-nav-child" aria-current={matches(child.href) ? "page" : undefined}>
                <span className="min-w-0 flex-1">{child.label}</span>
                {!!child.badge && <span className="crm-nav-count">{child.badge}</span>}
              </Link>
            </li>)}
          </ul>
        </> : <Link href={item.href} className="crm-nav-parent" aria-current={active ? "page" : undefined}>{content}</Link>}
      </li>;
    })}
  </ul>;
}
