// 通用工具函数
function genId(prefix) {
  const ts = Date.now().toString(36)
  const rand = Math.random().toString(36).slice(2, 7)
  return prefix + ts + rand
}

function formatDate(date) {
  if (!date) return ''
  if (typeof date === 'string') date = new Date(date)
  if (date instanceof Date === false) date = new Date(date)
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

function formatTime(date) {
  if (!date) return ''
  if (typeof date === 'string') date = new Date(date)
  if (date instanceof Date === false) date = new Date(date)
  return formatDate(date) + ' ' +
    String(date.getHours()).padStart(2, '0') + ':' +
    String(date.getMinutes()).padStart(2, '0')
}

function orderNo() {
  const now = new Date()
  const h = String(now.getHours()).padStart(2, '0')
  const m = String(now.getMinutes()).padStart(2, '0')
  const r = Math.random().toString(36).slice(2, 6).toUpperCase()
  return 'SYX' + now.getFullYear() +
    String(now.getMonth() + 1).padStart(2, '0') +
    String(now.getDate()).padStart(2, '0') + h + m + r
}

function r2(n) { return Math.round((Number(n) || 0) * 100) / 100 }

module.exports = { genId, formatDate, formatTime, orderNo, r2 }
