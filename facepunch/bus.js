// Tiny event bus. Every input source emits the same `punch` event through it.
const map = new Map();
export const on = (name, fn) => { if (!map.has(name)) map.set(name, []); map.get(name).push(fn); };
export const emit = (name, data) => { (map.get(name) || []).forEach(fn => fn(data)); };
