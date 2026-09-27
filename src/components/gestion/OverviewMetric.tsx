import Link from "next/link";
import GlassHouse from "./GlassHouse";
import { Card } from "@/components/pro/ui";
import { Icon, type IconName } from "@/components/pro/icons";

/** The existing ledger projection, presented as a readable financial summary. */
export default function OverviewMetric({ fraction, label, value, sub, actionHref, actionLabel, icon, attention = false }: {
  attention?: boolean;
  fraction: number;
  label: string;
  value: string;
  sub: string;
  actionHref: string;
  actionLabel: string;
  icon: IconName;
}) {
  const percent = Math.round(Math.max(0, Math.min(1, fraction)) * 100);
  return <Card className={`crm-metric ${attention ? "crm-metric-attention" : ""}`}>
    {icon === "euro" && <GlassHouse className="crm-metric-art" />}
    <div className="crm-metric-top"><span>{label}</span><span className="crm-symbol"><Icon name={icon} size={22} /></span></div>
    <p className="crm-metric-value">{value}</p>
    <p className="crm-metric-sub">{sub}</p>
    <div className="crm-metric-progress">
      <div className="crm-metric-track" aria-hidden><span style={{ width: `${percent}%` }} /></div>
      <span className="crm-metric-percent">{percent}%</span>
    </div>
    <Link href={actionHref} className="crm-metric-action">
      {actionLabel}<Icon name="chevron-right" size={15} />
    </Link>
  </Card>;
}
