import crypto from 'crypto';
import { verifySign } from './zpay';
import { createPaymentUrl } from './zpay';
import { getDb } from '@/lib/db/connection';

export interface RechargePlan {
  id: string;
  name: string;
  price: number;
  quotaYuan: number;
  membership: 'monthly' | null;
}

export const RECHARGE_PLANS: readonly RechargePlan[] = [
  { id: 'monthly_basic', name: '基础月卡', price: 99, quotaYuan: 50, membership: 'monthly' },
  { id: 'monthly_pro', name: '专业月卡', price: 199, quotaYuan: 120, membership: 'monthly' },
  { id: 'topup_50', name: '额度充值 ¥50', price: 50, quotaYuan: 25, membership: null },
] as const;

export interface Order {
  id: string;
  user_id: string;
  plan_id: string;
  plan_name: string;
  amount: number;
  pay_type: string;
  status: string;
  trade_no: string | null;
  created_at: string;
  paid_at: string | null;
}

function generateOrderId(): string {
  return crypto.randomUUID().replace(/-/g, '').slice(0, 24);
}

function findPlan(planId: string): RechargePlan {
  const plan = RECHARGE_PLANS.find((p) => p.id === planId);
  if (!plan) throw new Error(`Unknown plan: ${planId}`);
  return plan;
}

/**
 * Create a new order and return the payment URL.
 */
export function createOrder(
  userId: string,
  planId: string,
  payType: 'alipay' | 'wxpay'
): { orderId: string; payUrl: string; params: Record<string, string> } {
  const plan = findPlan(planId);
  const orderId = generateOrderId();

  const pid = process.env.ZPAY_PID;
  const notifyUrl = process.env.ZPAY_NOTIFY_URL;
  const returnUrl = process.env.ZPAY_RETURN_URL;
  if (!pid || !notifyUrl || !returnUrl) {
    throw new Error('ZPAY_PID / ZPAY_NOTIFY_URL / ZPAY_RETURN_URL not configured');
  }

  const db = getDb();
  db.prepare(`
    INSERT INTO lumos_orders (id, user_id, plan_id, plan_name, amount, pay_type, status, created_at)
    VALUES (?, ?, ?, ?, ?, ?, 'pending', datetime('now'))
  `).run(orderId, userId, plan.id, plan.name, plan.price, payType);

  const { url, params } = createPaymentUrl({
    pid,
    name: plan.name,
    money: plan.price.toFixed(2),
    out_trade_no: orderId,
    type: payType,
    notify_url: notifyUrl,
    return_url: returnUrl,
  });

  return { orderId, payUrl: url, params };
}

/**
 * Handle zpay async callback. Returns 'success' or 'fail'.
 */
export async function handlePaymentNotify(
  params: Record<string, string>
): Promise<'success' | 'fail'> {
  const key = process.env.ZPAY_KEY;
  if (!key || !verifySign(params, key)) return 'fail';
  if (params.trade_status !== 'TRADE_SUCCESS') return 'fail';

  const db = getDb();
  const order = db.prepare(
    'SELECT * FROM lumos_orders WHERE id = ?'
  ).get(params.out_trade_no) as Order | undefined;

  if (!order) return 'fail';
  if (order.status === 'paid') return 'success';

  const paidMoney = parseFloat(params.money);
  if (Math.abs(paidMoney - order.amount) > 0.01) return 'fail';

  db.prepare(`
    UPDATE lumos_orders SET status = 'paid', trade_no = ?, paid_at = datetime('now')
    WHERE id = ? AND status = 'pending'
  `).run(params.trade_no, order.id);

  const plan = findPlan(order.plan_id);
  await applyPlanBenefits(db, order.user_id, plan);

  return 'success';
}

async function applyPlanBenefits(
  db: ReturnType<typeof getDb>,
  userId: string,
  plan: RechargePlan
): Promise<void> {
  // Quota top-up lives on lumos-web: it owns new-api admin credentials and
  // the authoritative lumos_image_usage ledger. Desktop must not touch
  // new-api directly, so plan.quotaYuan is intentionally not applied here.
  if (plan.membership) {
    db.prepare(`
      UPDATE lumos_users
      SET membership = ?, membership_expires_at = datetime('now', '+30 days')
      WHERE id = ?
    `).run(plan.membership, userId);
  }
}

export function getOrdersByUser(userId: string, limit = 20): Order[] {
  const db = getDb();
  return db.prepare(
    'SELECT * FROM lumos_orders WHERE user_id = ? ORDER BY created_at DESC LIMIT ?'
  ).all(userId, limit) as Order[];
}

export function getOrderById(orderId: string): Order | null {
  const db = getDb();
  return (db.prepare(
    'SELECT * FROM lumos_orders WHERE id = ?'
  ).get(orderId) as Order) || null;
}
