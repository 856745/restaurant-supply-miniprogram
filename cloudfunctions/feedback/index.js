// 云函数 - 意见反馈（提交反馈 + 邮件通知 + 管理员查询管理）
// 鉴权与 api 云函数保持一致：callerUserId 定位用户 + sessionToken 单设备校验
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

// 邮件配置（收件人 + SMTP 发件凭据），见 mailConfig.js
const mailConfig = require('./mailConfig.js')

const TYPE_NAMES = { bug: '问题/Bug 反馈', suggest: '功能建议', other: '其他反馈' }

// ===================== 工具函数 =====================
function fmtTime(d) {
  if (!d) return ''
  const t = d instanceof Date ? d : new Date(d)
  if (isNaN(t.getTime())) return String(d)
  const pad = n => (n < 10 ? '0' + n : '' + n)
  return t.getFullYear() + '-' + pad(t.getMonth() + 1) + '-' + pad(t.getDate()) +
    ' ' + pad(t.getHours()) + ':' + pad(t.getMinutes())
}

function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

// 发送邮件通知（未配置或发送失败均不影响反馈保存）
async function sendFeedbackEmail(fb) {
  const cfg = mailConfig || {}
  if (!cfg.enabled) return { skipped: true, reason: '未启用' }
  const smtp = cfg.smtp || {}
  if (!smtp.user || !smtp.pass) return { skipped: true, reason: '未配置 SMTP 账号/授权码' }
  const toList = (cfg.to || []).filter(Boolean)
  if (toList.length === 0) return { skipped: true, reason: '未配置收件人' }
  try {
    // 惰性 require：即便未安装 nodemailer 也不影响反馈入库主流程
    const nodemailer = require('nodemailer')
    const transporter = nodemailer.createTransport({
      host: smtp.host || 'smtp.qq.com',
      port: smtp.port || 465,
      secure: smtp.secure !== false,
      auth: { user: smtp.user, pass: smtp.pass }
    })
    const subject = '【餐饮供货小程序】' + (TYPE_NAMES[fb.type] || '意见反馈')
    const html = [
      '<div style="font-family:Microsoft YaHei,Arial,sans-serif;padding:16px;color:#333;">',
      '<h2 style="color:#0f766e;border-bottom:2px solid #0f766e;padding-bottom:8px;font-size:18px;">' + escapeHtml(subject) + '</h2>',
      '<table style="border-collapse:collapse;width:100%;font-size:14px;">',
      '<tr><td style="padding:6px 8px;background:#f8fafc;width:90px;color:#64748b;">提交人</td><td style="padding:6px 8px;">' + escapeHtml(fb.userName || '') + '（' + escapeHtml(fb.userRole || '') + '）</td></tr>',
      '<tr><td style="padding:6px 8px;background:#f8fafc;color:#64748b;">联系方式</td><td style="padding:6px 8px;">' + escapeHtml(fb.contact || '未填写') + '</td></tr>',
      '<tr><td style="padding:6px 8px;background:#f8fafc;color:#64748b;">提交时间</td><td style="padding:6px 8px;">' + escapeHtml(fb.createTimeText || '') + '</td></tr>',
      '</table>',
      '<h3 style="margin:16px 0 6px;font-size:15px;">反馈内容</h3>',
      '<div style="background:#f8fafc;padding:12px;border-radius:6px;white-space:pre-wrap;font-size:14px;line-height:1.6;">' + escapeHtml(fb.content || '') + '</div>',
      '</div>'
    ].join('')
    await transporter.sendMail({
      from: smtp.from || smtp.user,
      to: toList.join(','),
      subject: subject,
      html: html
    })
    return { sent: true }
  } catch (e) {
    console.error('[feedback] 邮件发送失败:', e.message)
    return { sent: false, error: String(e.message || e) }
  }
}

// ===================== 主函数 =====================
exports.main = async (event, context) => {
  const { action, data } = event
  const dataObj = data || {}

  // ===== 鉴权（与 api 云函数一致） =====
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
      // ===== 提交反馈 =====
      case 'submitFeedback': {
        const content = String(dataObj.content || '').trim()
        if (!content) return { success: false, message: '反馈内容不能为空' }
        if (content.length > 2000) return { success: false, message: '反馈内容过长（最多2000字）' }
        const type = ['bug', 'suggest', 'other'].indexOf(dataObj.type) >= 0 ? dataObj.type : 'other'
        const now = new Date()
        const fb = {
          userId: user._id,
          userName: user.name || '',
          userRole: user.role || '',
          type: type,
          content: content,
          contact: String(dataObj.contact || '').trim().slice(0, 50),
          status: 'unread',
          createTime: now,
          createTimeText: fmtTime(now)
        }
        const addRes = await db.collection('feedbacks').add({ data: fb })
        fb._id = addRes._id

        // 发送邮件通知（失败不影响保存）
        const mailRes = await sendFeedbackEmail(fb)

        return { success: true, feedback: fb, mail: mailRes }
      }

      // ===== 管理员查询反馈列表（分页） =====
      case 'listFeedbacks': {
        if (user.role !== 'admin') return { success: false, message: '无权限' }
        const page = Math.max(1, parseInt(dataObj.page) || 1)
        const pageSize = Math.min(100, Math.max(1, parseInt(dataObj.pageSize) || 50))
        let total = 0
        try { total = (await db.collection('feedbacks').count()).total } catch (e) {}
        const res = await db.collection('feedbacks')
          .orderBy('createTime', 'desc')
          .skip((page - 1) * pageSize)
          .limit(pageSize)
          .get()
        return { success: true, feedbacks: res.data, total, page, pageSize }
      }

      // ===== 标记已读 =====
      case 'markFeedbackRead': {
        if (user.role !== 'admin') return { success: false, message: '无权限' }
        if (!dataObj.id) return { success: false, message: '缺少参数' }
        await db.collection('feedbacks').doc(dataObj.id).update({ data: { status: 'read' } })
        return { success: true }
      }

      // ===== 删除反馈 =====
      case 'deleteFeedback': {
        if (user.role !== 'admin') return { success: false, message: '无权限' }
        if (!dataObj.id) return { success: false, message: '缺少参数' }
        await db.collection('feedbacks').doc(dataObj.id).remove()
        return { success: true }
      }

      default:
        return { success: false, message: '未知操作' }
    }
  } catch (e) {
    console.error('[feedback] action=' + action + ' 异常:', e)
    return { success: false, message: String(e.message || e) }
  }
}
