// ============================================================
// CPR V17 - Supabase 連線設定
// 這裡只能放 Project URL 與 Publishable Key。
// 絕對不要放 Secret Key、service_role key 或資料庫密碼。
// ============================================================
const V16_SUPABASE_URL = 'https://gwfiknlmolybyeqfowhx.supabase.co';
const V16_SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_QHuEU74HNsXGRVFOA5T6mw_NjEHSeNF';
const supabaseClient = window.supabase.createClient(V16_SUPABASE_URL, V16_SUPABASE_PUBLISHABLE_KEY, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false }
});

