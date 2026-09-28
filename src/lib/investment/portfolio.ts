import type { FinanceProperty } from "./loans";

type PortfolioSource = {
  TODAY: string;
  PROPERTIES: readonly {id: string; name: string}[];
  UNITS: readonly {id: string; propertyId: string; label: string}[];
  LEASES: readonly {unitId: string; status: string; startDate: string; endDate: string | null; rentCents: number}[];
};

/** Existing portfolio projection only. No lease, rent or property row is changed. */
export function financePropertiesOf(demo: PortfolioSource): FinanceProperty[] {
  return demo.PROPERTIES.map((property) => {
    const units = demo.UNITS.filter((unit) => unit.propertyId === property.id).map((unit) => ({
      id: unit.id,
      name: unit.label,
      monthlyRentCents: demo.LEASES.filter((lease) => lease.unitId === unit.id && ["active", "notice"].includes(lease.status)
        && lease.startDate <= demo.TODAY && (!lease.endDate || lease.endDate >= demo.TODAY)).reduce((sum, lease) => sum + lease.rentCents, 0),
    }));
    return {id: property.id, name: property.name, units, monthlyRentCents: units.reduce((sum, unit) => sum + unit.monthlyRentCents, 0)};
  });
}
