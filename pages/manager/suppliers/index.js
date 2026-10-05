/**
 * 店长 - 供货商列表
 */
const cloud = require('../../../utils/cloud.js')
const { CATEGORIES } = require('../../../utils/config.js')

const CAT_MAP = {}
CATEGORIES.forEach(c => { CAT_MAP[c.id] = c })

Page({
  data: {
    suppliers: [],
    filteredSuppliers: [],
    keyword: ''
  },

  async onShow() {
    await this.loadData()
  },

  async loadData() {
    wx.showLoading({ title: '加载中...' })
    try {
      await cloud.getStoreData()
      const user = cloud.getCurrentUser()
      const storeId = user ? user.storeId : ''
      const suppliers = cloud.list('suppliers') || []
      // 过滤：仅显示 active 且对本门店可见的供应商
      const list = suppliers.filter(s => {
        if (s.status !== 'active') return false
        if (!s.visibleStores || s.visibleStores.length === 0) return true
        return s.visibleStores.indexOf(storeId) > -1
      }).map(s => ({
        ...s,
        catTags: (s.categories || []).map(cid => ({
          id: cid,
          name: (CAT_MAP[cid] || {}).name || cid
        }))
      }))
      this.setData({ suppliers: list }, () => this.filterSuppliers())
    } catch (e) {
      console.error('加载失败:', e); wx.showToast({ title: (e && e.message) ? e.message.slice(0, 40) : '加载失败', icon: 'none', duration: 4000 })
    } finally {
      wx.hideLoading()
    }
  },

  onSearch(e) {
    this.setData({ keyword: e.detail.value }, () => this.filterSuppliers())
  },

  filterSuppliers() {
    const kw = (this.data.keyword || '').trim().toLowerCase()
    if (!kw) {
      this.setData({ filteredSuppliers: this.data.suppliers })
      return
    }
    const filtered = this.data.suppliers.filter(s => {
      return (s.name || '').toLowerCase().includes(kw) ||
             (s.contact || '').toLowerCase().includes(kw) ||
             (s.phone || '').toLowerCase().includes(kw) ||
             (s.address || '').toLowerCase().includes(kw)
    })
    this.setData({ filteredSuppliers: filtered })
  },

  callPhone(e) {
    const phone = e.currentTarget.dataset.phone
    wx.makePhoneCall({ phoneNumber: phone })
  }
})
