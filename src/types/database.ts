export type AssetCode = 'PKR' | 'USDT';
export type KycStatus = 'not_started' | 'pending' | 'approved' | 'rejected';
export type TransactionStatus = 'pending' | 'completed' | 'failed' | 'cancelled' | 'review';

export interface Profile { id: string; username: string | null; full_name: string | null; mobile: string | null; kyc_status: KycStatus; kyc_tier: number; created_at: string; updated_at: string; }
export interface Wallet { id: string; user_id: string; asset_code: AssetCode; balance_snapshot: string; updated_at: string; }
export interface Transaction { id: string; user_id: string; asset_code: AssetCode; amount: string; fee: string; net_amount: string; type: string; status: TransactionStatus; reference: string; created_at: string; }
export interface Notification { id: string; user_id: string; title: string; body: string; read_at: string | null; created_at: string; }
export interface P2pAdvertisement { id: string; owner_id: string; side: 'buy' | 'sell'; asset_code: 'PKR'; price: string; min_amount: string; max_amount: string; status: 'active' | 'paused' | 'closed'; created_at: string; }
export interface P2pOrder { id: string; advertisement_id: string; buyer_id: string; seller_id: string; amount: string; status: string; expires_at: string; created_at: string; }

type DatabaseTable<Row, Insert, Update> = {
  Row: Row & Record<string, unknown>;
  Insert: Insert & Record<string, unknown>;
  Update: Update & Record<string, unknown>;
  Relationships: [];
};

export interface Database {
  public: {
    Tables: {
      profiles: DatabaseTable<Profile, Pick<Profile, 'id'> & Partial<Omit<Profile, 'id' | 'created_at' | 'updated_at'>>, Partial<Omit<Profile, 'id' | 'created_at'>>>;
      wallets: DatabaseTable<Wallet, Omit<Wallet, 'id' | 'updated_at'> & Partial<Pick<Wallet, 'id'>>, Partial<Pick<Wallet, 'balance_snapshot'>>>;
      transactions: DatabaseTable<Transaction, Omit<Transaction, 'id' | 'created_at'> & Partial<Pick<Transaction, 'id'>>, Record<string, never>>;
      notifications: DatabaseTable<Notification, Omit<Notification, 'id' | 'created_at'> & Partial<Pick<Notification, 'id'>>, Partial<Pick<Notification, 'read_at'>>>;
      p2p_advertisements: DatabaseTable<P2pAdvertisement, Omit<P2pAdvertisement, 'id' | 'created_at'> & Partial<Pick<P2pAdvertisement, 'id'>>, Partial<Omit<P2pAdvertisement, 'id' | 'owner_id' | 'created_at'>>>;
      p2p_orders: DatabaseTable<P2pOrder, Omit<P2pOrder, 'id' | 'created_at'> & Partial<Pick<P2pOrder, 'id'>>, Record<string, never>>;
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
}
