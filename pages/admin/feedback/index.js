// 管理员 - 意见反馈管理（查看 / 标记已读 / 删除）
const cloud = require('../../../utils/cloud.js')

const TYPE_MAP = {
  bug: { name: 'Bug反馈', cls: 'danger' },
  suggest: { name: '建议', cls: 'success' },
  other: { name: '其他', cls: 'gray' }
}
const ROLE_MAP = { admin: '管理员', manager: '店长', supplier: '供货商' }

function decorate(f) {
  const t = TYPE_MAP[f.type] || TYPE_MAP.other
  return Object.assign({}, f, {
    typeName: t.name,
    typeCls: t.cls,
    roleName: ROLE_MAP[f.userRole] || f.userRole || '',
    timeText: f.createTimeText || f.createTime || ''
  })
}

Page({
  data: {
    feedbacks: [],
    total: 0,
    page: 1,
    pageSize: 20,
    loading: false,
    hasMore: true,
    keyword: ''
  },

  onShow() {
    this.loadData(true)
  },

  async loadData(reset) {
    if (this.data.loading) return
    this.setData({ loading: true })
    try {
      const page = reset ? 1 : this.data.page
      const res = await cloud.getFeedbacks(page, this.data.pageSize)
      const list = (res.feedbacks || []).map(decorate)
      const feedbacks = reset ? list : this.data.feedbacks.concat(list)
      const total = res.total || 0
      this.setData({
        feedbacks,
        total,
        page,
        hasMore: feedbacks.length < total
      })
    } catch (e) {
      wx.showToast({ title: (e && e.message) ? e.message.slice(0, 40) : '加载失败', icon: 'none', duration: 3000 })
    } finally {
      this.setData({ loading: false })
    }
  },

  onReachBottom() {
    if (!this.data.hasMore) return
    this.setData({ page: this.data.page + 1 })
    this.loadData(false)
  },

  // 点击卡片：标记已读
  async onTapFeedback(e) {
    const id = e.currentTarget.dataset.id
    const item = this.data.feedbacks.find(f => f._id === id)
    if (!item) return
    if (item.status === 'unread') {
      // 先本地置为已读，再异步上报（失败不回滚，避免打断用户）
      const feedbacks = this.data.feedbacks.map(f => f._id === id ? Object.assign({}, f, { status: 'read' }) : f)
      this.setData({ feedbacks })
      try { await cloud.markFeedbackRead(id) } catch (e) {}
    }
  },

  // 长按：删除
  onDeleteFeedback(e) {
    const id = e.currentTarget.dataset.id
    wx.showModal({
      title: '删除反馈',
      content: '确认删除这条反馈？删除后不可恢复。',
      confirmColor: '#ef4444',
      success: async (res) => {
        if (!res.confirm) return
        try {
          await cloud.deleteFeedback(id)
          const feedbacks = this.data.feedbacks.filter(f => f._id !== id)
          this.setData({ feedbacks, total: Math.max(0, this.data.total - 1) })
          wx.showToast({ title: '已删除', icon: 'none' })
        } catch (e) {
          wx.showToast({ title: (e && e.message) ? e.message.slice(0, 40) : '删除失败', icon: 'none', duration: 3000 })
        }
      }
    })
  },

  goSubmit() {
    wx.navigateTo({ url: '/pages/feedback/index' })
  }
})
