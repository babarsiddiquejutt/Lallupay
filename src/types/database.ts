export type AssetCode = 'PKR' | 'USDT';
export type KycStatus = 'not_started' | 'pending' | 'approved' | 'rejected';
export type TransactionStatus = 'pending' | 'completed' | 'failed' | 'cancelled' | 'review';
export type PaymentMethodType = 'bank' | 'jazzcash' | 'easypaisa' | 'nayapay' | 'cashmaal';
export type P2pOrderStatus = 'created' | 'payment_sent' | 'completed' | 'cancelled' | 'disputed' | 'expired';
export type DisputeStatus = 'open' | 'resolved' | 'rejected';

export interface Profile { id: string; username: string | null; full_name: string | null; mobile: string | null; kyc_status: KycStatus; kyc_tier: number; created_at: string; updated_at: string; }
export interface Wallet { id: string; user_id: string; asset_code: AssetCode; balance_snapshot: string; updated_at: string; }
export interface Transaction { id: string; user_id: string; asset_code: AssetCode; amount: string; fee: string; net_amount: string; type: string; status: TransactionStatus; reference: string; created_at: string; }
export interface Notification { id: string; user_id: string; title: string; body: string; read_at: string | null; created_at: string; }
export interface P2pAdvertisement { id: string; owner_id: string; side: 'buy' | 'sell'; asset_code: 'PKR'; price: string; min_amount: string; max_amount: string; status: 'active' | 'paused' | 'closed'; payment_method_id: string | null; payment_window_minutes: number; created_at: string; }
export interface P2pOrder {
  id: string; advertisement_id: string; buyer_id: string; seller_id: string; amount: string; status: P2pOrderStatus;
  price: string | null; crypto_amount: string | null; payment_method_id: string | null; initiated_by: string | null;
  payment_proof_path: string | null; payment_sent_at: string | null; completed_at: string | null; cancelled_at: string | null;
  expires_at: string; created_at: string;
}
export interface OrderMessage { id: string; order_id: string; sender_id: string; body: string; created_at: string; }
export interface PaymentMethod { id: string; user_id: string; method_type: PaymentMethodType; account_name: string; account_reference_masked: string; active: boolean; created_at: string; updated_at: string; }
export interface P2pDispute { id: string; order_id: string; opened_by: string; reason: string; status: DisputeStatus; resolution: string | null; resolved_by: string | null; resolved_at: string | null; created_at: string; }
export interface P2pReview { id: string; order_id: string; reviewer_id: string; reviewed_user_id: string; rating: number; comment: string | null; created_at: string; }

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
      // Orders are written only by the service role (Edge Function → RPC); clients may read but never insert/update.
      p2p_orders: DatabaseTable<P2pOrder, Record<string, never>, Record<string, never>>;
      order_messages: DatabaseTable<OrderMessage, Pick<OrderMessage, 'order_id' | 'sender_id' | 'body'>, Record<string, never>>;
      payment_methods: DatabaseTable<PaymentMethod, Omit<PaymentMethod, 'id' | 'created_at' | 'updated_at'> & { encrypted_details: string }, Partial<Pick<PaymentMethod, 'active' | 'account_name' | 'account_reference_masked'>>>;
      disputes: DatabaseTable<P2pDispute, Pick<P2pDispute, 'order_id' | 'opened_by' | 'reason'>, Record<string, never>>;
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
}
