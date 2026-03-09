import { add, PI } from "./math.js";

export function circleArea(r: number): number {
  return add(PI * r, PI * r) / 2;
}
