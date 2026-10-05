// 云函数 - 注册（管理员专用，创建预审核账号）
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

exports.main = async (event, context) => {
  const { OPENID } = cloud.getWXContext()
  const { role, name, phone, storeId, supplierId } = event

  if (!role || !name) {
    return { success: false, message: '角色和姓名不能为空' }
  }

  // 检查是否已注册
  const existRes = await db.collection('users').where({ openid: OPENID }).get()
  if (existRes.data.length > 0) {
    return { success: false, message: '您已注册，请直接登录' }
  }

  const user = {
    openid: OPENID, role, name,
    phone: phone || '',
    storeId: storeId || '',
    supplierId: supplierId || '',
    status: 'pending',
    createTime: new Date().toISOString()
  }

  const addRes = await db.collection('users').add({ data: user })
  user._id = addRes._id

  return { success: true, user, message: '注册成功，请等待管理员审核后登录' }
}
