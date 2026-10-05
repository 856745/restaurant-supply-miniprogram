/**
 * 店长 - 货品管理（已迁移至管理员，此页仅作兼容保留）
 */
const cloud = require('../../../utils/cloud.js')
const { CATEGORIES } = require('../../../utils/config.js')

const CAT_MAP = {}
CATEGORIES.forEach(c => { CAT_MAP[c.id] = { name: c.name, icon: c.icon } })

const CAT_LIST = [{ id: 'all', name: '全部' }].concat(CATEGORIES.map(c => ({ id: c.id, name: c.name })))
const CAT_PICKER = CATEGORIES.map(c => ({ id: c.id, name: c.name }))

Page({
  data: {
    keyword: '',
    activeCat: 'all',
    catList: CAT_LIST,
    catPicker: CAT_PICKER,
    filteredGoods: [],
    showModal: false,
    modalTitle: '编辑货品',
    form: {
      _id: '', name: '', category: 'meat', categoryName: '肉类',
      unit: '斤', price: '', specWeight: '', specCount: '',
      image: '', description: '', supplierId: '', supplierName: ''
    },
    allSuppliers: []
  },

  async onShow() { await this.loadData() },

  async loadData() {
    const data = await cloud.getStoreData()
    if (!data) return
    const suppliers = cloud.list('suppliers') || []
    this.setData({ allSuppliers: suppliers })
    this.filterGoods(data.goods || [])
  },

  filterGoods(allGoods) {
    let list = allGoods
    if (this.data.activeCat !== 'all') list = list.filter(g => g.category === this.data.activeCat)
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
  },

  async onSearch(e) { this.setData({ keyword: e.detail.value }); const data = await cloud.getStoreData(); if (data) this.filterGoods(data.goods || []) },
  async onCatTap(e) { this.setData({ activeCat: e.currentTarget.dataset.id }); const data = await cloud.getStoreData(); if (data) this.filterGoods(data.goods || []) },

  onGoodsTap(e) {
    const g = this.data.filteredGoods[e.currentTarget.dataset.idx]
    this.setData({
      showModal: true, modalTitle: '编辑货品',
      form: {
        _id: g._id, name: g.name, category: g.category,
        categoryName: (CAT_MAP[g.category] || {}).name || '其他',
        unit: g.unit, price: String(g.price || ''),
        specWeight: g.specWeight || '', specCount: g.specCount || '',
        image: g.image || '', description: g.description || '',
        supplierId: g.supplierId || '', supplierName: g.supplierName || ''
      }
    })
  },

  onAddTap() {
    this.setData({
      showModal: true, modalTitle: '新增货品',
      form: {
        _id: '', name: '', category: 'meat', categoryName: '肉类',
        unit: '斤', price: '', specWeight: '', specCount: '',
        image: '', description: '', supplierId: '', supplierName: ''
      }
    })
  },

  onFormChange(e) { this.setData({ ['form.' + e.currentTarget.dataset.field]: e.detail.value }) },
  onPickerCat(e) {
    const idx = Number(e.detail.value); const cat = this.data.catPicker[idx]
    this.setData({ 'form.category': cat.id, 'form.categoryName': cat.name })
  },
  onPickerSupplier(e) {
    const idx = Number(e.detail.value); const sup = this.data.allSuppliers[idx]
    this.setData({ 'form.supplierId': sup._id, 'form.supplierName': sup.name })
  },
  onChooseImage() {
    wx.chooseImage({
      count: 1, sizeType: ['compressed'], sourceType: ['album', 'camera'],
      success: (res) => {
        const fs = wx.getFileSystemManager()
        try {
          const base64 = fs.readFileSync(res.tempFilePaths[0], 'base64')
          this.setData({ 'form.image': 'data:image/jpeg;base64,' + base64 })
        } catch (e) { this.setData({ 'form.image': res.tempFilePaths[0] }) }
      }
    })
  },
  onRemoveImage() { this.setData({ 'form.image': '' }) },

  closeModal() { this.setData({ showModal: false }) },

  async saveGoods() {
    const f = this.data.form
    if (!f.name.trim()) { wx.showToast({ title: '请输入货品名称', icon: 'none' }); return }
    const user = cloud.getCurrentUser(); const data = await cloud.getStoreData(); const store = data ? data.store : null
    const saveData = {
      name: f.name.trim(), category: f.category, unit: f.unit.trim() || '斤',
      price: Number(f.price) || 0, specWeight: f.specWeight.trim(),
      specCount: f.specCount.trim(), image: f.image || '',
      description: f.description.trim(),
      storeId: user.storeId, storeName: store ? store.name : '',
      supplierId: f.supplierId || '', supplierName: ''
    }
    if (f.supplierId) { const sup = cloud.getById('suppliers', f.supplierId); saveData.supplierName = sup ? sup.name : '' }
    if (f._id) saveData._id = f._id
    await cloud.saveGoods(saveData)
    this.setData({ showModal: false }); wx.showToast({ title: '保存成功', icon: 'success' }); this.loadData()
  },

  deleteGoods() {
    const f = this.data.form; if (!f._id) return
    wx.showModal({
      title: '确认删除', content: '删除后不可恢复，确定删除该货品？',
      success: (res) => { if (res.confirm) { cloud.deleteGoods(f._id); this.setData({ showModal: false }); wx.showToast({ title: '已删除', icon: 'success' }); this.loadData() } }
    })
  }
})
