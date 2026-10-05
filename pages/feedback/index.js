// 意见反馈页（管理员/店长/供货商三端共用）
const cloud = require('../../utils/cloud.js')

Page({
  data: {
    types: [
      { id: 'bug', name: '问题/Bug反馈', icon: '🐞' },
      { id: 'suggest', name: '功能建议', icon: '💡' },
      { id: 'other', name: '其他', icon: '💬' }
    ],
    type: 'bug',
    content: '',
    contact: '',
    submitting: false
  },

  onTypeTap(e) {
    this.setData({ type: e.currentTarget.dataset.id })
  },

  onContentInput(e) {
    this.setData({ content: e.detail.value })
  },

  onContactInput(e) {
    this.setData({ contact: e.detail.value })
  },

  async onSubmit() {
    if (this.data.submitting) return
    const content = (this.data.content || '').trim()
    if (!content) {
      wx.showToast({ title: '请输入反馈内容', icon: 'none' })
      return
    }
    this.setData({ submitting: true })
    try {
      await cloud.submitFeedback({
        type: this.data.type,
        content: content,
        contact: (this.data.contact || '').trim()
      })
      wx.showToast({ title: '反馈已提交，感谢！', icon: 'success' })
      setTimeout(() => {
        if (getCurrentPages().length > 1) {
          wx.navigateBack()
        } else {
          try { getApp().goHome() } catch (e) { wx.reLaunch({ url: '/pages/login/index' }) }
        }
      }, 1000)
    } catch (e) {
      wx.showToast({ title: (e && e.message) ? e.message.slice(0, 40) : '提交失败', icon: 'none', duration: 3000 })
    } finally {
      this.setData({ submitting: false })
    }
  }
})
