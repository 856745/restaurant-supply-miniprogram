/**
 * 超时未接单提醒 — 定时云函数
 * 每 5 分钟扫描一次：status=pending 且 createTime 超过 30 分钟的订单
 * 给对应店长发订阅消息提醒，并用 remindedAt 字段防重复推送
 */
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

// 复用接单通知模板 — phrase5 填"超时未接单"
// 模板ID通过云函数环境变量配置；留空则本定时任务直接跳过，不发送提醒
const TMPL_ID = process.env.ACCEPT_NOTIFY_TMPL_ID || ''

exports.main = async (event, context) => {
  if (!TMPL_ID) return { processed: 0, skipped: '未配置 ACCEPT_NOTIFY_TMPL_ID' }
  const THIRTY_MIN = 30 * 60 * 1000
  const now = new Date()
  const cutoff = new Date(now.getTime() - THIRTY_MIN)

  // 查超时未接单且尚未提醒过的订单
  let staleRes
  try {
    staleRes = await db.collection('orders')
      .where(_.and([
        { status: 'pending' },
        { createTime: _.lte(cutoff) },
        _.or([
          { remindedAt: _.exists(false) },
          { remindedAt: null }
        ])
      ]))
      .get()
  } catch (err) {
    console.error('[staleOrderCheck] 查询超时订单失败:', err)
    return { processed: 0, error: err.message }
  }

  const staleOrders = staleRes.data
  if (!staleOrders.length) {
    return { processed: 0, checked: 'no stale orders' }
  }

  let sent = 0
  let failed = 0

  for (const order of staleOrders) {
    // 查店长
    let managers
    try {
      managers = await db.collection('users')
        .where({
          role: 'manager',
          storeId: order.storeId,
          status: 'active'
        })
        .get()
    } catch (err) {
      console.error('[staleOrderCheck] 查店长失败 order=' + order._id, err)
      failed++
      continue
    }

    // 发送订阅消息
    for (const mgr of managers.data) {
      if (!mgr.openid) continue
      try {
        await cloud.openapi.subscribeMessage.send({
          touser: mgr.openid,
          templateId: TMPL_ID,
          page: 'pages/manager/orders/index',
          miniprogramState: 'formal',
          data: {
            character_string1: { value: order.no },
            thing2: { value: '【餐饮供货】' + (order.supplierName || '').slice(0, 16) },
            amount3: { value: '¥' + Number(order.total).toFixed(2) },
            time4: { value: new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false }) },
            phrase5: { value: '超时未接单' }
          }
        })
        sent++
      } catch (e) {
        // 用户未订阅 / openid 失效等，静默跳过
        console.warn('[staleOrderCheck] 发送订阅消息失败 order=' + order._id + ' user=' + mgr._id, e.errCode || e.errMsg || e.message)
      }
    }

    // 标记已提醒
    try {
      await db.collection('orders').doc(order._id).update({
        data: { remindedAt: now }
      })
    } catch (err) {
      console.error('[staleOrderCheck] 更新 remindedAt 失败 order=' + order._id, err)
    }
  }

  return { processed: staleOrders.length, sent, failed }
}
