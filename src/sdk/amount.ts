/** Token amounts are i128 base units. They never pass through a float. */

export function toBaseUnits(input: string, decimals: number): bigint {
  const s = input.trim().replace(/,/g, '');
  const m = /^(\d+)(?:\.(\d*))?$/.exec(s);
  if (!m) throw new Error('Enter a number, like 25 or 12.50');
  const whole = m[1] ?? '0';
  const frac = m[2] ?? '';
  if (frac.length > decimals) throw new Error(`At most ${decimals} decimal places`);
  return BigInt(whole) * 10n ** BigInt(decimals) + BigInt(frac.padEnd(decimals, '0') || '0');
}

export function fromBaseUnits(units: bigint | string, decimals: number): string {
  const v = typeof units === 'bigint' ? units : BigInt(units);
  const neg = v < 0n;
  const abs = neg ? -v : v;
  const scale = 10n ** BigInt(decimals);
  const whole = abs / scale;
  const frac = (abs % scale).toString().padStart(decimals, '0').replace(/0+$/, '');
  const grouped = whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${neg ? '-' : ''}${grouped}${frac ? `.${frac}` : ''}`;
}

export function formatAmount(units: bigint | string, decimals: number, symbol: string): string {
  return `${fromBaseUnits(units, decimals)} ${symbol}`;
}
