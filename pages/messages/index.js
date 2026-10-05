// 站内消息中心（管理员/店长/供货商三端共用）
const cloud = require('../../utils/cloud.js')

const TYPE_MAP = {
  order: { icon: '📦', name: '订单动态' },
  system: { icon: '🔔', name: '系统通知' }
}

Page({
  data: {
    messages: [],
    total: 0,
    page: 1,
    pageSize: 20,
    loading: false,
    hasMore: true,
    unreadCount: 0
  },

  onShow() {
    this.loadData(true)
    this.loadUnread()
  },

  async loadUnread() {
    try {
      const count = await cloud.getUnreadMessageCount()
      this.setData({ unreadCount: count })
    } catch (e) {}
  },

  async loadData(reset) {
    if (this.data.loading) return
    this.setData({ loading: true })
    try {
      const page = reset ? 1 : this.data.page
      const res = await cloud.getMessages(page, this.data.pageSize)
      const list = (res.messages || []).map(m => this.decorate(m))
      const messages = reset ? list : this.data.messages.concat(list)
      const total = res.total || 0
      this.setData({ messages, total, page, hasMore: messages.length < total })
    } catch (e) {
      wx.showToast({ title: (e && e.message) ? e.message.slice(0, 40) : '加载失败', icon: 'none', duration: 3000 })
    } finally {
      this.setData({ loading: false })
    }
  },

  decorate(m) {
    const t = TYPE_MAP[m.type] || TYPE_MAP.system
    return Object.assign({}, m, {
      icon: t.icon,
      typeName: t.name,
      timeText: this.fmtTime(m.createTime)
    })
  },

  fmtTime(t) {
    if (!t) return ''
    const d = new Date(t)
    if (isNaN(d.getTime())) return String(t)
    const pad = n => (n < 10 ? '0' + n : '' + n)
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes())
  },

  onReachBottom() {
    if (this.data.hasMore) {
      this.setData({ page: this.data.page + 1 })
      this.loadData(false)
    }
  },

  async onTapMessage(e) {
    const id = e.currentTarget.dataset.id
    const item = this.data.messages.find(m => m._id === id)
    if (!item) return
    if (item.status === 'unread') {
      const messages = this.data.messages.map(m => m._id === id ? Object.assign({}, m, { status: 'read' }) : m)
      this.setData({ messages, unreadCount: Math.max(0, this.data.unreadCount - 1) })
      try { await cloud.markMessageRead(id) } catch (e) {}
    }
  },

  onDeleteMessage(e) {
    const id = e.currentTarget.dataset.id
    wx.showModal({
      title: '删除消息',
      content: '确认删除这条消息？',
      confirmColor: '#ef4444',
      success: async (res) => {
        if (!res.confirm) return
        try {
          await cloud.deleteMessage(id)
          const messages = this.data.messages.filter(m => m._id !== id)
          this.setData({ messages, total: Math.max(0, this.data.total - 1) })
        } catch (e) {
          wx.showToast({ title: '删除失败', icon: 'none' })
        }
      }
    })
  },

  async markAllRead() {
    if (!this.data.unreadCount) return
    try {
      await cloud.markAllMessagesRead()
      const messages = this.data.messages.map(m => Object.assign({}, m, { status: 'read' }))
      this.setData({ messages, unreadCount: 0 })
      wx.showToast({ title: '已全部标记为已读', icon: 'none' })
    } catch (e) {
      wx.showToast({ title: '操作失败', icon: 'none' })
    }
  }
})
