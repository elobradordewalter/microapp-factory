import crypto from 'node:crypto';
export const hashKey = key => crypto.createHash('sha256').update(String(key)).digest('hex');
export function verifyPaddle(raw, signature, secret, now = Date.now()) {
  if (!secret || typeof signature !== 'string') return false;
  const parts = signature.split(';').map(x => x.trim().split('='));
  const ts = parts.find(([k]) => k === 'ts')?.[1];
  if (!/^\d+$/.test(ts || '') || Math.abs(now / 1000 - Number(ts)) > 300) return false;
  const expected = crypto.createHmac('sha256', secret).update(`${ts}:${raw}`).digest();
  return parts.some(([k, value]) => k === 'h1' && /^[a-f0-9]{64}$/i.test(value || '') && crypto.timingSafeEqual(expected, Buffer.from(value, 'hex')));
}
export function validateInput(b) {
  if (!b || typeof b !== 'object' || Array.isArray(b) || typeof b.input !== 'string' || (b.options !== undefined && (!b.options || typeof b.options !== 'object' || Array.isArray(b.options)))) {
    throw Object.assign(new Error('Expected input string and options object'), {status:400});
  }
}
const windows = new Map();
export function allowRequest(key, limit, now = Date.now()) {
  if (windows.size > 20000) for (const [k,v] of windows) if (now-v.start >= 60000) windows.delete(k);
  const w = windows.get(key);
  if (!w || now-w.start >= 60000) {windows.set(key,{start:now,count:1}); return true;}
  return ++w.count <= limit;
}
