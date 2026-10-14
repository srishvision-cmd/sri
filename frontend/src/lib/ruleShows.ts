/** Which conditions each product type uses — shared by the New rule form and the AI grid check screen (business rule). */
export type Shows = { make: boolean; cc: boolean; seating: boolean; gvw: boolean; rto: boolean; age: boolean; fuel: boolean };

export const COVER_TYPES = ["PCV", "GCV", "Misc D"];
export const SHOWS: Record<string, Shows> = {
  "": { make: false, cc: false, seating: false, gvw: false, rto: true, age: true, fuel: false },
  "Private Car": { make: true, cc: true, seating: false, gvw: false, rto: true, age: true, fuel: true },
  "Two Wheeler": { make: true, cc: true, seating: false, gvw: false, rto: true, age: true, fuel: true },
  PCV: { make: true, cc: false, seating: true, gvw: false, rto: true, age: true, fuel: true },
  GCV: { make: true, cc: false, seating: false, gvw: true, rto: true, age: true, fuel: true },
  "Misc D": { make: true, cc: false, seating: false, gvw: false, rto: true, age: true, fuel: false },
  Health: { make: false, cc: false, seating: false, gvw: false, rto: false, age: false, fuel: false },
  Others: { make: false, cc: false, seating: false, gvw: false, rto: true, age: true, fuel: false },
};
export const showsFor = (ptype: string): Shows => SHOWS[ptype] ?? SHOWS[""];

export const NCB_OPTS = [{ value: "any", label: "All (with & without NCB)" }, { value: "with", label: "With NCB only" }, { value: "without", label: "Without NCB only" }];
export const COVER_OPTS = [{ value: "any", label: "Both (Package & SATP)" }, { value: "package", label: "Package only" }, { value: "satp", label: "SATP (third party) only" }];
