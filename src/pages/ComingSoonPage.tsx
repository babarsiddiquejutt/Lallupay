import { Card } from '../components/ui';
export function ComingSoonPage({ title }: { title: string }) { return <main className="page"><Card><span className="eyebrow">Protected feature</span><h1>{title}</h1><p>This route is reserved for the ledger-backed workflow and will be enabled after the corresponding Edge Function is deployed and tested against Supabase.</p></Card></main>; }
