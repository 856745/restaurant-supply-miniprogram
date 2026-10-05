// 每日全量数据备份
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

const COLLECTIONS = ['users', 'stores', 'suppliers', 'orders', 'goods', 'categories', 'inventories', 'auditLogs']
const RETENTION_DAYS = 7
const BASE_PATH = 'backups'

async function getAll(collection, whereQuery) {
  const PAGE_SIZE = 100
  const MAX = 50000
  let all = [], skip = 0
  while (all.length < MAX) {
    let q = db.collection(collection)
    if (whereQuery) q = q.where(whereQuery)
    q = q.skip(skip).limit(PAGE_SIZE)
    const res = await q.get()
    if (res.data.length === 0) break
    all = all.concat(res.data)
    skip += PAGE_SIZE
  }
  return all
}

exports.main = async (event, context) => {
  const now = new Date()
  const dateStr = now.toISOString().slice(0, 10).replace(/-/g, '')

  try {
    // 1. 备份全部集合到云存储
    for (const coll of COLLECTIONS) {
      const data = await getAll(coll)
      const json = JSON.stringify(data)
      await cloud.uploadFile({
        cloudPath: `${BASE_PATH}/${dateStr}/${coll}.json`,
        fileContent: Buffer.from(json, 'utf-8')
      })
      console.log(`[backup] ${coll}: ${data.length} 条`)
    }

    // 2. 清理过期备份（保留最近 7 天）
    for (let i = RETENTION_DAYS; i <= 30; i++) {
      const d = new Date(now)
      d.setDate(d.getDate() - i)
      const oldDate = d.toISOString().slice(0, 10).replace(/-/g, '')
      const files = COLLECTIONS.map(c => `${BASE_PATH}/${oldDate}/${c}.json`)
      try {
        const delRes = await cloud.deleteFile({ fileList: files })
        if (delRes.fileList && delRes.fileList.some(f => f.status === 0)) {
          console.log(`[backup] 清理过期: ${oldDate}`)
        }
      } catch (e) {
        // 文件不存在或已删除，忽略
      }
    }

    return { success: true, date: dateStr, count: COLLECTIONS.length }
  } catch (e) {
    console.error('[backup] 失败:', e.message)
    return { success: false, message: e.message }
  }
}
