// 云函数 - Excel 工具（生成标准 .xlsx / 解析 xlsx·xls·csv）
// 鉴权与 api/feedback/messages 云函数一致：callerUserId 定位用户 + sessionToken 单设备校验
const cloud = require('wx-server-sdk')
const XLSX = require('xlsx')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

// 单 sheet 导出：构建标准 xlsx 并上传云存储，返回 fileID
async function exportXlsx(dataObj) {
  const filename = String(dataObj.filename || '导出').replace(/[\\/:*?"<>|]/g, '_')
  const title = dataObj.title || ''
  const headers = (dataObj.headers || []).map(h => (h == null ? '' : String(h)))
  const rows = dataObj.rows || []
  const summaryRows = dataObj.summaryRows || []
  const colCount = headers.length || 1

  // 构建二维数组：标题行（可选）+ 表头 + 数据 + 汇总
  const aoa = []
  let titleRowIdx = -1
  if (title) {
    aoa.push([title])
    titleRowIdx = 0
  }
  if (headers.length) aoa.push(headers)
  rows.forEach(function (r) {
    const line = []
    for (let c = 0; c < colCount; c++) line.push(r[c] == null ? '' : r[c])
    aoa.push(line)
  })
  summaryRows.forEach(function (r) {
    const line = []
    for (let c = 0; c < colCount; c++) line.push(r[c] == null ? '' : r[c])
    aoa.push(line)
  })

  const wb = XLSX.utils.book_new()
  const ws = XLSX.utils.aoa_to_sheet(aoa)

  // 标题行合并
  if (titleRowIdx >= 0 && colCount > 1) {
    ws['!merges'] = [{ s: { r: titleRowIdx, c: 0 }, e: { r: titleRowIdx, c: colCount - 1 } }]
  }
  // 列宽（按表头长度粗略估算，提升可读性）
  if (colCount > 0) {
    ws['!cols'] = headers.map(h => ({ wch: Math.min(40, Math.max(10, String(h).length * 2 + 6)) }))
  }

  XLSX.utils.book_append_sheet(wb, ws, 'Sheet1')
  const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' })

  const uploadRes = await cloud.uploadFile({
    cloudPath: 'excel/' + Date.now() + '_' + filename + '.xlsx',
    fileContent: buffer
  })
  return uploadRes.fileID
}

// 解析：读取 base64 的 xlsx/xls/csv，返回二维数组（含表头行）
function parseXlsx(dataObj) {
  const base64 = String(dataObj.base64 || '')
  if (!base64) throw new Error('文件内容为空')
  // XLSX.read 会自动识别 xlsx / xls(二进制) / csv 等格式
  const wb = XLSX.read(base64, { type: 'base64' })
  const sheetName = wb.SheetNames && wb.SheetNames[0]
  if (!sheetName) throw new Error('文件无有效工作表')
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { header: 1, defval: '', raw: true })
  if (!rows || rows.length === 0) throw new Error('文件内容为空')
  return rows
}

exports.main = async (event) => {
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
    if (action === 'exportXlsx') {
      const fileID = await exportXlsx(dataObj)
      return { success: true, fileID }
    } else if (action === 'parseXlsx') {
      const rows = parseXlsx(dataObj)
      return { success: true, rows }
    }
    return { success: false, message: '未知操作' }
  } catch (e) {
    console.error('[excel] action=' + action + ' 异常:', e)
    return { success: false, message: String(e.message || e) }
  }
}
