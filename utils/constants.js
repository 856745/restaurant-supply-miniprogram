// 订单状态
const ORDER_STATUS = {
  PENDING:   { id: 'pending',   name: '待确认', color: '#f59e0b', bg: '#fef3c7' },
  ACCEPTED:  { id: 'accepted',  name: '已接单', color: '#3b82f6', bg: '#dbeafe' },
  SHIPPED:   { id: 'shipped',   name: '配送中', color: '#8b5cf6', bg: '#ede9fe' },
  PARTIAL:   { id: 'partial',   name: '部分收货', color: '#0891b2', bg: '#cffafe' },
  RECEIVED:  { id: 'received',  name: '已收货', color: '#10b981', bg: '#d1fae5' },
  CANCELLED: { id: 'cancelled', name: '已取消', color: '#9ca3af', bg: '#f3f4f6' }
}

// 用户状态
const USER_STATUS = {
  ACTIVE:   { id: 'active',   name: '正常', color: '#10b981' },
  PENDING:  { id: 'pending',  name: '待审核', color: '#f59e0b' },
  DISABLED: { id: 'disabled', name: '已禁用', color: '#ef4444' }
}

module.exports = { ORDER_STATUS, USER_STATUS }
