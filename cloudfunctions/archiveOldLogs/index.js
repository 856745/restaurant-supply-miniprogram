/**
 * 审计日志自动归档 — 定时云函数
 * 每月执行一次：将 6 个月前的 auditLogs 迁移到 auditLogsArchive 集合
 * 保留最近 6 个月活跃数据，防止 auditLogs 无限膨胀
 */
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

const ARCHIVE_MONTHS = 6
const BATCH_SIZE = 200

exports.main = async (event, context) => {
  const now = new Date()
  const cutoff = new Date(now)
  cutoff.setMonth(cutoff.getMonth() - ARCHIVE_MONTHS)

  console.log('[archiveOldLogs] 归档截止:', cutoff.toISOString(), '批次:', BATCH_SIZE)

  // 统计待归档总数
  let countRes
  try {
    countRes = await db.collection('auditLogs')
      .where({ createTime: _.lt(cutoff) })
      .count()
  } catch (err) {
    console.error('[archiveOldLogs] count 失败:', err)
    return { archived: 0, error: 'count failed: ' + err.message }
  }

  const totalToArchive = countRes.total
  if (totalToArchive === 0) {
    return { archived: 0, message: 'no logs to archive', cutoff: cutoff.toISOString() }
  }

  console.log('[archiveOldLogs] 待归档:', totalToArchive, '条')

  // 分批迁移
  let archived = 0
  let skipped = 0

  while (archived + skipped < totalToArchive) {
    let batch
    try {
      batch = await db.collection('auditLogs')
        .where({ createTime: _.lt(cutoff) })
        .limit(BATCH_SIZE)
        .get()
    } catch (err) {
      console.error('[archiveOldLogs] 查询批次失败:', err)
      break
    }

    if (!batch.data.length) break

    // 写入归档集合
    const docs = batch.data.map(doc => {
      const { _id, ...rest } = doc
      return { ...rest, originalId: _id, archivedAt: now }
    })

    try {
      // 逐条插入归档集合（云开发不支持批量 insert）
      for (const doc of docs) {
        await db.collection('auditLogsArchive').add({ data: doc })
      }
    } catch (err) {
      console.error('[archiveOldLogs] 写入归档集合失败:', err)
      skipped += batch.data.length
      continue
    }

    // 删除已归档的原始记录
    const idsToDelete = batch.data.map(d => d._id)
    for (const id of idsToDelete) {
      try {
        await db.collection('auditLogs').doc(id).remove()
        archived++
      } catch (err) {
        console.error('[archiveOldLogs] 删除失败 id=' + id, err)
        skipped++
      }
    }

    console.log('[archiveOldLogs] 批次完成:', archived, '/', totalToArchive)
  }

  return {
    archived,
    skipped,
    total: totalToArchive,
    cutoff: cutoff.toISOString(),
    message: 'archived ' + archived + ' logs, skipped ' + skipped
  }
}
