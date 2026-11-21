import Decimal from "decimal.js";
import { z } from "zod";
export const D = Decimal.clone({ precision: 50, rounding: Decimal.ROUND_HALF_UP });
export const decimalSchema = z.string().regex(/^-?(0|[1-9]\d*)(\.\d+)?$/).max(80).refine(v => new D(v).isFinite());
export const nonnegativeDecimal = decimalSchema.refine(v => new D(v).gte(0));
export const positiveDecimal = decimalSchema.refine(v => new D(v).gt(0));
export const fraction = nonnegativeDecimal.refine(v => new D(v).lte(1));
export const money = (v: Decimal.Value) => new D(v).toDecimalPlaces(2).toFixed(2);
export const exact = (v: Decimal.Value) => new D(v).toString();
export function ratio(n: Decimal.Value, d: Decimal.Value): string | null { return new D(d).gt(0) ? new D(n).div(d).toString() : null; }
export function total(values: Decimal.Value[]) { return values.reduce<Decimal>((a,v) => a.plus(v),new D(0)); }
export function assertClosedMonth(asOf: string, now: string) {
  const a = new Date(asOf), n = new Date(now);
  if(!Number.isFinite(a.getTime()) || !Number.isFinite(n.getTime()) || a.getTime()>n.getTime()) throw new Error("Invalid or future as-of date.");
  const day = Date.UTC(a.getUTCFullYear(),a.getUTCMonth(),a.getUTCDate());
  const next = Date.UTC(a.getUTCFullYear(),a.getUTCMonth()+1,1);
  if(next-day !== 86400000 || next > n.getTime()) throw new Error("Use the end date of a closed UTC month.");
  return {asOf:a,now:n,day};
}
export function monthsEnding(asOf: Date, count: number) { return Array.from({length:count},(_,i) => new Date(Date.UTC(asOf.getUTCFullYear(),asOf.getUTCMonth()-count+i+1,1)).toISOString().slice(0,7)); }
