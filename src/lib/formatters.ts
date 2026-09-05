import type { AssetCode } from '../types/database';

/** Formats database NUMERIC strings without floating-point precision loss. */
export function formatAssetAmount(value: string | number, asset: AssetCode): string {
  const str = String(value ?? '0');
  const [rawInteger, rawFraction = ''] = str.split('.');
  const negative = rawInteger.startsWith('-');
  const integer = (negative ? rawInteger.slice(1) : rawInteger).replace(/^0+(?=\d)/, '') || '0';
  const grouped = integer.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const fraction = rawFraction.slice(0, asset === 'PKR' ? 2 : 8).replace(/0+$/, '');
  return `${negative ? '-' : ''}${grouped}${fraction ? `.${fraction}` : ''} ${asset}`;
}

export function formatTimestamp(value: string): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
}
