/**
 * 店长 - 货品目录（查看规格信息）
 */
const cloud = require('../../../utils/cloud.js')
const { CATEGORIES } = require('../../../utils/config.js')

const CAT_MAP = {}
CATEGORIES.forEach(c => { CAT_MAP[c.id] = { name: c.name, icon: c.icon } })

Page({
  data: {
    keyword: '',
    filteredGoods: []
  },

  onShow() {
    this.loadData()
  },

  async loadData() {
    const data = await cloud.getStoreData()
    if (!data) return

    const goods = (data.goods || []).map(g => ({
      ...g,
      icon: (CAT_MAP[g.category] || {}).icon || '📦',
      catName: (CAT_MAP[g.category] || {}).name || '其他',
      hasImage: !!(g.image && g.image.length > 0)
    }))

    this.setData({ filteredGoods: goods })
  },

  onSearch(e) {
    this.setData({ keyword: e.detail.value })
    this.reFilter()
  },

  async reFilter() {
    const data = await cloud.getStoreData()
    if (!data) return
    let list = data.goods || []
    if (this.data.keyword) {
      const kw = this.data.keyword.toLowerCase()
      list = list.filter(g => g.name.toLowerCase().includes(kw))
    }
    const filtered = list.map(g => ({
      ...g,
      icon: (CAT_MAP[g.category] || {}).icon || '📦',
      catName: (CAT_MAP[g.category] || {}).name || '其他',
      hasImage: !!(g.image && g.image.length > 0)
    }))
    this.setData({ filteredGoods: filtered })
  }
})
