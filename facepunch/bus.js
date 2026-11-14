// Tiny event bus. Every input source emits the same event:
//   punch {x, y, dx, dy, strength, source}
// x, y are in head-plane units (face width = 2, origin at the face centre),
// dx, dy is the unit direction of the blow, strength runs from 0.35 to 1.8.
const map = {};
export const on = (name, fn) => { (map[name] ||= []).push(fn); };
export const emit = (name, data) => { (map[name] || []).forEach(fn => fn(data)); };
