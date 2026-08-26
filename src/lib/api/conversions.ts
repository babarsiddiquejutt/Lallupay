import { supabase } from '../supabaseClient';
import type { AssetCode } from '../../types/database';
export interface ConversionQuote { rate: string; gross_amount: string; fee: string; net_amount: string; fee_asset: AssetCode; }
export async function requestConversion(input: { action: 'quote' | 'execute'; fromAsset: AssetCode; toAsset: AssetCode; amount: string; idempotencyKey?: string; }): Promise<ConversionQuote | { conversionId: string }> { if (!supabase) throw new Error('Supabase is not configured.'); const { data, error } = await supabase.functions.invoke<ConversionQuote | { conversionId: string }>('convert', { body: input }); if (error) throw error; if (!data) throw new Error('Conversion service returned no data.'); return data; }
