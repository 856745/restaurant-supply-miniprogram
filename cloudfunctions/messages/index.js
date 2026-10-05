// 云函数 - 站内消息中心（读取/已读/删除）
// 鉴权与 api/feedback 云函数一致：callerUserId 定位用户 + sessionToken 单设备校验
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

exports.main = async (event, context) => {
  const { action, data } = event
  const dataObj = data || {}

  // ===== 鉴权 =====
  let user = null
  const authUserId = dataObj.callerUserId || dataObj.userId
  if (authUserId) {
    try {
      const r = await db.collection('users').doc(authUserId).get()
      if (r.data) user = r.data
    } catch (e) {}
  }
  if (!user) {
    return { success: false, message: '未登录' }
  }
  if (user.sessionToken) {
    if (!dataObj.sessionToken || user.sessionToken !== dataObj.sessionToken) {
      return { success: false, message: '您的账号已在其他设备登录', sessionExpired: true }
    }
  }

  try {
    switch (action) {
      // 当前用户消息列表（分页）
      case 'getMessages': {
        const page = Math.max(1, parseInt(dataObj.page) || 1)
        const pageSize = Math.min(100, Math.max(1, parseInt(dataObj.pageSize) || 20))
        let total = 0
        try { total = (await db.collection('messages').where({ userId: user._id }).count()).total } catch (e) {}
        const res = await db.collection('messages')
          .where({ userId: user._id })
          .orderBy('createTime', 'desc')
          .skip((page - 1) * pageSize)
          .limit(pageSize)
          .get()
        return { success: true, messages: res.data, total, page, pageSize }
      }

      // 未读消息数
      case 'getUnreadCount': {
        let count = 0
        try { count = (await db.collection('messages').where({ userId: user._id, status: 'unread' }).count()).total } catch (e) {}
        return { success: true, count }
      }

      // 标记单条已读
      case 'markRead': {
        if (!dataObj.id) return { success: false, message: '缺少参数' }
        await db.collection('messages').where({ _id: dataObj.id, userId: user._id }).update({ data: { status: 'read' } })
        return { success: true }
      }

      // 全部已读
      case 'markAllRead': {
        await db.collection('messages').where({ userId: user._id, status: 'unread' }).update({ data: { status: 'read' } })
        return { success: true }
      }

      // 删除单条
      case 'deleteMessage': {
        if (!dataObj.id) return { success: false, message: '缺少参数' }
        await db.collection('messages').where({ _id: dataObj.id, userId: user._id }).remove()
        return { success: true }
      }

      default:
        return { success: false, message: '未知操作' }
    }
  } catch (e) {
    console.error('[messages] action=' + action + ' 异常:', e)
    return { success: false, message: String(e.message || e) }
  }
}
